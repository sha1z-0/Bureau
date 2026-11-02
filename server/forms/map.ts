import type { FieldValue, FormField, ValueSource } from '../contracts/forms.ts';
import type { Answered } from '../contracts/profile.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { get } from '../db.ts';
import { loadProfile } from '../services/profileStore.ts';
import { type Candidate, candidateFrom, degreeLevel } from './candidate.ts';
import { bestOption, declineOption, labelNorm as normLabel, normText, parseDate } from './normalize.ts';
import { matchSynonym, type SynEntry } from './synonyms.ts';

/**
 * Field → value. Deterministic first (the synonym dictionary over the profile
 * and packet), then the answer bank (A03 `answerFor`), then the writer (A04
 * `answerQuestion`) for long-form prose. Every value carries its source and a
 * confidence. Required fields nobody can answer truthfully come back with
 * confidence 0 and `unknown: true`, for the answer-bank loop.
 *
 * Never guessed: legal attestations (sponsorship, work authorisation, criminal
 * record, clearance, age …) — only an answer-bank entry answers them — and
 * sensitive data (government ids, date of birth, bank details) — never entered.
 */

export interface MappedValue extends FieldValue {
  unknown?: boolean;
  /** Why there is no value / why it is unknown. */
  reason?: string;
  attestation?: boolean;
  /** The synonym key that matched, if any. */
  synKey?: string;
}

export interface JobInfo {
  id: string;
  title: string;
  company: string;
  source: string;
  url: string;
  ats: string | null;
}

export interface MapDeps {
  candidate: () => Candidate | null;
  answerFor: (question: string, ctx: { jobId?: string; fieldKind?: string; options?: string[] }) => Promise<Answered | null>;
  answerQuestion: ((jobId: string, question: string, opts: { maxChars?: number; options?: string[] }) => Promise<Answered | null>) | null;
}

export interface MapOptions {
  /** Ask the writer (A04) for long-form questions. Off by default: costs a Claude call. */
  writer?: boolean;
  job?: JobInfo | null;
  deps?: Partial<MapDeps>;
  /** Memo shared across the steps of one run. */
  cache?: Map<string, Answered | null>;
}

export const MIN_CONFIDENCE = 0.7;

async function defaultCandidate(): Promise<Candidate | null> {
  const p = loadProfile();
  if (!p) return null;
  let links = {};
  try {
    const { getLinks } = await import('../profile/links.ts');
    links = getLinks(p);
  } catch {
    /* profile module unavailable: links from the CV only */
  }
  return candidateFrom(p, links);
}

let candidateMemo: { at: number; c: Candidate | null } | null = null;
async function cachedCandidate(): Promise<Candidate | null> {
  if (candidateMemo && Date.now() - candidateMemo.at < 30_000) return candidateMemo.c;
  const c = await defaultCandidate();
  candidateMemo = { at: Date.now(), c };
  return c;
}

export function invalidateCandidate() {
  candidateMemo = null;
}

async function realAnswerFor(question: string, ctx: { jobId?: string; fieldKind?: string; options?: string[] }): Promise<Answered | null> {
  try {
    const { answerFor } = await import('../profile/index.ts');
    return await answerFor(question, ctx);
  } catch (err) {
    if ((err as Error).name === 'NotImplemented') return null;
    throw err;
  }
}

async function realAnswerQuestion(jobId: string, question: string, opts: { maxChars?: number; options?: string[] }): Promise<Answered | null> {
  try {
    const { answerQuestion } = await import('../writer/index.ts');
    return await answerQuestion(jobId, question, opts);
  } catch (err) {
    if ((err as Error).name === 'NotImplemented') return null;
    throw err;
  }
}

export function jobInfo(jobId: string): JobInfo | null {
  const j = get<{ id: string; title: string; company: string; source: string; url: string; apply_url_canonical: string | null; ats: string | null }>(
    'SELECT id, title, company, source, url, apply_url_canonical, ats FROM jobs WHERE id = ?',
    jobId,
  );
  return j ? { id: j.id, title: j.title, company: j.company, source: j.source, url: j.url, ats: j.ats } : null;
}

