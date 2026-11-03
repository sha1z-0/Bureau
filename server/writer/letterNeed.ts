import { db, get, now, run } from '../db.ts';
import type { Recipe } from '../contracts/forms.ts';

/**
 * Does this application need a cover letter? Writing one is the most expensive
 * part of a packet (drafts, critic, humanizer, lint fixes), so when it is known
 * before writing that the target form has no cover-letter field, the writer
 * can skip it and still produce the CV and the short answers.
 *
 * The rule is "skip only on positive knowledge":
 *   - an email application always needs one (the letter is the email body), as
 *     does a posting the matcher read as "apply by email" or "send a DM";
 *   - otherwise every known source of the form's fields is asked; any sign of a
 *     letter field (a file or text box labelled cover letter, motivation letter,
 *     Anschreiben …) means a letter is written;
 *   - only when at least one source knows the form's full field list and none
 *     shows a letter field is the letter skipped. No knowledge: write as before.
 *
 * Sources today:
 *   - `job_form_facts`, a table this module owns, filled through
 *     recordFormFacts() by whoever reads the form's question list ahead of time
 *     (e.g. a source calling the Greenhouse job board API with ?questions=true;
 *     parse that with formFactsFromGreenhouse());
 *   - the form engine's proven recipe for this exact posting URL (scope `url`,
 *     status `active`): a recipe is compiled from a verified run, so a letter
 *     field the engine fills appears as a step. Company- and ATS-wide recipes
 *     are not used: forms differ per posting.
 * More can be added with addFormFactsProvider().
 */

export interface FormFieldFact {
  label: string;
  /** The form's own field name or the engine's value key (cover_letter, letter, coverLetter …). */
  key?: string;
  kind?: string;
}

export interface FormFacts {
  /** Where the list came from (greenhouse_api, recipe:<id>, …). */
  source: string;
  /** Every field the form asks for. A partial list must not be passed here. */
  fields: FormFieldFact[];
}

export interface LetterJob {
  id: string;
  url: string;
  applyUrl: string | null;
  applyEmail: string | null;
  /** The matcher's reading of how to apply (email, ats, dm, unknown), when known. */
  applyChannel: string | null;
}

export type FormFactsProvider = (job: LetterJob) => FormFacts | null | Promise<FormFacts | null>;

export interface LetterNeed {
  needed: boolean;
  reason: string;
  /** The source that decided a skip (or showed a letter field), else null. */
  source: string | null;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS job_form_facts (
    job_id      TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    fields      TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  );
`);

const LETTER_LABEL = /\bcover(?:ing)?[\s_-]*letter\b|\bcoverletter\b|\bmotivation(?:al)?[\s_-]*letter\b|\bletter of motivation\b|\bmotivationsschreiben\b|\banschreiben\b|\blettre de motivation\b|\bcarta de (?:presentaci[oó]n|motivaci[oó]n)\b|\blettera di presentazione\b|\bsollicitatiebrief\b|\bmotivatiebrief\b/i;
const LETTER_KEY = /^(?:cover_?letter(?:_text)?|coverLetter|letter)$/i;

/** Is this field where a cover letter goes (upload or text)? */
export function isLetterField(f: FormFieldFact): boolean {
  return LETTER_LABEL.test(f.label) || (!!f.key && (LETTER_KEY.test(f.key) || LETTER_LABEL.test(f.key.replace(/[_-]+/g, ' '))));
}

/** Store the full field list of a job's form (sources, the form engine, an API). Replaces what was there. */
export function recordFormFacts(jobId: string, facts: FormFacts) {
  run(
    `INSERT INTO job_form_facts (job_id, source, fields, recorded_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET source = excluded.source, fields = excluded.fields, recorded_at = excluded.recorded_at`,
    jobId,
    facts.source,
    JSON.stringify(facts.fields),
    now(),
  );
}

export function forgetFormFacts(jobId: string) {
  run('DELETE FROM job_form_facts WHERE job_id = ?', jobId);
}

interface GreenhouseQuestion {
  label?: string;
  fields?: { name?: string; type?: string }[];
}

/**
 * The Greenhouse job board API's application questions
 * (GET boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}?questions=true):
 * `questions`, plus `location_questions`, `compliance` and
 * `demographic_questions` when present. A posting that asks for a cover letter
 * lists a `cover_letter` (file) and/or `cover_letter_text` (textarea) field.
 */
export function formFactsFromGreenhouse(body: { questions?: GreenhouseQuestion[]; location_questions?: GreenhouseQuestion[] }): FormFacts | null {
  if (!Array.isArray(body?.questions)) return null;
  const all = [...body.questions, ...(Array.isArray(body.location_questions) ? body.location_questions : [])];
  const fields = all.flatMap((q) => (q.fields?.length ? q.fields : [{}]).map((f) => ({ label: q.label ?? '', key: f.name, kind: f.type })));
  return fields.length ? { source: 'greenhouse_api', fields } : null;
}

function storedFacts(job: LetterJob): FormFacts | null {
  const row = get<{ source: string; fields: string }>('SELECT source, fields FROM job_form_facts WHERE job_id = ?', job.id);
  if (!row) return null;
  try {
    const fields = JSON.parse(row.fields) as FormFieldFact[];
    return Array.isArray(fields) ? { source: row.source, fields } : null;
  } catch {
    return null;
  }
}

/** Fields of the form engine's proven recipe for this posting's own URL. */
async function recipeFacts(job: LetterJob): Promise<FormFacts | null> {
  const urls = [job.applyUrl, job.url].filter((u): u is string => !!u);
  if (!urls.length) return null;
  const rows = db.prepare("SELECT id, scope_key, recipe FROM form_recipes WHERE scope = 'url' AND status = 'active' ORDER BY version DESC, updated_at DESC").all() as { id: string; scope_key: string; recipe: string }[];
  if (!rows.length) return null;
  const { urlMatches } = await import('../forms/recipes.ts');
  const hit = rows.find((r) => urls.some((u) => urlMatches(r.scope_key, u)));
  if (!hit) return null;
  let recipe: Pick<Recipe, 'steps' | 'hooks'>;
  try {
    recipe = JSON.parse(hit.recipe) as Pick<Recipe, 'steps' | 'hooks'>;
  } catch {
    return null;
  }
  const fields: FormFieldFact[] = [
    ...(recipe.steps ?? []).filter((s) => s.fieldSignature || s.valueKey || s.labelNorm).map((s) => ({ label: s.labelNorm ?? '', key: s.valueKey, kind: s.action })),
    ...(recipe.hooks ?? []).map((h) => ({ label: h.labelNorm })),
  ];
  return fields.length ? { source: `recipe:${hit.id}`, fields } : null;
}

const GH_JOB = /^https:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)/i;

/**
 * A Greenhouse posting's own question list from the public job board API, fetched
 * once and stored (recordFormFacts). Never in replay with the live transport (the
 * e2e and selfcheck stay offline); a failed lookup just means "not known".
 */
async function greenhouseFacts(job: LetterJob): Promise<FormFacts | null> {
  const m = [job.applyUrl, job.url].map((u) => (u ? GH_JOB.exec(u) : null)).find(Boolean);
  if (!m) return null;
  const { lookupsAllowed } = await import('../scout/resolve.ts');
  if (!lookupsAllowed()) return null;
  const { getJson } = await import('../sources/http.ts');
  const body = await getJson<Parameters<typeof formFactsFromGreenhouse>[0]>(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}?questions=true`, { timeoutMs: 15_000 }).catch(() => null);
  const facts = body ? formFactsFromGreenhouse(body) : null;
  if (facts) recordFormFacts(job.id, facts);
  return facts;
}

