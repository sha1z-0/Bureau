import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.ts';
import { ApplicationPacketSchema, type ApplicationPacket, type CriticResult, type EvidenceMap, type LetterStrategy, type LintResult, type TruthResult } from '../contracts/writer.ts';
import { all, get, now, run, tx } from '../db.ts';
import { cvFilename, letterFilename, renderCvPdfWithPages, renderLetterPdf } from '../services/cvPdf.ts';
import { fingerprintOf, loadMasterProfile } from '../profile/index.ts';
import type { TailoredCv } from './cvSchema.ts';
import { lintLetter } from './lint.ts';
import { codeTruth, truthResult } from './truth.ts';

/**
 * Step 13: persistence. The packet lives in `applications` (v1 columns kept
 * filled so the studio and v1 routes still work, plus campaign_id and
 * variant_id) and every variant in `letter_variants` (text, passages used,
 * critic, lint, style tags, chosen). The writer's working (evidence map,
 * subject lines, short answers, follow-up, gate results, steps) is stored in
 * `applications.notes` under `writer`, next to the v1 `emphasis` and `issues`.
 */

export const PACKETS_DIR = path.join(DATA_DIR, 'packets');

export interface VariantRecord {
  id: string;
  strategy: LetterStrategy;
  text: string;
  passagesUsed: string[];
  styleTags: string[];
  critic: CriticResult | null;
  lint: LintResult | null;
  chosen: boolean;
}

export interface WriterStep {
  step: string;
  at: string;
  detail: string;
}

export interface WriterNotes {
  version: 1;
  campaignId: string | null;
  status: 'written' | 'skipped';
  skipped: string | null;
  strategy: LetterStrategy | null;
  lengthArm: string | null;
  explored: boolean;
  evidence: EvidenceMap | null;
  evidenceAdjustments: string[];
  fastLearning: string | null;
  subjects: string[];
  subjectIndex: number;
  shortAnswers: Record<string, string>;
  outreach: string;
  followUp: string;
  /** Missing on packets written before the modes existed: those were all quality. */
  mode?: 'volume' | 'quality';
  quality: { critic: CriticResult | null; lint: LintResult; truth: TruthResult } | null;
  cvPdfPath: string;
  letterPdfPath: string;
  cvPages: number;
  cvChanges: string[];
  steps: WriterStep[];
}

export interface AuditIssueV1 {
  claim: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
  origin: 'code' | 'auditor';
}

export interface SaveInput {
  jobId: string;
  campaignId: string | null;
  status: 'draft' | 'skipped';
  subject: string;
  coverLetter: string;
  outreach: string;
  cv: TailoredCv | null;
  keywords: string[];
  emphasis: string[];
  issues: AuditIssueV1[];
  writer: WriterNotes;
  variants: VariantRecord[];
  channel: string;
  toEmail: string | null;
}

interface AppRow {
  id: string;
  job_id: string;
  subject: string;
  cover_letter: string;
  message: string;
  cv: string;
  notes: string;
  status: string;
  campaign_id: string | null;
  variant_id: string | null;
  updated_at: string;
}

