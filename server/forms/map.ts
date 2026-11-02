import type { FieldValue, FormField, ValueSource } from '../contracts/forms.ts';
import type { Answered } from '../contracts/profile.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { all, get } from '../db.ts';
import { loadProfile } from '../services/profileStore.ts';
import { type Candidate, candidateFrom, degreeLevel, DIAL_CODES } from './candidate.ts';
import { bestOption, declineOption, labelNorm as normLabel, normText, optionScore, parseDate, truthy } from './normalize.ts';
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
  /** All fields on the page (when mapping a subset). */
  context?: FormField[];
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
  } catch {
    // Not built, out of budget, or no recording in replay: the question stays unanswered.
    return null;
  }
}

export function jobInfo(jobId: string): JobInfo | null {
  const j = get<{ id: string; title: string; company: string; source: string; url: string; apply_url_canonical: string | null; ats: string | null }>(
    'SELECT id, title, company, source, url, apply_url_canonical, ats FROM jobs WHERE id = ?',
    jobId,
  );
  return j ? { id: j.id, title: j.title, company: j.company, source: j.source, url: j.url, ats: j.ats } : null;
}

type Field = FormField & { meta?: { group?: { index: number; name: string }; eeo?: boolean; maxLength?: number; multi?: boolean; multiple?: boolean; question?: string; cc?: string; hint?: string } };

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

/** Canonical wordings to retry in the answer bank when the form's own wording finds nothing. */
const ALT_QUESTIONS: Record<string, string[]> = {
  start_date: ['When can you start?', 'What is your earliest start date?', 'Available from'],
  notice_period: ['What is your notice period?'],
  salary_expectation: ['What are your salary expectations?'],
  salary_expectation_number: ['Expected annual salary (number only)', 'What are your salary expectations?'],
  current_salary: ['What is your current salary?'],
  sponsorship: ['Will you now or in the future require sponsorship for employment visa status?', 'Do you require visa sponsorship?'],
  how_heard: ['How did you hear about us?'],
  referred_by: ['Were you referred by a current employee?'],
  relocation: ['Are you willing to relocate?'],
  remote: ['Are you comfortable working fully remotely?', 'Are you open to hybrid or onsite work?'],
  timezone: ['What timezone are you in?'],
  languages: ['Which languages do you speak?'],
  previously_employed: ['Have you previously worked for this company?'],
  age_18: ['Are you at least 18 years of age?'],
  background_check: ['Do you consent to a background check if you receive an offer?'],
  years_experience: ['How many years of professional software engineering experience do you have?'],
  highest_education: ['What is your highest level of education?'],
  address_line: ['What is your street address?', 'Address line 1'],
  postal_code: ['What is your postal code?', 'Postal code'],
  state: ['What is your state or province?', 'State or province', 'Region'],
  graduation_date: ['When did you complete your degree?', 'When did you graduate?'],
};

const COUNTRY_WORDS: [string, RegExp][] = [
  ...Object.keys(DIAL_CODES).map((c) => [c, new RegExp(`\b${c}\b`)] as [string, RegExp]),
  ['united states', /\b(usa|u s a|u s|us|united states|america)\b(?! dollars?)/],
  ['united kingdom', /\b(uk|u k|great britain|britain|england)\b/],
  ['european union', /\b(eu|european union|europe|schengen)\b/],
  ['united arab emirates', /\buae\b/],
];

function countriesIn(s: string): Set<string> {
  const t = normText(s).replace(/\bwork for us\b|\bjoin us\b|\bwith us\b|\babout us\b|\bfor us\b|\bto us\b/g, ' ');
  return new Set(COUNTRY_WORDS.filter(([, re]) => re.test(t)).map(([c]) => c));
}

const STOP = new Set('a an and are as at be by can could do does for from have how i if in is it of on or our please the this to us we what when which will with would you your yourself now future currently'.split(' '));
const contentWords = (s: string) => new Set(normText(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));

/** Keys whose saved answers can be recognised by topic when the wording differs (dates especially). */
const KEY_TOPIC: Record<string, RegExp> = {
  start_date: /\b(start|available|availability|join|begin)\b/,
  notice_period: /\bnotice\b/,
  timezone: /\btime ?zone\b/,
  salary_expectation: /\bsalary|compensation\b/,
  salary_expectation_number: /\bsalary|compensation\b/,
};

/**
 * A direct read of the owner's answer bank (A03's table, read only) for when
 * `answerFor` returns nothing: the saved question with the closest wording
 * (content-word overlap ≥ 0.6), or one on the same topic for typed keys, whose
 * answer fits the field. Owner answers first.
 */
