import crypto from 'node:crypto';
import { z } from 'zod/v4';
import { AnswerScope, type AnswerEntry, type Answered } from '../contracts/profile.ts';
import { cosine, embed, embedStatus, HASH_MODEL } from '../ai/embed.ts';
import { all, get, getSetting, now, run, setSetting, tx } from '../db.ts';
import { AppError } from '../errors.ts';
import { loadProfile, type Profile } from '../services/profileStore.ts';
import { getLinks } from './links.ts';
import {
  canonicalCountry,
  cleanQuestion,
  contentWords,
  detectCountries,
  detectCurrency,
  detectIntent,
  fuzzyText,
  jaccard,
  normalizeQuestion,
  type Intent,
} from './questions.ts';
import { bump } from './state.ts';
import { parseJson, sha } from './text.ts';

/**
 * The answer bank: standing answers to the questions application forms ask
 * again and again. `answerFor` resolves a form question by exact normalised
 * match, then by intent (same meaning, compatible slot), then from the profile
 * itself, then fuzzily by embeddings, always respecting each answer's scope
 * (country, job type, ATS). It returns null rather than guess.
 */

export type Scope = z.infer<typeof AnswerScope>;

interface Row {
  id: string;
  question_norm: string;
  question_raw: string;
  answer: string;
  scope: string;
  source: 'owner' | 'derived';
  created_at: string;
  updated_at: string;
}