type Field = FormField & { meta?: { group?: { index: number; name: string }; eeo?: boolean; maxLength?: number; multi?: boolean; question?: string; cc?: string } };

const SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  glassdoor: 'Glassdoor',
  ziprecruiter: 'ZipRecruiter',
  wellfound: 'Wellfound',
  angellist: 'AngelList',
  hackernews: 'Hacker News',
  hn: 'Hacker News',
  reddit: 'Reddit',
  remoteok: 'Remote OK',
  weworkremotely: 'We Work Remotely',
  rozee: 'Rozee.pk',
  bayt: 'Bayt',
  google: 'Google',
};

const LONG_FORM = /\?$|^(why|what|how|describe|tell|explain|share|please (describe|tell|explain|share|provide)|give|list|briefly|in a few|anything else|additional information|is there anything)/i;
const ATTESTATION = /\b(authori[sz]ed to work|eligible to work|right to work|work permit|sponsor|visa|citizen|convicted|criminal|felony|clearance|non ?compete|at least 18|over 18|background check|drug (test|screen)|legally)\b/i;

function groupOf(f: Field): { name: 'work' | 'education' | null; index: number } {
  const g = f.meta?.group;
  const section = normText(f.section ?? '');
  if (g && (g.name === 'work' || g.name === 'education')) return { name: g.name, index: g.index };
  if (/\b(education|school|academic|university)\b/.test(section)) return { name: 'education', index: g?.index ?? 0 };
  if (/\b(work experience|employment|work history|experience|professional experience|previous (jobs|employment))\b/.test(section) && !/question/.test(section)) return { name: 'work', index: g?.index ?? 0 };
  return { name: null, index: 0 };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A date value shaped for the field: month name or year for split selects, raw text otherwise. */
function dateFor(raw: string, f: Field): string {
  if (!raw) return '';
  const l = f.labelNorm;
  const p = parseDate(raw);
  if (!p) return raw;
  if (/\bmonth\b/.test(l) && p.m) return f.options?.length ? (bestOption(MONTH_NAMES[p.m - 1], f.options, 0.6) ?? String(p.m)) : MONTH_NAMES[p.m - 1];
  if (/\byear\b/.test(l)) return String(p.y);
  return p.m ? `${p.y}-${String(p.m).padStart(2, '0')}${p.d ? `-${String(p.d).padStart(2, '0')}` : ''}` : String(p.y);
}

/** The profile value for a synonym key, or '' when the profile has none. */
export function profileValue(key: string, c: Candidate, f: Field, gi: number): string {
  const w = c.work[gi];
  const e = c.education[gi];
  switch (key) {
    case 'first_name':
    case 'preferred_name':
      return c.first;
    case 'last_name':
      return c.last;
    case 'middle_name':
      return c.middle;
    case 'full_name':
      return c.name;
    case 'email':
    case 'email_confirm':
      return c.email;
    case 'phone':
      return f.kind === 'phone' ? `+${c.phoneCc} ${c.phoneNational}`.trim() : c.phone;
    case 'phone_country_code':
      return f.options?.length ? (bestOption(`+${c.phoneCc}`, f.options, 0.8) ?? bestOption(c.phoneCountry, f.options, 0.8) ?? '') : `+${c.phoneCc}`;
    case 'phone_type':
      return 'Mobile';
    case 'linkedin':
      return c.linkedin;
    case 'github':
      return c.github;
    case 'portfolio':
      return c.portfolio || c.github;
    case 'twitter':
      return c.twitter;
    case 'other_url':
      return c.portfolio || c.github || c.linkedin;
    case 'location':
      return f.kind === 'location' && c.city ? [c.city, c.country].filter(Boolean).join(', ') : c.location;
    case 'city':
      return c.city;
    case 'state':
      return c.state;
    case 'country':
      return c.country;
    case 'current_company':
      return c.currentCompany;
    case 'current_title':
      return c.currentTitle;
    case 'resume_text':
      return c.cvText;
    case 'school':
      return (e ?? c.education[0])?.school ?? '';
    case 'degree': {
      const d = e ?? c.education[0];
      if (!d) return '';
      if (f.options?.length) return bestOption(d.degreeLevel, f.options, 0.6) ?? bestOption(d.degree, f.options, 0.6) ?? bestOption(degreeLevel(d.degree).replace(/'s Degree$/, ''), f.options, 0.6) ?? '';
      return d.degree;
    }
    case 'discipline':
      return (e ?? c.education[0])?.discipline ?? '';
    case 'edu_start':
      return dateFor((e ?? c.education[0])?.start ?? '', f);
    case 'edu_end':
      return dateFor((e ?? c.education[0])?.end ?? '', f);
    case 'work_company':
      return w?.company ?? '';
    case 'work_title':
      return w?.title ?? '';
    case 'work_location':
      return w?.location ?? '';
    case 'work_start':
      return w ? dateFor(w.start, f) : '';
    case 'work_end':
      return w && !w.current ? dateFor(w.end, f) : '';
    case 'work_current':
      return w ? String(w.current) : '';
    case 'work_description':
      return w?.description ?? '';
    default:
      return '';
  }
}

function howHeard(job: JobInfo | null, f: Field): string {
  const src = (job?.source ?? '').toLowerCase();
  const named = Object.entries(SOURCE_LABELS).find(([k]) => src.includes(k))?.[1];
  const prefs = [named, 'Company Website', 'Company Careers Page', 'Careers Page', 'Careers Site', 'Company Site', 'Website', 'Job Board', 'Online Job Board', 'Internet Search', 'Online', 'Internet', 'Other'].filter(Boolean) as string[];
  if (f.options?.length) {
    for (const p of prefs) {
      const hit = bestOption(p, f.options, 0.8);
      if (hit) return hit;
    }
    return '';
  }
  return named ?? 'Company careers page';
}

function val(f: Field, source: ValueSource, key: string, value: string, confidence: number, extra: Partial<MappedValue> = {}): MappedValue {
  return { fieldId: f.id, source, key, value, confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100, ...extra };
}

function unknown(f: Field, reason: string, extra: Partial<MappedValue> = {}): MappedValue {
  return { fieldId: f.id, source: 'generated', key: 'unknown', value: '', confidence: 0, unknown: true, reason, ...extra };
}

/** Fit a free value to the field's options (when it has any). Null = no honest option. */
function fit(f: Field, value: string, min = 0.75): string | null {
  if (!value) return null;
  if (!f.options?.length) return value;
  return bestOption(value, f.options, min);
}

/**
 * Map every field to a value. Pure apart from reads (profile, answer bank, and
 * the writer when `opts.writer`): it never records unknowns or writes anything.
 */
export async function mapFieldsWith(fields: FormField[], packet: ApplicationPacket | null, opts: MapOptions = {}): Promise<MappedValue[]> {
  const deps: MapDeps = {
    candidate: opts.deps?.candidate ?? (() => candidateMemo?.c ?? null),
    answerFor: opts.deps?.answerFor ?? realAnswerFor,
    answerQuestion: opts.deps?.answerQuestion === undefined ? realAnswerQuestion : opts.deps.answerQuestion,
  };
  const c = opts.deps?.candidate ? opts.deps.candidate() : await cachedCandidate();
  const cache = opts.cache ?? new Map<string, Answered | null>();
  const jobId = packet?.jobId ?? opts.job?.id;
  const job = opts.job ?? (jobId ? jobInfo(jobId) : null);
  const fileFields = fields.filter((f) => f.kind === 'file');

  const ask = async (f: Field): Promise<Answered | null> => {
    const k = `bank|${f.labelNorm}|${f.kind}|${(f.options ?? []).join('|')}`;
    if (cache.has(k)) return cache.get(k)!;
    const q = (f as Field).meta?.question && f.kind !== 'radio' ? `${(f as Field).meta!.question} ${f.label}` : f.label;
    const a = await deps.answerFor(q, { jobId, fieldKind: f.kind, options: f.options?.length ? f.options : undefined });
    cache.set(k, a);
    return a;
  };
  const write = async (f: Field): Promise<Answered | null> => {
    if (!opts.writer || !deps.answerQuestion || !jobId) return null;
    const k = `writer|${f.labelNorm}|${(f.options ?? []).join('|')}`;
    if (cache.has(k)) return cache.get(k)!;
    const maxChars = f.meta?.maxLength ?? (f.kind === 'text' ? 500 : undefined);
    const a = await deps.answerQuestion(jobId, f.label, { maxChars, options: f.options?.length ? f.options : undefined });
    cache.set(k, a);
    return a;
  };

  const out: MappedValue[] = [];
  for (const raw of fields) {
    const f = raw as Field;
    const v = await mapOne(f);
    if (v) out.push(v);
  }
  return out;

  async function mapOne(f: Field): Promise<MappedValue | null> {
    const g = groupOf(f);
    const ln = f.labelNorm || normLabel(f.label);
    const syn = matchSynonym(ln, g.name) ?? (f.meta?.question ? matchSynonym(normLabel(f.meta.question), g.name) : null);
    const e: SynEntry | null = syn?.entry ?? null;
    const optional = (reason: string) => (f.required ? unknown(f, reason) : null);

    // 1. Files.
    if (f.kind === 'file') {
      const wantsLetter = e?.key === 'cover_letter' || /cover|motivation|anschreiben/i.test(f.label);
      const wantsCv = e?.key === 'resume' || /resume|cv\b|curriculum|lebenslauf/i.test(f.label) || (fileFields.length === 1 && !wantsLetter);
      if (wantsLetter && packet?.letterPdfPath) return val(f, 'file', 'letter', packet.letterPdfPath, 0.97);
      if (wantsCv && packet?.cvPdfPath) return val(f, 'file', 'cv', packet.cvPdfPath, 0.97);
      if (!packet) return null;
      return optional(`Bureau has no "${f.label}" document to upload.`);
    }

    // 2. Voluntary self-identification: always decline.
    if (e?.source === 'eeo' || (f.meta?.eeo && !e && (f.options?.length ?? 0) > 0 && declineOption(f.options!))) {
      if (f.options?.length) {
        const d = declineOption(f.options);
        if (d) return val(f, 'generated', `eeo:${e?.key ?? 'decline'}`, d, 0.95, { synKey: e?.key });
        return optional('Voluntary demographic question with no decline option.');
      }
      if (f.kind === 'checkbox' || f.kind === 'consent') return null;
      return f.required ? val(f, 'generated', `eeo:${e?.key ?? 'decline'}`, 'Prefer not to say', 0.8, { synKey: e?.key }) : null;
    }

    // 3. Sensitive data: never entered by Bureau.
    if (e?.source === 'never') return optional(`Bureau never enters "${f.label}". It needs you.`);

    // 4. Consent / certification boxes.
    if (f.kind === 'consent' || ((f.kind === 'checkbox' && !f.options?.length) && e?.source === 'consent')) {
      if (e?.key === 'consent_marketing') return val(f, 'generated', 'consent:marketing', 'false', 0.95, { synKey: e.key });
      if (e?.key === 'certify_accurate' || e?.key === 'consent_privacy' || f.kind === 'consent') return val(f, 'generated', `consent:${e?.key ?? 'privacy'}`, 'true', 0.9, { synKey: e?.key });
    }

    // 5. Synonym keys.
    if (e) {
      switch (e.source) {
        case 'profile': {
          if (!c) break;
          let v = profileValue(e.key, c, f, g.index);
          if (e.key === 'work_current' && f.kind === 'checkbox') return v ? val(f, 'profile', e.key, v, 0.92, { synKey: e.key }) : null;
          if (v && f.options?.length && (f.kind === 'select' || f.kind === 'radio' || f.kind === 'combobox' || f.kind === 'checkbox')) v = fit(f, v, 0.6) ?? '';
          if (v) return val(f, 'profile', e.key, v, syn!.confidence * (g.name ? 0.95 : 1), { synKey: e.key });
          break;
        }
        case 'file': {
          if (e.key === 'cover_letter' && (f.kind === 'textarea' || f.kind === 'richtext') && packet?.coverLetter) return val(f, 'writer', 'coverLetter', packet.coverLetter, 0.95, { synKey: e.key });
          if (e.key === 'resume' && (f.kind === 'textarea' || f.kind === 'richtext') && c?.cvText) return val(f, 'profile', 'resume_text', c.cvText, 0.9, { synKey: e.key });
          if (e.key === 'resume' && (f.kind === 'url' || f.kind === 'text') && /link|url/i.test(f.label)) return optional('A link to the CV is not available.');
          break;
        }
        case 'generated': {
          const a = await ask(f);
          if (a && a.confidence >= MIN_CONFIDENCE) return val(f, a.source, a.key, a.value, a.confidence, { synKey: e.key });
          const v = howHeard(job, f);
          if (v) return val(f, 'generated', 'how_heard', v, 0.85, { synKey: e.key });
          break;
        }
        case 'bank': {
          const a = await ask(f);
          if (e.attestation) {
            if (a && a.source === 'answer_bank' && a.confidence >= MIN_CONFIDENCE) return val(f, a.source, a.key, a.value, a.confidence, { attestation: true, synKey: e.key });
            return f.required ? unknown(f, 'Legal attestation: only your own saved answer can answer it.', { attestation: true, synKey: e.key }) : null;
          }
          if (a && a.confidence >= MIN_CONFIDENCE) return val(f, a.source, a.key, a.value, a.confidence, { synKey: e.key });
          if (e.key === 'years_experience' && c && c.yearsExperience > 0) {
            const v = fit(f, String(Math.round(c.yearsExperience)), 0.8);
            if (v) return val(f, 'profile', 'yearsExperience', v, 0.8, { synKey: e.key });
          }
          if (e.key === 'referred_by' && !f.required) return null;
          return f.required ? unknown(f, 'Not in your answer bank yet.', { synKey: e.key }) : null;
        }
        default:
          break;
      }
    }

    // 6. Attestation-like wording without a dictionary hit: answer bank only.
    if (ATTESTATION.test(f.label)) {
      const a = await ask(f);
      if (a && a.source === 'answer_bank' && a.confidence >= MIN_CONFIDENCE) return val(f, a.source, a.key, a.value, a.confidence, { attestation: true });
      return f.required ? unknown(f, 'Legal attestation: only your own saved answer can answer it.', { attestation: true }) : null;
    }

    // 7. The answer bank.
    const a = await ask(f);
    if (a && a.confidence >= MIN_CONFIDENCE) return val(f, a.source, a.key, a.value, a.confidence);

    // 8. The writer, for long-form prose only.
    const prose = (f.kind === 'textarea' || f.kind === 'richtext' || (f.kind === 'text' && LONG_FORM.test(f.label.trim()) && f.label.split(' ').length >= 4)) && !f.options?.length;
    if (prose && (f.required || f.kind !== 'text')) {
      const w = await write(f);
      if (w && w.confidence >= MIN_CONFIDENCE) return val(f, 'writer', w.key, w.value, w.confidence);
      if (!f.required) return null;
    }
    if (a) return f.required ? unknown(f, `Low-confidence answer (${a.confidence}).`) : null;
    return optional('Nobody can answer this truthfully yet.');
  }
}

/** Contract surface: cheap and side-effect free (no writer calls unless asked). */
export async function mapFields(fields: FormField[], packet: ApplicationPacket, opts: MapOptions = {}): Promise<FieldValue[]> {
  return mapFieldsWith(fields, packet, opts);
}