function bankLookup(f: Field, key: string | undefined, accept: (a: Answered) => boolean): Answered | null {
  let rows: { id: string; question_raw: string; answer: string; source: string }[];
  try {
    rows = all<{ id: string; question_raw: string; answer: string; source: string }>("SELECT id, question_raw, answer, source FROM answer_bank WHERE answer <> '' ORDER BY CASE source WHEN 'owner' THEN 0 ELSE 1 END, updated_at DESC");
  } catch {
    return null;
  }
  const lw = contentWords(f.label);
  const topic = key ? KEY_TOPIC[key] : undefined;
  const lc = countriesIn(f.label);
  let best: { a: Answered; score: number } | null = null;
  for (const r of rows) {
    const qw = contentWords(r.question_raw);
    let common = 0;
    for (const w of lw) if (qw.has(w)) common++;
    const jac = lw.size && qw.size ? common / (lw.size + qw.size - common) : 0;
    const onTopic = topic ? topic.test(normText(r.question_raw)) : false;
    if (jac < 0.6 && !onTopic) continue;
    // A question about one country never borrows an answer about another (or about none).
    const rc = countriesIn(r.question_raw);
    if (lc.size || rc.size) {
      if (lc.size !== rc.size || [...lc].some((x) => !rc.has(x))) continue;
    }
    const value = f.options?.length ? bestOption(r.answer, f.options, 0.75) : r.answer;
    if (!value) continue;
    const a: Answered = { value, source: 'answer_bank', confidence: r.source === 'owner' ? 0.9 : 0.82, key: r.id };
    if (!accept(a)) continue;
    const score = jac + (onTopic ? 0.5 : 0);
    if (!best || score > best.score) best = { a, score };
  }
  return best?.a ?? null;
}

/** "Years of professional experience" in the candidate's own field (not a named tool or skill). */
function broadExperience(labelN: string): boolean {
  const rest = labelN
    .replace(/\b(how many|years?|of|professional|relevant|total|overall|work|working|industry|experience|do|you|have|in|with|the|a|as|an|hands on|commercial|paid)\b/g, ' ')
    .replace(/\b(software|engineering|engineer|development|developer|programming|web|backend|back end|frontend|front end|full stack|fullstack|technical|tech|it|coding)\b/g, ' ')
    .trim();
  return rest === '';
}

function toNumber(v: string): string | null {
  const m = v.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k)?\b/i);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? String(n) : null;
}

const SHORT_KEYS: [string, RegExp][] = [
  ['why this role', /\bwhy (this|the|our) (role|position|job|opening)\b|\binterest(ed|s)? (you )?in (this|the) (role|position|job)\b|\bwhat (excites|interests|attracts) you about (this|the) (role|position|job)\b/],
  ['why us', /\bwhy (do you want to|would you like to|are you interested in|are you excited to) (work|join)\b|\bwhy (us|this company)\b|\bwhat (excites|interests|attracts|draws) you (about|to) (us|working|the company|joining)\b|\bwhy do you want to work\b|\bwhy .* interested in (working|joining)\b|^why us\b/],
  ['tell us about a project', /\b(project|something you (have |ve )?built|you (have |ve )?built or maintained|proud of|technical challenge|hardest (problem|bug)|recent work|a (service|system|bug) you|(service|system|pipeline|project|tool|app|application|api|feature) you (have |ve )?(built|maintained|worked on|shipped|designed))\b/],
  ['additional information', /\b(additional information|anything else|is there anything|other information|comments?|message to the hiring (manager|team)|hiring manager message)\b/],
];

/** A pre-written short answer from the packet (why us / why this role / a project / additional info). */
function shortAnswerFor(f: Field, packet: ApplicationPacket | null, job: JobInfo | null): { key: string; value: string } | null {
  if (!packet || f.options?.length || !(f.kind === 'textarea' || f.kind === 'richtext' || f.kind === 'text')) return null;
  let l = normText(f.label);
  if (job?.company) {
    l = l.replace(normText(job.company), 'us');
    const first = normText(job.company).split(' ')[0];
    if (first && first.length >= 4) l = l.replace(new RegExp(`\b${first}\b`), 'us');
  }
  const answers = new Map(Object.entries(packet.shortAnswers ?? {}).map(([k, v]) => [normText(k), v]));
  for (const [k, v] of answers) if (v && (l === k || l.includes(k))) return { key: `writer:${k}`, value: v };
  for (const [key, re] of SHORT_KEYS) {
    const v = answers.get(key);
    if (v && re.test(l)) return { key: `writer:${key}`, value: v };
  }
  // "Why Acme?" (the question itself; anything after the question mark is ignored).
  const head = normText(f.label.split('?')[0]);
  if (/^why [a-z0-9&]+( [a-z0-9&]+){0,2}$/.test(head) && !/\b(role|position|job|team)\b/.test(head) && answers.get('why us')) return { key: 'writer:why us', value: answers.get('why us')! };
  return null;
}

