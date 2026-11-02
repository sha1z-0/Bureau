import { unzipSync } from 'fflate';
import { extractFacts } from '../ai/profile.ts';
import { AppError } from '../errors.ts';
import type { AiClient } from './ai.ts';
import { reconcileFacts, type IncomingFact } from './facts.ts';
import type { PartReport } from './types.ts';

/**
 * LinkedIn, the honest way: the official data export (Settings → Data privacy →
 * Get a copy of your data; a zip of CSVs) or profile text the owner pastes.
 * Bureau never logs in to LinkedIn or scrapes it. Only the candidate's own
 * profile files are read; connections, messages and everything about other
 * people are ignored.
 */

export const EXPORT_REF = 'linkedin-export';
export const PASTE_REF = 'linkedin-paste';
const MAX_UNZIPPED = 40 * 1024 * 1024;
const MAX_FILE = 5 * 1024 * 1024;

const WANTED = ['positions', 'education', 'skills', 'certifications', 'projects', 'honors', 'languages', 'publications', 'courses'] as const;
type Wanted = (typeof WANTED)[number];

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

/** Rows as objects keyed by header. Skips the "Notes:" preamble some export files start with. */
export function csvRecords(text: string, expect: string[]): Record<string, string>[] {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((r) => expect.some((h) => r.map((x) => x.trim().toLowerCase()).includes(h.toLowerCase())));
  if (headerAt < 0) return [];
  const header = rows[headerAt].map((h) => h.trim());
  return rows.slice(headerAt + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const HEADERS: Record<Wanted, string[]> = {
  positions: ['Company Name', 'Title'],
  education: ['School Name'],
  skills: ['Name'],
  certifications: ['Name', 'Authority'],
  projects: ['Title', 'Description'],
  honors: ['Title', 'Issued On'],
  languages: ['Name', 'Proficiency'],
  publications: ['Name', 'Publisher'],
  courses: ['Name', 'Number'],
};

function span(a?: string, b?: string) {
  const s = [a, b].filter((x) => x && x.trim());
  if (!s.length) return '';
  return ` (${a || '?'} – ${b || 'Present'})`;
}

function splitLines(desc: string): string[] {
  return desc
    .split(/\r?\n|(?:^|\s)[•▪●◦]\s+/)
    .map((l) => l.replace(/^[-*•\s]+/, '').trim())
    .filter((l) => l.length > 3);
}

/** Facts from the files of an export, keyed by file kind. */
export function factsFromExport(files: Partial<Record<Wanted, string>>): IncomingFact[] {
  const out: IncomingFact[] = [];
  const ref = (file: string) => `${EXPORT_REF}/${file}`;
  if (files.positions) {
    for (const r of csvRecords(files.positions, HEADERS.positions)) {
      if (!r['Title'] && !r['Company Name']) continue;
      const ctx = `${r['Title']}@${r['Company Name']}`.toLowerCase();
      const loc = r['Location'] ? `, ${r['Location']}` : '';
      out.push({ kind: 'experience', text: `${r['Title']} at ${r['Company Name']}${loc}${span(r['Started On'], r['Finished On'])}`, sourceRef: ref('Positions.csv'), context: ctx });
      for (const l of splitLines(r['Description'] ?? '')) out.push({ kind: /\d/.test(l) ? 'metric' : 'experience', text: l, sourceRef: ref('Positions.csv'), context: ctx });
    }
  }
  if (files.education) {
    for (const r of csvRecords(files.education, HEADERS.education)) {
      if (!r['School Name']) continue;
      const text = `${[r['Degree Name'], r['School Name']].filter(Boolean).join(', ')}${span(r['Start Date'], r['End Date'])}`;
      out.push({ kind: 'education', text, sourceRef: ref('Education.csv') });
      if (r['Notes']) out.push({ kind: 'education', text: r['Notes'], sourceRef: ref('Education.csv'), context: r['School Name'].toLowerCase() });
    }
  }
  if (files.skills) for (const r of csvRecords(files.skills, HEADERS.skills)) if (r['Name']) out.push({ kind: 'skill', text: r['Name'], sourceRef: ref('Skills.csv') });
  if (files.certifications) {
    for (const r of csvRecords(files.certifications, HEADERS.certifications)) {
      if (!r['Name']) continue;
      out.push({ kind: 'certification', text: `${r['Name']}${r['Authority'] ? ` — ${r['Authority']}` : ''}${r['Started On'] ? ` (${r['Started On']})` : ''}`, sourceRef: r['Url'] || ref('Certifications.csv') });
    }
  }
  if (files.projects) {
    for (const r of csvRecords(files.projects, HEADERS.projects)) {
      if (!r['Title']) continue;
      out.push({ kind: 'project', text: r['Description'] ? `${r['Title']}: ${r['Description']}` : r['Title'], sourceRef: r['Url'] || ref('Projects.csv') });
    }
  }
  if (files.honors) {
    for (const r of csvRecords(files.honors, HEADERS.honors)) {
      if (!r['Title']) continue;
      out.push({ kind: 'achievement', text: `${r['Title']}${r['Issued On'] ? ` (${r['Issued On']})` : ''}${r['Description'] ? `: ${r['Description']}` : ''}`, sourceRef: ref('Honors.csv') });
    }
  }
  if (files.languages) {
    for (const r of csvRecords(files.languages, HEADERS.languages)) if (r['Name']) out.push({ kind: 'other', text: `Language: ${r['Name']}${r['Proficiency'] ? ` (${r['Proficiency']})` : ''}`, sourceRef: ref('Languages.csv') });
  }
  if (files.publications) {
    for (const r of csvRecords(files.publications, HEADERS.publications)) {
      if (!r['Name']) continue;
      out.push({ kind: 'achievement', text: `Publication: ${r['Name']}${r['Publisher'] ? `, ${r['Publisher']}` : ''}${r['Published On'] ? ` (${r['Published On']})` : ''}`, sourceRef: r['Url'] || ref('Publications.csv') });
    }
  }
  if (files.courses) for (const r of csvRecords(files.courses, HEADERS.courses)) if (r['Name']) out.push({ kind: 'education', text: `Course: ${r['Name']}`, sourceRef: ref('Courses.csv') });
  return out;
}

function wantedKind(filename: string): Wanted | null {
  const base = filename.split(/[\\/]/).pop()!.toLowerCase().replace(/\.csv$/, '');
  return (WANTED as readonly string[]).includes(base) ? (base as Wanted) : null;
}

/** Read an export zip or a single CSV from it. */
export function readExport(buf: Buffer, filename: string): Partial<Record<Wanted, string>> {
  const files: Partial<Record<Wanted, string>> = {};
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    let total = 0;
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(buf), {
        filter: (f) => {
          if (!wantedKind(f.name)) return false;
          total += f.originalSize;
          if (f.originalSize > MAX_FILE || total > MAX_UNZIPPED) throw new AppError(413, 'TOO_LARGE', 'That export expands to an unreasonable size.');
          return true;
        },
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(400, 'BAD_ZIP', 'That file is not a readable LinkedIn export zip.');
    }
    for (const [name, data] of Object.entries(entries)) {
      const kind = wantedKind(name)!;
      files[kind] = Buffer.from(data).toString('utf8');
    }
  } else {
    if (buf.subarray(0, 4096).includes(0)) throw new AppError(415, 'UNSUPPORTED', 'Upload the LinkedIn export zip or one of its CSV files.');
    const kind = wantedKind(filename);
    if (!kind) throw new AppError(415, 'UNSUPPORTED', 'That CSV is not one Bureau reads (Positions, Education, Skills, Certifications, Projects, Honors, Languages, Publications or Courses).');
    files[kind] = buf.toString('utf8');
  }
  if (!Object.keys(files).length) throw new AppError(422, 'EMPTY_EXPORT', 'No profile files found in that export. Request the full archive from LinkedIn.');
  return files;
}

/**
 * Import an export. A full zip replaces the previous export's facts; a single
 * CSV replaces only the facts from that file.
 */
export function importLinkedInExport(buf: Buffer, filename: string): PartReport & { files: string[] } {
  const files = readExport(buf, filename);
  const incoming = factsFromExport(files);
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const names = Object.keys(files).map((k) => `${k[0].toUpperCase()}${k.slice(1)}.csv`);
  const prefixes = names.map((n) => `${EXPORT_REF}/${n}`);
  const fileUrls = new Set(incoming.filter((f) => !f.sourceRef.startsWith(EXPORT_REF)).map((f) => f.sourceRef));
  // A full export owns every LinkedIn fact except the pasted text's; a single CSV owns only its own.
  const result = reconcileFacts('linkedin', incoming, (ref) => (isZip ? ref !== PASTE_REF : prefixes.includes(ref) || fileUrls.has(ref)));
  return { status: 'ok', ...result, files: names, message: `${incoming.length} fact(s) from ${names.join(', ')}` };
}

/** Pasted profile text ("About", experience sections…) → near-verbatim facts. Replaces the previous paste. */
export async function importLinkedInText(text: string, ai: AiClient): Promise<PartReport> {
  const clean = text.replace(/\r/g, '').trim();
  if (clean.length < 40) throw new AppError(400, 'TOO_SHORT', 'Paste more of your LinkedIn profile text.');
  if (clean.length > 30_000) throw new AppError(413, 'TOO_LARGE', 'That is more text than a profile; paste up to 30,000 characters.');
  const { facts, rejected } = await extractFacts([{ ref: PASTE_REF, label: 'LinkedIn profile text pasted by the candidate', text: clean }], ai);
  const result = reconcileFacts(
    'linkedin',
    facts.map((f) => ({ kind: f.kind, text: f.text, sourceRef: PASTE_REF })),
    (ref) => ref === PASTE_REF,
  );
  return { status: 'ok', ...result, message: `${facts.length} fact(s) from pasted text${rejected.length ? `; ${rejected.length} unverifiable dropped` : ''}` };
}