/** Insert or update the job's open application, and replace its variants. Returns the application id. */
export function saveApplication(input: SaveInput, reuseId?: string): string {
  return tx(() => {
    const existing = reuseId
      ? get<{ id: string }>('SELECT id FROM applications WHERE id = ?', reuseId)
      : get<{ id: string }>("SELECT id FROM applications WHERE job_id = ? AND status NOT IN ('sent', 'submitted') ORDER BY updated_at DESC LIMIT 1", input.jobId);
    const id = existing?.id ?? crypto.randomUUID();
    const chosen = input.variants.find((v) => v.chosen) ?? null;
    const notes = JSON.stringify({ emphasis: input.emphasis, issues: input.issues, writer: input.writer });
    const ts = now();
    if (existing) {
      run(
        `UPDATE applications SET subject = ?, cover_letter = ?, message = ?, cv = ?, notes = ?, keywords = ?, status = ?, channel = ?, to_email = ?,
           campaign_id = COALESCE(?, campaign_id), variant_id = ?, reason = ?, error = NULL, updated_at = ? WHERE id = ?`,
        input.subject,
        input.coverLetter,
        input.outreach,
        JSON.stringify(input.cv ?? {}),
        notes,
        JSON.stringify(input.keywords),
        input.status,
        input.channel,
        input.toEmail,
        input.campaignId,
        chosen?.id ?? null,
        input.writer.skipped,
        ts,
        id,
      );
    } else {
      run(
        `INSERT INTO applications (id, job_id, subject, cover_letter, message, cv, notes, keywords, status, channel, to_email, campaign_id, variant_id, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.jobId,
        input.subject,
        input.coverLetter,
        input.outreach,
        JSON.stringify(input.cv ?? {}),
        notes,
        JSON.stringify(input.keywords),
        input.status,
        input.channel,
        input.toEmail,
        input.campaignId,
        chosen?.id ?? null,
        input.writer.skipped,
        ts,
        ts,
      );
    }
    run('DELETE FROM letter_variants WHERE application_id = ?', id);
    for (const v of input.variants) {
      run(
        `INSERT INTO letter_variants (id, application_id, variant, text, style_tags, passages_used, critic, lint, chosen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.id,
        id,
        v.strategy,
        v.text,
        JSON.stringify(v.styleTags),
        JSON.stringify(v.passagesUsed),
        v.critic ? JSON.stringify(v.critic) : null,
        v.lint ? JSON.stringify(v.lint) : null,
        v.chosen ? 1 : 0,
      );
    }
    return id;
  });
}

/** Render the CV and letter PDFs into data/packets/<applicationId>/. */
export async function renderPacketFiles(applicationId: string, cv: TailoredCv, letter: string, paper: 'A4' | 'LETTER'): Promise<{ cvPdfPath: string; letterPdfPath: string; cvPages: number }> {
  const dir = path.join(PACKETS_DIR, applicationId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cvPdf = await renderCvPdfWithPages(cv, paper);
  const cvPdfPath = path.join(dir, cvFilename(cv.name));
  fs.writeFileSync(cvPdfPath, cvPdf.buffer);
  const contact = [cv.contact.email, cv.contact.phone, cv.contact.location].filter(Boolean).join(' | ');
  const letterPdfPath = path.join(dir, letterFilename(cv.name));
  fs.writeFileSync(letterPdfPath, await renderLetterPdf(cv.name, letter, contact));
  return { cvPdfPath, letterPdfPath, cvPages: cvPdf.pages };
}

export function setPacketPaths(applicationId: string, paths: { cvPdfPath: string; letterPdfPath: string; cvPages: number }) {
  const row = get<{ notes: string }>('SELECT notes FROM applications WHERE id = ?', applicationId);
  if (!row) return;
  const notes = JSON.parse(row.notes) as { writer?: WriterNotes };
  if (!notes.writer) return;
  notes.writer = { ...notes.writer, ...paths };
  run('UPDATE applications SET notes = ? WHERE id = ?', JSON.stringify(notes), applicationId);
}

export function readNotes(raw: string): { emphasis: string[]; issues: AuditIssueV1[]; writer: WriterNotes | null } {
  try {
    const n = JSON.parse(raw) as { emphasis?: string[]; issues?: AuditIssueV1[]; writer?: WriterNotes };
    return { emphasis: n.emphasis ?? [], issues: n.issues ?? [], writer: n.writer ?? null };
  } catch {
    return { emphasis: [], issues: [], writer: null };
  }
}

export function loadVariants(applicationId: string): VariantRecord[] {
  return all<{ id: string; variant: LetterStrategy; text: string; style_tags: string; passages_used: string; critic: string | null; lint: string | null; chosen: number }>(
    "SELECT * FROM letter_variants WHERE application_id = ? ORDER BY CASE variant WHEN 'hook' THEN 0 WHEN 'proof' THEN 1 ELSE 2 END",
    applicationId,
  ).map((r) => ({
    id: r.id,
    strategy: r.variant,
    text: r.text,
    styleTags: JSON.parse(r.style_tags) as string[],
    passagesUsed: JSON.parse(r.passages_used) as string[],
    critic: r.critic ? (JSON.parse(r.critic) as CriticResult) : null,
    lint: r.lint ? (JSON.parse(r.lint) as LintResult) : null,
    chosen: r.chosen === 1,
  }));
}

/**
 * The owner may edit a written letter or subject in the studio. Edited words
 * must pass the gates again before they go anywhere: the full lint on the
 * letter and the code truth lock on letter and subject. (The critic score is
 * the gated draft's; the edit is the candidate's own writing.)
 */
export function regate(row: Pick<AppRow, 'job_id' | 'subject' | 'cover_letter' | 'variant_id'>, writer: WriterNotes): { lint: LintResult; truth: TruthResult } | null {
  const master = loadMasterProfile();
  const job = get<{ title: string; company: string; description_text: string | null }>('SELECT title, company, description_text FROM jobs WHERE id = ?', row.job_id);
  if (!master || !job) return null;
  const chosen = get<{ passages_used: string }>('SELECT passages_used FROM letter_variants WHERE id = ?', row.variant_id ?? '');
  const lint = lintLetter(row.cover_letter, {
    fingerprint: master.style ?? fingerprintOf(master.voiceBank.map((v) => v.text)),
    voice: master.voiceBank.map((v) => ({ id: v.id, text: v.text })),
    passagesUsed: chosen ? (JSON.parse(chosen.passages_used) as string[]) : [],
    company: job.company,
    role: job.title,
    specifics: [...(writer.evidence?.hooks.map((h) => h.text) ?? []), ...(writer.evidence?.mustWins ?? [])],
  });
  const truth = truthResult(
    codeTruth(
      { texts: [{ label: 'Letter', text: row.cover_letter }, { label: 'Subject', text: row.subject }] },
      { profile: master, facts: master.facts, learning: master.learning, targetCompany: job.company, employerText: `${job.title}\n${job.company}\n${job.description_text ?? ''}` },
    ),
  );
  return { lint, truth };
}

/**
 * The packet for a written application, or null if it was skipped, predates
 * the v2 writer, or was edited after writing into something that fails the gates.
 */
export function loadPacket(applicationId: string): ApplicationPacket | null {
  const row = get<AppRow>('SELECT * FROM applications WHERE id = ?', applicationId);
  if (!row) return null;
  const { writer } = readNotes(row.notes);
  if (!writer || writer.status !== 'written' || !writer.quality) return null;
  let quality = writer.quality;
  const gated = get<{ text: string }>('SELECT text FROM letter_variants WHERE id = ?', row.variant_id ?? '')?.text;
  const gatedSubject = writer.subjects[writer.subjectIndex];
  if (gated !== row.cover_letter || (gatedSubject !== undefined && gatedSubject !== row.subject)) {
    const again = regate(row, writer);
    if (!again || !again.lint.pass || !again.truth.pass) return null;
    quality = { critic: writer.quality.critic, lint: again.lint, truth: again.truth };
  }
  return ApplicationPacketSchema.parse({
    applicationId: row.id,
    jobId: row.job_id,
    cvPdfPath: writer.cvPdfPath,
    letterPdfPath: writer.letterPdfPath,
    subject: row.subject,
    coverLetter: row.cover_letter,
    shortAnswers: writer.shortAnswers,
    outreach: row.message,
    followUp: writer.followUp,
    mode: writer.mode ?? 'quality',
    quality,
  });
}

/** The newest written packet for a job (what A05, A07 and the email channel apply with). */
export function packetForJob(jobId: string): ApplicationPacket | null {
  const rows = all<{ id: string }>("SELECT id FROM applications WHERE job_id = ? ORDER BY updated_at DESC", jobId);
  for (const r of rows) {
    const p = loadPacket(r.id);
    if (p) return p;
  }
  return null;
}

export function latestApplication(jobId: string): AppRow | null {
  return get<AppRow>('SELECT * FROM applications WHERE job_id = ? ORDER BY updated_at DESC LIMIT 1', jobId) ?? null;
}