const toEntry = (r: Row): AnswerEntry => ({
  id: r.id,
  questionNorm: r.question_norm,
  questionRaw: r.question_raw,
  answer: r.answer,
  scope: AnswerScope.catch({}).parse(parseJson(r.scope, {})),
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function cleanScope(scope: Scope | undefined): Scope {
  const out: Scope = {};
  const countries = [...new Set((scope?.countries ?? []).map(canonicalCountry).filter(Boolean))].sort();
  const jobTypes = [...new Set((scope?.jobTypes ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
  const ats = [...new Set((scope?.ats ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
  if (countries.length) out.countries = countries;
  if (jobTypes.length) out.jobTypes = jobTypes;
  if (ats.length) out.ats = ats;
  return out;
}

const scopeKey = (s: Scope) => JSON.stringify(cleanScope(s));

export function listAnswers(): (AnswerEntry & { intent: string | null; placeholder: boolean })[] {
  ensureSeeded();
  return all<Row>('SELECT * FROM answer_bank ORDER BY (answer = \'\'), source, question_raw').map((r) => {
    const e = toEntry(r);
    return { ...e, intent: detectIntent(e.questionRaw)?.key ?? null, placeholder: !e.answer.trim() };
  });
}

export function getAnswer(id: string): AnswerEntry | null {
  const r = get<Row>('SELECT * FROM answer_bank WHERE id = ?', id);
  return r ? toEntry(r) : null;
}

export const AnswerInput = z.object({
  question: z.string().trim().min(2).max(1000),
  answer: z.string().trim().max(4000),
  scope: AnswerScope.optional(),
});

/** Add an owner answer, or update the owner answer with the same question and scope. */
export function upsertAnswer(input: z.input<typeof AnswerInput>, source: 'owner' | 'derived' = 'owner'): AnswerEntry {
  const v = AnswerInput.parse(input);
  migrateNorms();
  const norm = normalizeQuestion(v.question);
  const scope = cleanScope(v.scope);
  const ts = now();
  const same = all<Row>('SELECT * FROM answer_bank WHERE question_norm = ?', norm).filter((r) => scopeKey(parseJson(r.scope, {})) === scopeKey(scope));
  const owned = same.find((r) => r.source === 'owner');
  const target = source === 'owner' ? (owned ?? same[0]) : same.find((r) => r.source === 'derived');
  if (source === 'derived' && owned?.answer.trim()) return toEntry(owned);
  let id: string;
  tx(() => {
    if (target) {
      id = target.id;
      run('UPDATE answer_bank SET question_raw = ?, answer = ?, source = ?, updated_at = ? WHERE id = ?', v.question, v.answer, source, ts, id);
      // One answer per question+scope: the owner's replaces any derived twin.
      for (const r of same) if (r.id !== id) run('DELETE FROM answer_bank WHERE id = ?', r.id);
    } else {
      id = crypto.randomUUID();
      run(
        'INSERT INTO answer_bank (id, question_norm, question_raw, answer, scope, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        norm,
        v.question,
        v.answer,
        JSON.stringify(scope),
        source,
        ts,
        ts,
      );
    }
  });
  bump();
  return getAnswer(id!)!;
}

export const AnswerPatch = z.object({
  question: z.string().trim().min(2).max(1000).optional(),
  answer: z.string().trim().max(4000).optional(),
  scope: AnswerScope.optional(),
});

/** The owner edits an entry. Editing a derived answer makes it the owner's. */
export function updateAnswer(id: string, patch: z.input<typeof AnswerPatch>): AnswerEntry {
  const p = AnswerPatch.parse(patch);
  const cur = getAnswer(id);
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'No such answer');
  const question = p.question ?? cur.questionRaw;
  const scope = cleanScope(p.scope ?? cur.scope);
  run(
    "UPDATE answer_bank SET question_raw = ?, question_norm = ?, answer = ?, scope = ?, source = 'owner', updated_at = ? WHERE id = ?",
    question,
    normalizeQuestion(question),
    p.answer ?? cur.answer,
    JSON.stringify(scope),
    now(),
    id,
  );
  bump();
  return getAnswer(id)!;
}

export function deleteAnswer(id: string) {
  const cur = getAnswer(id);
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'No such answer');
  run('DELETE FROM answer_bank WHERE id = ?', id);
  // A deleted seed stays deleted: re-seeding skips questions the owner removed.
  const dismissed = new Set(getSetting<string[]>(DISMISSED_KEY, []));
  dismissed.add(cur.questionNorm);
  setSetting(DISMISSED_KEY, [...dismissed]);
  bump();
}

// ── Seeding ──────────────────────────────────────────────────────────────────

const SEED_KEY = 'profile.answerSeed';
const DISMISSED_KEY = 'profile.answerSeedDismissed';
const SEED_VERSION = 2;
const NORM_KEY = 'profile.answerNormVersion';

let normsChecked = false;

/**
 * Version 1 stored notice-period questions under the start-date key ("start date"). Re-key those rows once by
 * their own wording, so a saved notice period keeps resolving and saving a start date no longer replaces it.
 */
export function migrateNorms(force = false) {
  if (normsChecked && !force) return;
  normsChecked = true;
  if (getSetting<number>(NORM_KEY, 1) >= 2) return;
  tx(() => {
    for (const r of all<Row>("SELECT * FROM answer_bank WHERE question_norm = 'start date'")) {
      const norm = normalizeQuestion(r.question_raw);
      if (norm !== r.question_norm) run('UPDATE answer_bank SET question_norm = ? WHERE id = ?', norm, r.id);
    }
    // The owner deleted the old combined "notice period / earliest start date" seed: both halves stay deleted.
    const dismissed = getSetting<string[]>(DISMISSED_KEY, []);
    if (dismissed.includes('start date') && !dismissed.includes('notice period')) setSetting(DISMISSED_KEY, [...dismissed, 'notice period']);
    setSetting(NORM_KEY, 2);
  });
}

/** Common questions the owner fills once. Each normalises to a distinct intent. */
export const COMMON_QUESTIONS: string[] = [
  'Are you legally authorized to work in the country where this job is located?',
  'Will you now or in the future require visa sponsorship?',
  'What is your notice period?',
  'What is your earliest start date?',
  'What are your salary expectations?',
  'What is your expected salary in USD?',
  'What is your expected salary in EUR?',
  'What is your expected salary in GBP?',
  'What is your current salary?',
  'Are you willing to relocate?',
  'Are you open to working on-site or hybrid?',
  'Are you comfortable working remotely?',
  'What time zone are you in?',
  'How many hours of overlap can you offer with the team’s time zone?',
  'When did you (or will you) complete your degree?',
  'What is your highest level of education?',
  'How did you hear about this position?',
  'Were you referred by a current employee?',
  'Have you previously worked for this company?',
  'Are you at least 18 years old?',
  'Are you willing to undergo a background check?',
  'Are you willing to travel for work?',
  'What languages do you speak, and at what level?',
  'Do you hold a valid driving licence?',
  'Are you open to contract or freelance work?',
  'Are you bound by a non-compete or other restrictive covenant?',
  'Are you available to work full-time?',
  'Do you hold an active security clearance?',
  'Are you willing to work weekends or shifts?',
];

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

/** Standing answers that come straight from the preference fields the owner already filled. */
export function derivedFromPreferences(p: Profile | null): { question: string; answer: string }[] {
  if (!p) return [];
  const pr = p.preferences;
  const out: { question: string; answer: string }[] = [];
  if (pr.workAuthorization.trim()) {
    out.push({ question: 'Are you legally authorized to work in the country where this job is located?', answer: pr.workAuthorization.trim() });
    // A legal attestation: only derived once the owner has filled the work-eligibility section, never from a default.
    out.push({ question: 'Will you now or in the future require visa sponsorship?', answer: yesNo(pr.needsSponsorship) });
  }
  // The notice period only: start-date questions fall back to it in words (see answerFor), never as a date.
  if (pr.noticePeriod.trim()) out.push({ question: 'What is your notice period?', answer: pr.noticePeriod.trim() });
  if (pr.salaryExpectation.trim()) out.push({ question: 'What are your salary expectations?', answer: pr.salaryExpectation.trim() });
  out.push({ question: 'Are you willing to relocate?', answer: yesNo(pr.openToRelocation) });
  if (pr.remoteOnly) out.push({ question: 'Are you open to working on-site or hybrid?', answer: 'No, I am looking for remote roles only.' });
  out.push(...parseExtraAnswers(pr.extraAnswers));
  return out;
}

/** "Q: … / A: …" pairs, "Question? Answer" lines and "Label: value" lines from the free-text extra answers. */
export function parseExtraAnswers(text: string): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const q = l.match(/^q(?:uestion)?\s*[:.)-]\s*(.+)$/i);
    if (q) {
      const a = lines[i + 1]?.match(/^a(?:nswer)?\s*[:.)-]\s*(.+)$/i);
      if (a) {
        out.push({ question: q[1], answer: a[1] });
        i++;
      }
      continue;
    }
    const qm = l.match(/^(.{4,200}?\?)\s*(.+)$/);
    if (qm) {
      out.push({ question: qm[1], answer: qm[2].replace(/^[-–:]\s*/, '') });
      continue;
    }
    const kv = l.match(/^([^:]{3,80}):\s*(.+)$/);
    if (kv && !/^https?$/i.test(kv[1])) out.push({ question: kv[1], answer: kv[2] });
  }
  return out.filter((x) => x.answer.trim().length > 0);
}

/**
 * Keep the seeded questions and preference-derived answers in the bank. Cheap
 * when nothing changed (one settings read), so it can run on every lookup.
 */
export function ensureSeeded(force = false) {
  migrateNorms();
  const profile = loadProfile();
  const derived = derivedFromPreferences(profile);
  const skills = (profile?.coreStack ?? []).slice(0, 6);
  const fingerprint = sha(JSON.stringify({ v: SEED_VERSION, derived, skills }));
  if (!force && getSetting<string>(SEED_KEY, '') === fingerprint) return;
  const dismissed = new Set(getSetting<string[]>(DISMISSED_KEY, []));
  tx(() => {
    const ts = now();
    const derivedNorms = new Set<string>();
    for (const d of derived) {
      const norm = normalizeQuestion(d.question);
      derivedNorms.add(norm);
      const rows = all<Row>("SELECT * FROM answer_bank WHERE question_norm = ? AND scope = '{}'", norm);
      if (rows.some((r) => r.source === 'owner' && r.answer.trim())) continue;
      for (const r of rows) if (r.source === 'owner') run('DELETE FROM answer_bank WHERE id = ?', r.id); // an empty placeholder gives way
      const cur = rows.find((r) => r.source === 'derived');
      if (cur) {
        if (cur.answer !== d.answer) run('UPDATE answer_bank SET answer = ?, question_raw = ?, updated_at = ? WHERE id = ?', d.answer, d.question, ts, cur.id);
      } else {
        run(
          "INSERT INTO answer_bank (id, question_norm, question_raw, answer, scope, source, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', 'derived', ?, ?)",
          crypto.randomUUID(),
          norm,
          d.question,
          d.answer,
          ts,
          ts,
        );
      }
    }
    // A preference the owner cleared takes its derived answer with it.
    for (const r of all<Row>("SELECT * FROM answer_bank WHERE source = 'derived'")) if (!derivedNorms.has(r.question_norm)) run('DELETE FROM answer_bank WHERE id = ?', r.id);

    const placeholders = [...COMMON_QUESTIONS, ...skills.map((s) => `How many years of experience do you have with ${s}?`)];
    for (const q of placeholders) {
      const norm = normalizeQuestion(q);
      if (dismissed.has(norm) || get('SELECT 1 FROM answer_bank WHERE question_norm = ?', norm)) continue;
      run(
        "INSERT INTO answer_bank (id, question_norm, question_raw, answer, scope, source, created_at, updated_at) VALUES (?, ?, ?, '', '{}', 'owner', ?, ?)",
        crypto.randomUUID(),
        norm,
        q,
        ts,
        ts,
      );
    }
  });
  setSetting(SEED_KEY, fingerprint);
  bump();
}

// ── Job context and scope ────────────────────────────────────────────────────

export interface JobContext {
  countries: string[];
  jobTypes: string[];
  ats: string | null;
}

export function jobContext(jobId: string | undefined | null): JobContext | null {
  if (!jobId) return null;
  const j = get<{ title: string; location: string | null; remote: number; ats: string | null; description_text: string | null }>(
    'SELECT title, location, remote, ats, description_text FROM jobs WHERE id = ?',
    jobId,
  );
  if (!j) return null;
  const title = j.title.toLowerCase();
  const loc = j.location ?? '';
  const types = new Set<string>();
  if (/\bintern(ship)?\b/.test(title)) types.add('internship');
  if (/\b(contract|contractor|freelance)\b/.test(title)) types.add('contract');
  if (/\bpart[- ]time\b/.test(title)) types.add('part-time');
  if (!types.size) types.add('full-time');
  if (j.remote) types.add('remote');
  if (/\bhybrid\b/i.test(`${loc} ${title}`)) types.add('hybrid');
  else if (!j.remote) types.add('onsite');
  return { countries: detectCountries(loc), jobTypes: [...types], ats: j.ats?.toLowerCase() ?? null };
}

/**
 * Does this entry apply here? Returns how specific the match is (0 = unscoped),
 * or -1 when the entry is scoped to somewhere/something else.
 */
function scopeFit(e: AnswerEntry, entryIntent: Intent | null, ctx: { countries: string[]; jobTypes: string[]; ats: string | null }): number {
  let score = 0;
  // A country named in the stored question ("right to work in the UK") scopes it like an explicit scope would.
  const countries = e.scope.countries?.length ? e.scope.countries : (entryIntent?.countries ?? []);
  if (countries.length) {
    if (!countries.some((c) => ctx.countries.includes(c))) return -1;
    score++;
  }
  if (e.scope.jobTypes?.length) {
    if (!e.scope.jobTypes.some((t) => ctx.jobTypes.includes(t))) return -1;
    score++;
  }
  if (e.scope.ats?.length) {
    if (!ctx.ats || !e.scope.ats.includes(ctx.ats)) return -1;
    score++;
  }
  return score;
}

function slotsCompatible(q: Intent, e: Intent, entry: AnswerEntry): boolean {
  if (q.key !== e.key) return false;
  if ((q.skill ?? '') !== (e.skill ?? '')) return false;
  if (q.key === 'expected_salary' || q.key === 'current_salary') {
    const ec = e.currency ?? detectCurrency(entry.answer);
    if (q.currency && ec && q.currency !== ec) return false;
  }
  return true;
}

// ── Options ──────────────────────────────────────────────────────────────────

const YES = /^(yes|y|true|i am|i do|i will|i can|i have|sure|absolutely|correct|definitely|of course)\b/;
const NO = /^(no|n|false|i am not|i do not|i will not|i can not|i have not|not|never|none)\b/;

function parseRange(opt: string): [number, number] | null {
  const o = cleanQuestion(opt);
  let m = o.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = o.match(/(\d+(?:\.\d+)?)\s*(?:\+|or more|and above|plus)|(?:more than|over|above|at least)\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const n = Number(m[1] ?? m[2]);
    return [/more than|over|above/.test(o) ? n + 1e-9 : n, Infinity];
  }
  m = o.match(/(?:less than|under|below|fewer than)\s*(\d+(?:\.\d+)?)/);
  if (m) return [-Infinity, Number(m[1]) - 1e-9];
  m = o.match(/^(\d+(?:\.\d+)?)(?:\s*(?:years?|yrs?|months?))?$/);
  if (m) return [Number(m[1]), Number(m[1])];
  return null;
}

/** Map a stored answer onto a select's options. Null when no option honestly says the same thing. */
export function matchOption(value: string, options: string[]): string | null {
  const opts = options.map((o) => o.trim()).filter(Boolean);
  if (!opts.length) return value;
  const v = cleanQuestion(value);
  const exact = opts.find((o) => cleanQuestion(o) === v);
  if (exact) return exact;
  const yes = YES.test(v);
  const no = !yes && NO.test(v);
  if (yes || no) {
    const hit = opts.find((o) => (yes ? YES : NO).test(cleanQuestion(o)));
    if (hit) return hit;
  }
  const num = v.match(/^(?:about |around |approximately |over )?(\d+(?:\.\d+)?)/);
  if (num) {
    const n = Number(num[1]);
    const hit = opts.find((o) => {
      const r = parseRange(o);
      return r && n >= r[0] && n <= r[1];
    });
    if (hit) return hit;
  }
  const contained = opts.filter((o) => {
    const c = cleanQuestion(o);
    return c.length >= 2 && (` ${v} `.includes(` ${c} `) || ` ${c} `.includes(` ${v} `));
  });
  if (contained.length) return contained.sort((a, b) => b.length - a.length)[0];
  const vw = contentWords(value);
  let best: { o: string; s: number } | null = null;
  for (const o of opts) {
    const s = jaccard(vw, contentWords(o));
    if (s >= 0.5 && (!best || s > best.s)) best = { o, s };
  }
  return best?.o ?? null;
}

// ── answerFor ────────────────────────────────────────────────────────────────

const embedCache = new Map<string, Float32Array>();

/** Embeddings for question texts, cached per model (the answer bank's questions are embedded once per process). */
async function vectors(texts: string[]): Promise<{ model: string; get: (t: string) => Float32Array }> {
  const uniq = [...new Set(texts)];
  const { model } = await embedStatus();
  const missing = uniq.filter((t) => !embedCache.has(`${model}|${t}`));
  if (missing.length) {
    if (embedCache.size > 5000) embedCache.clear();
    let out = await embed(missing);
    let batch = missing;
    // The model fell back mid-flight: vectors from different models never mix, so redo the lot.
    if (out.model !== model) {
      batch = uniq;
      out = await embed(uniq);
    }
    batch.forEach((t, i) => embedCache.set(`${out.model}|${t}`, out.vectors[i]));
    return { model: out.model, get: (t) => embedCache.get(`${out.model}|${t}`)! };
  }
  return { model, get: (t) => embedCache.get(`${model}|${t}`)! };
}

/** Fuzzy acceptance thresholds per embedding model (the hash fallback is cruder, so it leans on word overlap). */
const FUZZY = {
  [HASH_MODEL]: { cos: 0.55, words: 0.5 },
  default: { cos: 0.8, words: 0.34 },
};

export interface AnswerContext {
  jobId?: string;
  fieldKind?: string;
  options?: string[];
}

interface Candidate {
  entry: AnswerEntry;
  intent: Intent | null;
  fit: number;
}

function finish(value: string, ctx: AnswerContext): string | null {
  const v = value.trim();
  if (!v) return null;
  if (ctx.options?.length) return matchOption(v, ctx.options);
  return v;
}

function profileAnswer(intent: Intent | null, raw: string, ctx: AnswerContext): Answered | null {
  const p = loadProfile();
  if (!p || !intent) return null;
  const links = getLinks(p);
  const pick = (value: string, key: string, confidence: number): Answered | null => {
    const v = finish(value, ctx);
    return v ? { value: v, source: 'profile', confidence, key } : null;
  };
  switch (intent.key) {
    case 'linkedin':
      return links.linkedin ? pick(links.linkedin, 'profile.links.linkedin', 0.95) : null;
    case 'github':
      return links.github ? pick(links.github, 'profile.links.github', 0.95) : null;
    case 'portfolio':
      return links.portfolio ? pick(links.portfolio, 'profile.links.portfolio', 0.9) : null;
    case 'current_location':
      return p.location ? pick(p.location, 'profile.location', 0.9) : null;
    case 'full_name':
      return p.name ? pick(p.name, 'profile.name', 0.95) : null;
    case 'email':
      return p.email ? pick(p.email, 'profile.email', 0.95) : null;
    case 'phone':
      return p.phone ? pick(p.phone, 'profile.phone', 0.95) : null;
    case 'years_experience':
      if (intent.skill || !/\b(professional|total|work|overall|industry)\b|^how many years of experience/.test(cleanQuestion(raw))) return null;
      return p.yearsExperience > 0 ? pick(String(Math.round(p.yearsExperience * 10) / 10), 'profile.yearsExperience', 0.8) : null;
    default:
      return null;
  }
}

export async function answerFor(question: string, ctx: AnswerContext = {}): Promise<Answered | null> {
  if (!question.trim()) return null;
  ensureSeeded();
  const norm = normalizeQuestion(question);
  const qIntent = detectIntent(question);
  const job = jobContext(ctx.jobId);
  const where = {
    countries: [...new Set([...(job?.countries ?? []), ...(qIntent?.countries ?? [])])],
    jobTypes: job?.jobTypes ?? [],
    ats: job?.ats ?? null,
  };

  const candidates: Candidate[] = [];
  for (const r of all<Row>("SELECT * FROM answer_bank WHERE answer <> ''")) {
    const entry = toEntry(r);
    const intent = detectIntent(entry.questionRaw);
    const fit = scopeFit(entry, intent, where);
    if (fit >= 0) candidates.push({ entry, intent, fit });
  }

  // 1–2. Same question (word for word, then exact normalised form) or same intent with a compatible slot.
  // Several stored wordings can share an intent ("When can you start?", "Earliest start date"), so the wording breaks the tie.
  const sameWords = cleanQuestion(question);
  const preferred = (a: Candidate & { kind: number }, b: Candidate & { kind: number }) =>
    b.fit - a.fit || b.kind - a.kind || (a.entry.source === 'owner' ? -1 : 1) - (b.entry.source === 'owner' ? -1 : 1) || b.entry.updatedAt.localeCompare(a.entry.updatedAt);
  const confident = candidates
    .map((c) => ({ ...c, kind: cleanQuestion(c.entry.questionRaw) === sameWords ? 3 : c.entry.questionNorm === norm ? 2 : qIntent && c.intent && slotsCompatible(qIntent, c.intent, c.entry) ? 1 : 0 }))
    .filter((c) => c.kind > 0)
    .sort(preferred);
  // A start-date question with no start date saved: the notice period answers it in words ("Two weeks"), a notch less
  // certain and only after every real start-date answer. A date field still skips it below (never "2 weeks" in a date).
  const notice = qIntent?.key === 'start_date' ? candidates.filter((c) => c.intent?.key === 'notice_period').map((c) => ({ ...c, kind: 0 })).sort(preferred) : [];
  for (const c of [...confident, ...notice]) {
    const value = finish(c.entry.answer, ctx);
    if (!value) continue;
    // A date field needs a date, not "2 weeks".
    if (ctx.fieldKind === 'date' && Number.isNaN(Date.parse(value))) continue;
    let confidence = c.kind >= 2 ? 0.97 : c.kind === 1 ? 0.92 : 0.9;
    if (c.entry.source === 'derived') confidence -= 0.08;
    if (qIntent?.currency && !(c.intent?.currency ?? detectCurrency(c.entry.answer))) confidence -= 0.1;
    return { value, source: 'answer_bank', confidence: Math.round(confidence * 100) / 100, key: c.entry.id };
  }

  // 3. Straight from the profile (links, name, location, overall years).
  const fromProfile = profileAnswer(qIntent, question, ctx);
  if (fromProfile) return fromProfile;

  // 4. Fuzzy: only between questions with no recognised intent (an intent mismatch is a different question).
  if (qIntent) return null;
  const pool = candidates.filter((c) => !c.intent);
  if (!pool.length) return null;
  const qText = fuzzyText(question);
  const qWords = contentWords(question);
  const { model, get: vec } = await vectors([qText, ...pool.map((c) => fuzzyText(c.entry.questionRaw))]);
  const t = model === HASH_MODEL ? FUZZY[HASH_MODEL] : FUZZY.default;
  const scored = pool
    .map((c) => ({ c, cos: cosine(vec(qText), vec(fuzzyText(c.entry.questionRaw))), words: jaccard(qWords, contentWords(c.entry.questionRaw)) }))
    .filter((s) => s.cos >= t.cos && s.words >= t.words)
    .sort((a, b) => b.c.fit - a.c.fit || b.cos + b.words - (a.cos + a.words));
  for (const s of scored) {
    const value = finish(s.c.entry.answer, ctx);
    if (!value) continue;
    const strength = Math.min(1, ((s.cos - t.cos) / (1 - t.cos) + (s.words - t.words) / (1 - t.words)) / 2);
    let confidence = 0.72 + 0.2 * strength;
    if (s.c.entry.source === 'derived') confidence -= 0.05;
    return { value, source: 'answer_bank', confidence: Math.round(confidence * 100) / 100, key: s.c.entry.id };
  }
  return null;
}