// Stored facts come first: once a Greenhouse lookup is recorded, it is not fetched again.
const providers: FormFactsProvider[] = [storedFacts, recipeFacts, async (job) => (storedFacts(job) ? null : greenhouseFacts(job))];

/** Add a source of form knowledge (another module, or a test). Returns a remover. */
export function addFormFactsProvider(p: FormFactsProvider): () => void {
  providers.push(p);
  return () => {
    const i = providers.indexOf(p);
    if (i >= 0) providers.splice(i, 1);
  };
}

export function letterJob(jobId: string): LetterJob | null {
  const row = get<{ id: string; url: string; apply_url_canonical: string | null; apply_email: string | null; match: string | null }>(
    'SELECT id, url, apply_url_canonical, apply_email, match FROM jobs WHERE id = ?',
    jobId,
  );
  if (!row) return null;
  let applyChannel: string | null = null;
  try {
    applyChannel = (JSON.parse(row.match ?? 'null') as { explain?: { applyChannel?: string } } | null)?.explain?.applyChannel ?? null;
  } catch {
    applyChannel = null;
  }
  return { id: row.id, url: row.url, applyUrl: row.apply_url_canonical, applyEmail: row.apply_email, applyChannel };
}

/** Decide whether to write a letter for this job. Never throws: an error in a source means "write it". */
export async function letterNeed(jobId: string): Promise<LetterNeed> {
  const job = letterJob(jobId);
  if (!job) return { needed: true, reason: 'job not found', source: null };
  if (job.applyEmail) return { needed: true, reason: 'email application: the letter is the email body', source: null };
  if (job.applyChannel === 'email' || job.applyChannel === 'dm') return { needed: true, reason: `the posting asks to apply by ${job.applyChannel === 'dm' ? 'direct message' : 'email'}`, source: null };
  const known: FormFacts[] = [];
  for (const p of providers) {
    try {
      const f = await p(job);
      if (f?.fields.length) known.push(f);
    } catch {
      return { needed: true, reason: 'a form source failed; writing the letter to be safe', source: null };
    }
  }
  if (!known.length) return { needed: true, reason: 'the form is not known yet', source: null };
  const withLetter = known.find((f) => f.fields.some(isLetterField));
  if (withLetter) return { needed: true, reason: 'the form has a cover-letter field', source: withLetter.source };
  return { needed: false, reason: `the form has no cover-letter field (${known.map((f) => `${f.source}: ${f.fields.length} field(s)`).join('; ')})`, source: known[0].source };
}