/**
 * Which repeating entry a field belongs to (work / education, 0-based index):
 * the extractor's group, then indexed names/ids ("exp_0_company",
 * "experience[1][title]", "workExperience-2--jobTitle"), then a numbered section
 * heading ("Position 2"), then a plain section ("Education").
 */
export function groupFor(f: FormField & { meta?: { group?: { index: number; name: string }; hint?: string }; selectors?: string[] }): { name: 'work' | 'education' | null; index: number } {
  const g = f.meta?.group;
  if (g && (g.name === 'work' || g.name === 'education')) return { name: g.name, index: g.index };
  const hint = `${(f.selectors ?? []).join(' ')} ${f.meta?.hint ?? ''}`;
  const kindOf = (w: string): 'work' | 'education' | null => (/^(edu|education|school|academic)/i.test(w) ? 'education' : /^(exp|experience|work|employment|job|position|history|workexperience)/i.test(w) ? 'work' : null);
  let m = hint.match(/(?:^|[#[\s"'_.-])(edu|education|school|exp|experience|work_?experience|workexperience|work|employment|job|position|history)s?(?:\[|_)(\d+)(?:\]|_)/i);
  if (m && kindOf(m[1])) return { name: kindOf(m[1]), index: Number(m[2]) };
  m = hint.match(/(?:^|[#[\s"'_.-])(education|workexperience|experience|employment|position)s?-(\d+)\b/i);
  if (m && kindOf(m[1])) return { name: kindOf(m[1]), index: Math.max(0, Number(m[2]) - 1) };
  // Un-numbered entry fields ("#education-school", "experience-title"): the entry being edited.
  m = hint.match(/(?:^|[#[\s"'.])(education|edu|experience|exp|work_?experience|employment)[-_](?!\d)/i);
  if (m && kindOf(m[1])) return { name: kindOf(m[1]), index: g?.index ?? 0 };
  const section = normText(f.section ?? '');
  const num = section.match(/(\d+)\s*$/);
  const idx = num ? Math.max(0, Number(num[1]) - 1) : (g?.index ?? 0);
  if (/\b(education|school|academic|university|degree)\b/.test(section)) return { name: 'education', index: idx };
  if (/\b(work experience|employment|work history|experience|professional experience|previous (jobs|employment)|position|job|employer|role)\b/.test(section) && !/question/.test(section)) return { name: 'work', index: idx };
  return { name: null, index: 0 };
}
const groupOf = (f: Field) => groupFor(f as never);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A date value shaped for the field: month name or year for split selects, raw text otherwise. */
function dateFor(raw: string, f: Field): string {
  if (!raw) return '';
  const l = f.labelNorm;
  const p = parseDate(raw);
  if (!p) return raw;
  const opts = f.options ?? [];
  const monthList = opts.filter((o) => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(o.trim())).length >= 6;
  const yearList = opts.filter((o) => /^\d{4}$/.test(o.trim())).length >= 5;
  if ((/\bmonth\b/.test(l) || monthList) && p.m) return opts.length ? (bestOption(MONTH_NAMES[p.m - 1], opts, 0.6) ?? String(p.m)) : MONTH_NAMES[p.m - 1];
  if (/\byear\b/.test(l) || yearList) return String(p.y);
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
      if (f.options?.length) return bestOption(d.degreeName, f.options, 0.85) ?? bestOption(d.degreeLevel, f.options, 0.6) ?? bestOption(d.degree, f.options, 0.6) ?? bestOption(degreeLevel(d.degree).replace(/'s Degree$/, ''), f.options, 0.6) ?? '';
      return d.degreeName || d.degree;
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

  const askRaw = async (q: string, f: Field): Promise<Answered | null> => {
    const k = `bank|${normText(q)}|${f.kind}|${(f.options ?? []).join('|')}`;
    if (cache.has(k)) return cache.get(k)!;
    const a = await deps.answerFor(q, { jobId, fieldKind: f.kind, options: f.options?.length ? f.options : undefined }).catch(() => null);
    cache.set(k, a);
    return a;
  };
  /** The answer bank for this field: its own wording first, then the canonical wordings of its key. */
  const ask = async (f: Field, key?: string, accept: (a: Answered) => boolean = () => true): Promise<Answered | null> => {
    const own = f.meta?.question && f.kind !== 'radio' ? `${f.meta.question} ${f.label}` : f.label;
    let best: Answered | null = null;
    for (const q of [own, ...(key ? (ALT_QUESTIONS[key] ?? []) : [])]) {
      const a = await askRaw(q, f);
      if (a && a.confidence >= MIN_CONFIDENCE && accept(a)) return a;
      if (a && !best) best = a;
    }
    if (best && accept(best)) return best;
    // The bank's own lookup could not fit this wording / these options: compare with the saved questions directly.
    return bankLookup(f, key, accept);
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
  // A phone input next to its own country picker takes the national number.
  const hasCountryPicker = [...fields, ...(opts.context ?? [])].some((o) => (o.kind === 'combobox' || o.kind === 'select') && (/\b(country|dial|calling) code\b/i.test(o.label) || (!!o.section && /phone|mobile/i.test(o.section) && /country/i.test(o.label))));

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
    let e: SynEntry | null = syn?.entry ?? null;
    const optional = (reason: string) => (f.required ? unknown(f, reason) : null);
    const choice = f.kind === 'select' || f.kind === 'radio' || f.kind === 'combobox' || f.kind === 'checkbox';
    // A checkbox only takes yes/no style keys from the dictionary.
    if (e && (f.kind === 'checkbox' || f.kind === 'consent') && !f.options?.length && e.source === 'profile' && e.key !== 'work_current') e = null;

    // 1. Files.
    if (f.kind === 'file') {
      const hint = `${f.label} ${f.meta?.hint ?? ''}`;
      const wantsLetter = e?.key === 'cover_letter' || /cover|motivation|anschreiben|coverletter/i.test(hint);
      const wantsCv = !wantsLetter && (e?.key === 'resume' || /resume|\bcv\b|[._[-]cv\b|curriculum|lebenslauf/i.test(hint) || (fileFields.length === 1 && !/photo|avatar|picture|transcript|portfolio/i.test(hint)));
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
      // Options appear only when the menu opens: the handler picks the decline option.
      if (f.kind === 'combobox') return val(f, 'generated', `eeo:${e?.key ?? 'decline'}`, 'Decline to self-identify', 0.9, { synKey: e?.key });
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
          if (e.key === 'skills') {
            // Only skills the profile really lists.
            if (f.options?.length) {
              const hits = f.options.filter((o) => c.skills.some((sk) => optionScore(sk, o) >= 0.9));
              const single = f.kind === 'radio' || (f.kind === 'select' && !f.meta?.multiple);
              if (hits.length) return val(f, 'profile', 'skills', single ? hits[0] : hits.join('; '), 0.9, { synKey: e.key });
              return optional('None of the listed options is in your profile.');
            }
            if (f.kind === 'combobox') {
              const want = c.skills.slice(0, 6).join('; ');
              return want ? val(f, 'profile', 'skills', want, 0.85, { synKey: e.key }) : null;
            }
            if (f.kind === 'text' || f.kind === 'textarea') return c.skills.length ? val(f, 'profile', 'skills', c.skills.slice(0, 10).join(', '), 0.85, { synKey: e.key }) : null;
            break;
          }
          if (e.key === 'summary') {
            if ((f.kind === 'textarea' || f.kind === 'richtext' || f.kind === 'text') && c.summary) return val(f, 'profile', 'summary', c.summary, 0.9, { synKey: e.key });
            break;
          }
          let v = profileValue(e.key, c, f, g.index);
          if (e.key === 'phone' && hasCountryPicker && f.kind !== 'phone') v = c.phoneNational;
          if (e.key === 'work_current' && f.kind === 'checkbox') return v ? val(f, 'profile', e.key, v, 0.92, { synKey: e.key }) : null;
          if (v && f.options?.length && choice) v = fit(f, v, 0.6) ?? '';
          if (v) return val(f, 'profile', e.key, v, syn!.confidence * (g.name ? 0.95 : 1), { synKey: e.key });
          // Not in the profile: the owner may have answered it in the bank (a region, a postal address).
          if (!v && !e.group && ['state', 'city', 'country', 'location', 'middle_name', 'preferred_name'].includes(e.key) && f.required) {
            const b = await ask(f, e.key);
            if (b && b.confidence >= MIN_CONFIDENCE) return val(f, b.source, b.key, b.value, b.confidence, { synKey: e.key });
          }
          // The current job has no end date: leave it empty (the form hides or ignores it once "currently work here" is set).
          if (e.key === 'work_end' && c.work[g.index]?.current) return null;
          // Entry fields with nothing in the profile (a missing entry) stay empty.
          if (e.group) return f.required ? unknown(f, 'Not in your profile.', { synKey: e.key }) : null;
          break;
        }
        case 'file': {
          if (e.key === 'cover_letter' && (f.kind === 'textarea' || f.kind === 'richtext') && packet?.coverLetter) return val(f, 'writer', 'coverLetter', packet.coverLetter, 0.95, { synKey: e.key });
          if (e.key === 'resume' && (f.kind === 'textarea' || f.kind === 'richtext') && c?.cvText) return val(f, 'profile', 'resume_text', c.cvText, 0.9, { synKey: e.key });
          if (e.key === 'resume' && (f.kind === 'url' || f.kind === 'text') && /link|url/i.test(f.label)) return optional('A link to the CV is not available.');
          break;
        }
        case 'generated': {
          if (e.key === 'date_today') {
            if (f.kind !== 'date' && f.kind !== 'text') break;
            const d = new Date();
            return val(f, 'generated', 'date_today', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, 0.9, { synKey: e.key });
          }
          const a = await ask(f, e.key);
          if (a && a.confidence >= MIN_CONFIDENCE) return val(f, a.source, a.key, a.value, a.confidence, { synKey: e.key });
          const v = howHeard(job, f);
          if (v) return val(f, 'generated', 'how_heard', v, 0.85, { synKey: e.key });
          break;
        }
        case 'bank': {
          // "Address" alone, or an address typeahead, is where the candidate lives.
          if (e.key === 'address_line' && c?.location && (ln === 'address' || f.kind === 'location' || f.kind === 'combobox')) {
            const where = f.kind === 'location' || f.kind === 'combobox' ? [c.city, c.country].filter(Boolean).join(', ') || c.location : c.location;
            return val(f, 'profile', 'location', where, 0.85, { synKey: e.key });
          }
          const key = e.key;
          const money = /salary|compensation|pay|ctc/.test(key);
          const numeric = f.kind === 'number' || /\((usd|eur|gbp|pkr|number|numbers? only|amount)\)|\bnumber only\b|\bin (usd|eur|gbp)\b/i.test(f.label);
          // A start date in a free date field must be a date ("2 weeks" is a notice period, not a date).
          const wantsDate = f.kind === 'date' || ((key === 'start_date' || key === 'graduation_date') && !f.options?.length);
          const accept = (x: Answered) => (wantsDate ? !!parseDate(x.value) : numeric && money ? /\d/.test(x.value) : true);
          const a = await ask(f, numeric && money ? `${key}_number` : key, accept);
          if (e.attestation) {
            if (a && a.source === 'answer_bank' && a.confidence >= MIN_CONFIDENCE) return val(f, a.source, a.key, a.value, a.confidence, { attestation: true, synKey: key });
            return f.required ? unknown(f, 'Legal attestation: only your own saved answer can answer it.', { attestation: true, synKey: key }) : null;
          }
          // "Were you referred?" -> "No" is not a referrer's name or code.
          if (a && key === 'referred_by' && !f.options?.length && truthy(a.value) === false) return null;
          if (a && a.confidence >= MIN_CONFIDENCE) {
            let v = a.value;
            if (numeric && money) v = toNumber(v) ?? v;
            return val(f, a.source, a.key, v, a.confidence, { synKey: key });
          }
          if (key === 'years_experience' && c && c.yearsExperience > 0 && broadExperience(ln)) {
            const v = f.options?.length ? fit(f, String(Math.round(c.yearsExperience)), 0.8) : String(Math.round(c.yearsExperience));
            if (v) return val(f, 'profile', 'yearsExperience', v, 0.8, { synKey: key });
          }
          if (key === 'graduation_date' && c?.education[0]?.end) return val(f, 'profile', 'edu_end', dateFor(c.education[0].end, f), 0.85, { synKey: key });
          if (key === 'referred_by' && !f.required) return null;
          return f.required ? unknown(f, 'Not in your answer bank yet.', { synKey: key }) : null;
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
    const a = await ask(f, f.kind === 'date' && /\b(start|available|availability|join|begin)\b/i.test(f.label) ? 'start_date' : undefined, (x) => f.kind !== 'date' || !!parseDate(x.value));
    if (a && a.confidence >= MIN_CONFIDENCE) return val(f, a.source, a.key, a.value, a.confidence);

    // 8. The packet's pre-written answers, then the writer, for long-form prose only.
    const short = shortAnswerFor(f, packet, job);
    if (short) return val(f, 'writer', short.key, short.value, 0.9);
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
