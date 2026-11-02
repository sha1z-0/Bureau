import crypto from 'node:crypto';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import type { AgentRunResult } from '../contracts/agent.ts';
import type { FieldLogEntry, FillOptions, FillOutcome, FormField, Recipe } from '../contracts/forms.ts';
import type { AtsFamily } from '../contracts/job.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { all, get, now, run } from '../db.ts';
import { emit } from '../services/bus.ts';
import { type AccountSelectors, DEFAULT_ACCOUNT_SELECTORS, ensureAccount, jobSearchEmail } from './accounts.ts';
import { type Adapter, type AdapterRun, adapterFor, GENERIC } from './adapters/index.ts';
import { proofShot, stepShot, writeRunFiles } from './artifacts.ts';
import { guardedContext, launchBrowser, leaseBrowser } from './browser.ts';
import type { Candidate } from './candidate.ts';
import { detectOnPage, effectiveUrl } from './detect.ts';
import { type ExtractedField, extractStep, formPresent, frameByKey, frameFor, type StepExtract } from './extract.ts';
import { fillField, type FileSet } from './handlers/index.ts';
import { readField } from './handlers/common.ts';
import { probeOptions } from './handlers/combobox.ts';
import { pause } from './human.ts';
import { groupFor, invalidateCandidate, jobInfo, type JobInfo, type MapOptions, type MappedValue, mapFieldsWith, MIN_CONFIDENCE } from './map.ts';
import { companyKey, valuesMatch } from './normalize.ts';
import { inFrame } from './page.ts';
import { buildRecipe, recipePages, recipeValue, resolveSteps, type TraceField } from './recipeRun.ts';
import { findRecipe, recordRecipeRun, saveRecipe } from './recipes.ts';
import { pageErrors, verifyFields } from './verify.ts';
import { allowSubmit, armSubmitGuard, blockedSubmits, withSubmitAllowed } from './guard.ts';
import './schema.ts';

/**
 * fillApplication: open → detect → find the form → recipe | adapter | generic
 * (| agent) → per step: extract → map → fill → read back → verify → next →
 * challenge? → submit only when verified → confirm → record.
 */

export class UnverifiedSubmitError extends Error {
  constructor(reason: string) {
    super(`Refusing to submit an unverified form: ${reason}`);
    this.name = 'UnverifiedSubmitError';
  }
}

export interface EngineDeps {
  /** A browser to use (tests); default: the shared headless browser, or a visible one for headful runs. */
  browser?: () => Promise<{ browser: Browser; release: () => void; keepOpen?: boolean }>;
  agentFill?: ((ctx: { page: Page; fields: FormField[]; packet: ApplicationPacket; jobId: string; signal?: AbortSignal }) => Promise<AgentRunResult>) | null;
  waitForCode?: (domain: string, timeoutMs: number) => Promise<string | null>;
  recordUnknown?: (q: { question: string; jobId: string | null; fieldKind: string; options?: string[] }) => string;
  map?: MapOptions['deps'];
  /** Ask the writer for long-form questions (default true). */
  writer?: boolean;
  /** Override the URL to open (tests). */
  url?: string;
  /** Override the job info (tests). */
  job?: JobInfo;
}

const MAX_STEPS = 12;

interface StepRecord {
  step: number;
  fields: ExtractedField[];
  values: MappedValue[];
  log: FieldLogEntry[];
  verified: boolean;
  problems: string[];
  shot: string | null;
  /** Fields committed into saved entry cards (their inputs are gone or empty by design). */
  saved?: Set<string>;
}

interface Run {
  id: string;
  packet: ApplicationPacket;
  opts: FillOptions;
  deps: EngineDeps;
  job: JobInfo;
  page: Page;
  ats: AtsFamily | null;
  adapter: Adapter;
  recipe: (Recipe & { id?: string }) | null;
  via: FillOutcome['via'];
  steps: StepRecord[];
  shots: string[];
  unknown: Map<string, { label: string; kind: FormField['kind']; options: string[]; reason: string }>;
  cache: Map<string, import('../contracts/profile.ts').Answered | null>;
  files: FileSet;
  notes: string[];
  trace: TraceField[];
  nexts: { step: number; selectors: string[] }[];
  submitSelectors: string[];
  healed: number;
  recipeMissing: number;
  candidate: Candidate | null;
  /** Every field on the current step (context for the mapper: e.g. a separate phone country picker). */
  pageFields?: FormField[];
}

// ── Job and URL ───────────────────────────────────────────────────────────────

export function applyUrlFor(job: { source: string; external_id: string | null; url: string }): string | null {
  if (!/^https?:\/\//.test(job.url)) return null;
  const [board, id] = (job.external_id ?? '').split(':');
  if (job.source === 'greenhouse' && board && id) return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${encodeURIComponent(id)}`;
  if (job.source === 'lever' && /jobs\.lever\.co/.test(job.url)) return job.url.replace(/\/?(\?.*)?$/, '/apply');
  if (job.source === 'ashby' && /jobs\.ashbyhq\.com/.test(job.url)) return job.url.replace(/\/?(\?.*)?$/, '/application');
  return job.url;
}

function targetUrl(jobId: string): string | null {
  const j = get<{ url: string; apply_url_canonical: string | null; source: string; external_id: string | null }>('SELECT url, apply_url_canonical, source, external_id FROM jobs WHERE id = ?', jobId);
  if (!j) return null;
  if (j.apply_url_canonical && /^https?:\/\//.test(j.apply_url_canonical)) return j.apply_url_canonical;
  return applyUrlFor(j);
}

/** Has this job already gone out (pipeline, application row, or one of our own runs)? */
export function alreadySubmitted(jobId: string): boolean {
  const p = get<{ state: string }>('SELECT state FROM pipeline WHERE job_id = ?', jobId);
  if (p?.state === 'submitted') return true;
  if (get("SELECT 1 FROM applications WHERE job_id = ? AND status = 'sent'", jobId)) return true;
  return !!get("SELECT 1 FROM form_runs WHERE job_id = ? AND status = 'submitted'", jobId);
}

function campaignZone(campaignId?: string): string | undefined {
  if (!campaignId) return undefined;
  const row = get<{ config: string }>('SELECT config FROM campaigns WHERE id = ?', campaignId);
  try {
    return row ? (JSON.parse(row.config) as { activeHours?: { tz?: string } }).activeHours?.tz : undefined;
  } catch {
    return undefined;
  }
}

function aborted(opts: FillOptions) {
  if (opts.signal?.aborted) {
    const e = new Error('Form fill stopped by the kill switch.');
    e.name = 'AbortError';
    throw e;
  }
}

// ── Finding the form ─────────────────────────────────────────────────────────

async function settle(page: Page, ms = 400) {
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function challengeOn(page: Page): Promise<{ found: boolean; kind: string }> {
  for (const fr of page.frames()) {
    if (fr.isDetached()) continue;
    const c = await inFrame<{ found: boolean; kind: string }>(fr, 'challenge').catch(() => null);
    if (c?.found) return c;
  }
  return { found: false, kind: '' };
}

/** Wait for client-rendered forms to appear (SPAs render after load). */
async function waitForFields(page: Page, ms = 5000): Promise<StepExtract> {
  const until = Date.now() + ms;
  let ex = await extractStep(page, 0);
  while (!stepPresent(ex) && Date.now() < until) {
    await page.waitForTimeout(250);
    ex = await extractStep(page, 0);
  }
  return ex;
}

/**
 * Follow up to two "Apply" hops (listing → ATS page → form). Links that open a
 * new tab are followed in the same tab; buttons that open one are adopted.
 */
async function findForm(r: Run): Promise<StepExtract> {
  let ex = await waitForFields(r.page, 4000);
  for (let hop = 0; hop < 3 && !stepPresent(ex); hop++) {
    const apply = ex.applies.find((a) => !a.inForm) ?? ex.applies[0];
    if (!apply) break;
    const frame = frameByKey(r.page, apply.frame);
    if (apply.href && !/^(mailto|javascript):/i.test(apply.href) && !apply.href.startsWith('#')) {
      const next = new URL(apply.href, frame.url()).toString();
      await r.page.goto(next, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    } else {
      const popup = r.page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
      await withSubmitAllowed(r.page, () => frame.locator(`[data-bureau-nav="${apply.id}"]`).first().click({ timeout: 5000 }).catch(() => {}));
      const np = await popup;
      if (np) {
        await np.waitForLoadState('domcontentloaded').catch(() => {});
        const url = np.url();
        await np.close().catch(() => {});
        if (/^https?:/.test(url)) await r.page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }
    await settle(r.page, 600);
    ex = await waitForFields(r.page, 4000);
  }
  return ex;
}

// ── Filling one step ─────────────────────────────────────────────────────────

const DEBUG = process.env.BUREAU_FORMS_DEBUG === '1';
function dbg(r: Run, msg: string) {
  r.notes.push(msg);
  if (DEBUG) console.log(`    [forms ${r.id.slice(0, 6)}] ${msg}`);
}

function adapterRun(r: Run, step: number): AdapterRun {
  return {
    page: r.page,
    step,
    note: (m) => dbg(r, m),
    entries: { work: Math.min(3, r.candidate?.work.length ?? 0), education: Math.min(3, r.candidate?.education.length ?? 0) },
  };
}

function usable(r: Run, f: ExtractedField): boolean {
  if (r.adapter.ignore?.some((re) => re.test(f.label))) return false;
  return true;
}

function groupCount(ex: StepExtract, name: string): number {
  const idx = new Set<number>();
  for (const f of ex.fields) {
    const g = groupFor(f);
    if (g.name === name) idx.add(g.index);
  }
  return idx.size;
}

async function clickStamped(frame: Frame, attr: string, id: string): Promise<boolean> {
  const l = frame.locator(`[${attr}="${id}"]`).first();
  try {
    await l.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await l.click({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function extract(r: Run, step: number): Promise<StepExtract> {
  const ex = await extractStep(r.page, step);
  ex.fields = ex.fields.map((f) => (r.adapter.fixField ? r.adapter.fixField(f) : f)).filter((f): f is ExtractedField => !!f && usable(r, f));
  return ex;
}

async function mapAndFill(r: Run, step: number, fields: ExtractedField[], rec: StepRecord, groupOverride?: { name: string; index: number }) {
  if (groupOverride) for (const f of fields) f.meta = { ...f.meta, group: { name: groupOverride.name, index: groupOverride.index, count: groupOverride.index + 1 } };
  // Custom selects show their options only when opened: look before mapping, so answers match an option.
  for (const f of fields) {
    if (f.kind === 'combobox' && !f.options?.length && !f.meta?.native) {
      const opts = await probeOptions(r.page, f);
      if (opts.length) f.options = opts;
    }
  }
  const mapped = await mapFieldsWith(fields, r.packet, { writer: r.deps.writer !== false, job: r.job, cache: r.cache, deps: r.deps.map, context: r.pageFields });
  // Recipe steps decide values where they name one.
  let resolution: Awaited<ReturnType<typeof resolveSteps>> | null = null;
  if (r.recipe) {
    const { pages } = recipePages(r.recipe);
    const pg = pages[Math.min(step, pages.length - 1)];
    resolution = await resolveSteps(r.page, pg?.steps ?? [], fields);
    r.healed += resolution.healed.length;
    r.recipeMissing += resolution.missing.filter((s) => s.labelNorm).length;
    for (const [fid, s] of resolution.byField) {
      const f = fields.find((x) => x.id === fid)!;
      const v = recipeValue(s, f, { packet: r.packet, candidate: r.candidate, job: r.job });
      if (v) {
        // The recipe fills the gaps; a confident answer from the mapper (today's profile and bank) wins.
        const i = mapped.findIndex((m) => m.fieldId === fid);
        if (i < 0) mapped.push(v);
        else if (mapped[i].unknown || mapped[i].confidence < 0.9) mapped[i] = { ...mapped[i], ...v, unknown: false };
      }
    }
  }
  const ordered = [...fields].sort((a, b) => (a.frame ?? '').localeCompare(b.frame ?? '') || a.order - b.order);
  for (const f of ordered) {
    aborted(r.opts);
    rec.fields.push(f);
    const v = mapped.find((m) => m.fieldId === f.id);
    if (!v) {
      if (DEBUG) dbg(r, `no value: ${f.label} [${f.kind}]${f.required ? ' *' : ''} opts=${f.options?.length ?? 0}`);
      continue;
    }
    rec.values.push(v);
    if (v.unknown || v.confidence < MIN_CONFIDENCE) {
      // A question that went away (a dependent field re-drawn by an earlier answer) is not a question any more.
      const still = await readField(frameFor(r.page, f), f).catch(() => null);
      if (still && !still.exists) {
        rec.values.pop();
        continue;
      }
      if (f.required) r.unknown.set(f.labelNorm, { label: f.label, kind: f.kind, options: f.options ?? [], reason: v.reason ?? 'unknown' });
      v.unknown = true;
      continue;
    }
    // Already right (autofill, resume parse, a previous visit): leave it alone.
    let cur = await readField(frameFor(r.page, f), f).catch(() => null);
    if (cur && !cur.exists) {
      // The page re-rendered (a checkbox that re-draws its section): find the same field again.
      const twin = await refind(r, step, f);
      if (!twin) continue;
      f.id = twin.id;
      v.fieldId = twin.id;
      cur = await readField(frameFor(r.page, f), f).catch(() => null);
    }
    if (cur?.exists && f.kind === 'file') {
      // Already uploaded (an earlier pass, or carried over by the site): never upload twice.
      const base = v.value.split(/[\\/]/).pop() ?? v.value;
      const again = await readField(frameFor(r.page, f), f, base).catch(() => null);
      if (again && (again.value.includes(base) || (again.chip ?? '').includes(base))) {
        r.trace.push({ field: f, value: v, step });
        continue;
      }
    }
    if (cur?.exists && f.kind !== 'file' && cur.value && valuesMatch(f.kind, v.value, cur.value, { display: cur.display, format: f.meta?.format, strict: true })) {
      r.trace.push({ field: f, value: v, step });
      continue;
    }
    let res = await fillField(r.page, f, v, r.files);
    if (!res.ok) {
      await pause(r.page, 150, 300);
      res = await fillField(r.page, f, v, r.files);
    }
    if (res.chosen && f.kind !== 'file') v.value = res.chosen;
    if (!res.ok) dbg(r, `fill failed: ${f.label} [${f.kind}] = ${JSON.stringify(v.value).slice(0, 60)}${res.note ? ` (${res.note})` : ''} read ${JSON.stringify(res.readBack).slice(0, 60)}`);
    if (res.ok) r.trace.push({ field: f, value: v, step });
    await pause(r.page);
  }
}

async function refind(r: Run, step: number, f: ExtractedField): Promise<ExtractedField | null> {
  const ex = await extract(r, step);
  const same = ex.fields.filter((x) => x.signature === f.signature && (x.frame ?? '') === (f.frame ?? ''));
  return same.find((x) => x.order === f.order) ?? same[0] ?? ex.fields.find((x) => x.labelNorm === f.labelNorm && x.kind === f.kind && x.section === f.section) ?? null;
}

/** A wizard page counts as a form when it has fields, or a field and a way forward. */
function stepPresent(ex: StepExtract): boolean {
  return formPresent(ex.fields) || (ex.fields.length > 0 && ex.navs.some((n) => n.kind === 'next' || n.kind === 'submit'));
}

/** Add entries to repeating sections ("Add another") until the profile's entries fit. */
async function repeaters(r: Run, step: number, ex: StepExtract, rec: StepRecord): Promise<StepExtract> {
  const want = adapterRun(r, step).entries;
  for (const group of ['work', 'education'] as const) {
    const target = want[group];
    if (!target) continue;
    let saved = 0;
    for (let guard = 0; guard < 6; guard++) {
      const have = Math.max(groupCount(ex, group), 0) + saved;
      if (have >= target) break;
      const adder = ex.adders.find((a) => a.group === group);
      if (!adder) break;
      const before = new Set(ex.fields.map((f) => f.id));
      const frame = frameByKey(r.page, adder.frame);
      if (!(await clickStamped(frame, 'data-bureau-add', adder.id))) break;
      await settle(r.page, 300);
      ex = await extract(r, step);
      const fresh = ex.fields.filter((f) => !before.has(f.id));
      const saveId = await inFrame<string | null>(frame, 'saveNear', { adderId: adder.id }).catch(() => null);
      if (saveId && fresh.length) {
        // Inline sub-form: fill this entry, save it, go again.
        const idx = have;
        await mapAndFill(r, step, fresh.filter((f) => !f.meta?.group || f.meta.group.name === group), rec, { name: group, index: idx });
        await withSubmitAllowed(r.page, () => clickStamped(frame, 'data-bureau-nav', saveId));
        await settle(r.page, 300);
        saved++;
        ex = await extract(r, step);
        continue;
      }
      if (groupCount(ex, group) + saved <= have && !fresh.length) break;
    }
  }
  return ex;
}

async function fillStep(r: Run, step: number): Promise<{ rec: StepRecord; ex: StepExtract }> {
  const rec: StepRecord = { step, fields: [], values: [], log: [], verified: false, problems: [], shot: null };
  let ex = await extract(r, step);
  r.pageFields = ex.fields;
  if (r.adapter.beforeStep) {
    await r.adapter.beforeStep(r.page, adapterRun(r, step), ex);
    ex = await extract(r, step);
  }
  ex = await repeaters(r, step, ex, rec);
  // Parent questions first: a country choice re-draws the state/region list and the phone format.
  const parents = ex.fields.filter((f) => !/phone|mobile/i.test(f.section ?? "") && (f.kind === 'select' || f.kind === 'combobox') && /^country\b/i.test(f.label.trim()) && !/\b(code|phone|dial|calling|citizenship)\b/i.test(f.label) && !rec.fields.some((x) => x.id === f.id));
  if (parents.length) {
    await mapAndFill(r, step, parents, rec);
    await settle(r.page, 300);
    ex = await extract(r, step);
  }
  const done = new Set(rec.fields.map((f) => f.id));
  const doneSig = new Set(rec.fields.map((f) => `${f.signature}|${f.frame ?? ''}|${f.order}`));
  for (let pass = 0; pass < 3; pass++) {
    // New fields only: conditional questions that appeared because of an answer.
    const todo = ex.fields.filter((f) => !done.has(f.id) && !doneSig.has(`${f.signature}|${f.frame ?? ''}|${f.order}`));
    if (!todo.length) break;
    for (const f of todo) {
      done.add(f.id);
      doneSig.add(`${f.signature}|${f.frame ?? ''}|${f.order}`);
    }
    await mapAndFill(r, step, todo, rec);
    await settle(r.page, 150);
    ex = await extract(r, step);
  }
  // Entry sub-forms left open ("Save" / "Done" under an experience or education entry) are saved.
  const saved = new Set<string>();
  const savedProblems: string[] = [];
  for (const fr of r.page.frames()) {
    if (fr.isDetached()) continue;
    const saves = await inFrame<{ id: string; fields: string[]; values: string[] }[]>(fr, 'saveButtons').catch(() => []);
    for (const sv of saves) {
      await withSubmitAllowed(r.page, () => clickStamped(fr, 'data-bureau-nav', sv.id));
      await settle(r.page, 300);
      for (const id of sv.fields) saved.add(id);
      // The saved entry must show what was typed into it.
      const text = await fr.locator('body').innerText().catch(() => '');
      const missing = sv.values.filter((v) => v.length <= 60 && !text.includes(v));
      if (missing.length) savedProblems.push(`saved entry does not show "${missing[0].slice(0, 60)}"`);
      dbg(r, `saved an open entry sub-form (${sv.fields.length} fields)`);
    }
  }
  // Fields re-rendered with new ids: verify against what's on the page now.
  const live = await extract(r, step);
  const liveIds = new Set(live.fields.map((f) => f.id));
  const checkFields = rec.fields.filter((f) => !saved.has(f.id) && (liveIds.has(f.id) || rec.values.some((v) => v.fieldId === f.id && !v.unknown)));
  const v = await verifyFields(r.page, checkFields, rec.values, { ignoreErrors: r.adapter.ignoreErrors });
  // Saved entry fields count as verified when the entry shows their values.
  for (const f of rec.fields.filter((x) => saved.has(x.id))) {
    const want = rec.values.find((x) => x.fieldId === f.id && !x.unknown);
    if (want) v.fieldLog.push({ signature: f.signature, label: f.label, kind: f.kind, required: f.required, source: want.source, key: want.key, intended: want.value.slice(0, 2000), readBack: '(saved entry)', ok: !savedProblems.length, note: savedProblems[0] });
  }
  if (savedProblems.length) {
    v.verified = false;
    v.problems.push(...savedProblems);
  }
  // Entries saved into a summary card: their inputs are gone, their values are on the page.
  if (saved.size || v.fieldLog.some((e) => e.note === 'field disappeared')) {
    let pageText = '';
    for (const fr of r.page.frames()) if (!fr.isDetached()) pageText += ' ' + (await fr.locator('body').innerText().catch(() => ''));
    const gone = v.fieldLog.filter((e) => e.note === 'field disappeared' && e.intended);
    const sectionOf = (e: FieldLogEntry) => rec.fields.find((f) => f.signature === e.signature)?.section ?? '';
    const cardShown = new Set(gone.filter((e) => e.intended!.length <= 60 && pageText.includes(e.intended!)).map(sectionOf));
    for (const e of v.fieldLog) {
      if (e.ok || e.note !== 'field disappeared' || !e.intended) continue;
      // Shown on the entry card, or part of an entry whose card shows its other values.
      const shown = e.kind === 'checkbox' || e.kind === 'date' || e.intended.length > 60 || pageText.includes(e.intended) || cardShown.has(sectionOf(e));
      if (!shown) continue;
      e.ok = true;
      e.readBack = '(saved entry)';
      e.note = undefined;
      const i = v.problems.findIndex((p) => p.startsWith(`${e.label}: field disappeared`));
      if (i >= 0) v.problems.splice(i, 1);
    }
    v.verified = v.problems.length === 0;
  }
  rec.log = v.fieldLog;
  rec.verified = v.verified;
  rec.problems = v.problems;
  rec.saved = new Set([...saved, ...rec.fields.filter((f) => v.fieldLog.some((e) => e.signature === f.signature && e.readBack === '(saved entry)')).map((f) => f.id)]);
  dbg(r, `step ${step + 1}: ${rec.fields.length} fields, verified=${rec.verified}${rec.problems.length ? ` problems: ${rec.problems.slice(0, 3).join(' | ')}` : ''}`);
  rec.shot = await stepShot(r.page, r.id, `step-${step + 1}`);
  if (rec.shot) r.shots.push(rec.shot);
  return { rec, ex: live };
}

// ── Navigation ───────────────────────────────────────────────────────────────

async function firstVisible(page: Page, sels: string[]): Promise<{ frame: Frame; selector: string } | null> {
  for (const s of sels) {
    for (const fr of page.frames()) {
      if (fr.isDetached()) continue;
      const l = fr.locator(s).first();
      if (await l.isVisible({ timeout: 150 }).catch(() => false)) return { frame: fr, selector: s };
    }
  }
  return null;
}

type Nav = { kind: 'next' | 'submit'; frame: Frame; selector: string } | null;

async function pickNav(r: Run, ex: StepExtract): Promise<Nav> {
  const sub = r.adapter.submit ? await firstVisible(r.page, r.adapter.submit) : null;
  const final = r.adapter.isFinal ? await r.adapter.isFinal(r.page, ex) : false;
  if (sub && (final || !r.adapter.next)) return { kind: 'submit', ...sub };
  if (!final && r.adapter.next) {
    const nx = await firstVisible(r.page, r.adapter.next);
    if (nx) return { kind: 'next', ...nx };
  }
  if (sub) return { kind: 'submit', ...sub };
  const next = ex.navs.find((n) => n.kind === 'next' || n.kind === 'review');
  if (next && !final) return { kind: 'next', frame: frameByKey(r.page, next.frame), selector: `[data-bureau-nav="${next.id}"]` };
  const submits = ex.navs.filter((n) => n.kind === 'submit');
  const s = submits.find((n) => n.inForm && n.type === 'submit') ?? submits.find((n) => n.inForm) ?? submits[submits.length - 1];
  if (s) return { kind: 'submit', frame: frameByKey(r.page, s.frame), selector: `[data-bureau-nav="${s.id}"]` };
  return null;
}

async function fingerprint(page: Page): Promise<string> {
  const parts: string[] = [];
  for (const fr of page.frames()) {
    if (fr.isDetached()) continue;
    const f = await inFrame<{ heads: string; ctl: number; step: string; url: string }>(fr, 'fingerprint').catch(() => null);
    if (f) parts.push(`${f.url}|${f.heads}|${f.step}|${f.ctl}`);
  }
  return parts.join('#');
}

async function clickNext(r: Run, nav: NonNullable<Nav>): Promise<{ moved: boolean; errors: string[] }> {
  const before = await fingerprint(r.page);
  await allowSubmit(r.page, true);
  try {
    await nav.frame.locator(nav.selector).first().click({ timeout: 8000 }).catch(() => {});
    const until = Date.now() + (r.adapter.stepWaitMs ?? 6000);
    while (Date.now() < until) {
      await r.page.waitForTimeout(250);
      const after = await fingerprint(r.page);
      if (after !== before) {
        await settle(r.page, 300);
        return { moved: true, errors: [] };
      }
    }
    return { moved: false, errors: await pageErrors(r.page, r.adapter.ignoreErrors) };
  } finally {
    await allowSubmit(r.page, false);
  }
}

// ── Submit and confirm ───────────────────────────────────────────────────────

async function confirmed(r: Run): Promise<boolean> {
  const c = r.adapter.confirm;
  const url = effectiveUrl(r.page.url());
  if (c.url?.test(url) || c.url?.test(r.page.url())) return true;
  for (const fr of r.page.frames()) {
    if (fr.isDetached()) continue;
    const res = await inFrame<{ confirmed: boolean }>(fr, 'confirm', { text: c.text?.source, selectors: c.selectors ?? [] }).catch(() => null);
    if (res?.confirmed) return true;
  }
  return false;
}

/** The one place a form is ever submitted. Throws unless the run is verified. */
export async function submitVerified(r: { page: Page; verified: boolean; problems: string[] }, nav: NonNullable<Nav>): Promise<void> {
  if (r.verified !== true) throw new UnverifiedSubmitError(r.problems.slice(0, 3).join('; ') || 'not verified');
  await allowSubmit(r.page, true);
  await nav.frame.locator(nav.selector).first().click({ timeout: 10_000 });
}

// ── Outcome ──────────────────────────────────────────────────────────────────

function finish(r: Run | null, base: Partial<FillOutcome> & Pick<FillOutcome, 'status' | 'reason'>, extra: { url?: string | null; runId?: string; jobId?: string; packet?: ApplicationPacket; submit?: boolean } = {}): FillOutcome {
  const fieldLog: FieldLogEntry[] = r ? r.steps.flatMap((s) => s.log) : [];
  const answers = r
    ? r.steps.flatMap((s) =>
        s.values
          .filter((v) => !v.unknown && v.value)
          .map((v) => {
            const f = s.fields.find((x) => x.id === v.fieldId);
            return { label: f?.label ?? v.key, value: f?.kind === 'file' ? (v.value.split(/[\\/]/).pop() ?? v.value) : v.value.slice(0, 2000), source: v.source };
          }),
      )
    : [];
  if (r) void blockedSubmits(r.page).then((n) => n && r.notes.push(`the submit guard stopped ${n} premature submit(s)`)).catch(() => {});
  const out: FillOutcome = {
    status: base.status,
    reason: base.reason,
    shotPath: base.shotPath ?? null,
    shots: r?.shots ?? [],
    answers,
    verified: base.verified ?? false,
    unknownQuestions: r ? [...r.unknown.values()].map((u) => ({ label: u.label, kind: u.kind, options: u.options })) : [],
    fieldLog,
    ats: r?.ats ?? null,
    via: r?.via ?? null,
    recipeId: r?.recipe?.id ?? null,
    url: extra.url ?? (r ? r.page.url() : null),
  };
  const runId = r?.id ?? extra.runId;
  if (runId) {
    try {
      writeRunFiles(runId, fieldLog, { ...out, notes: r?.notes ?? [], problems: r?.steps.flatMap((s) => s.problems) ?? [] });
      run(
        `UPDATE form_runs SET status = ?, verified = ?, reason = ?, fields_total = ?, fields_ok = ?, steps = ?, via = ?, recipe_id = ?, ats = ?, url = ?, finished_at = ? WHERE id = ?`,
        out.status,
        out.verified ? 1 : 0,
        out.reason.slice(0, 1000),
        fieldLog.length,
        fieldLog.filter((e) => e.ok).length,
        r?.steps.length ?? 0,
        out.via,
        out.recipeId,
        out.ats,
        out.url,
        now(),
        runId,
      );
    } catch {
      /* evidence is best effort; the outcome still returns */
    }
  }
  return out;
}

// ── The run ──────────────────────────────────────────────────────────────────

async function realAgent(): Promise<EngineDeps['agentFill']> {
  try {
    const mod = await import('../agent/index.ts');
    return mod.agentFill;
  } catch {
    return null;
  }
}

async function realWaitForCode(domain: string, timeoutMs: number): Promise<string | null> {
  const mod = await import('../inbox/index.ts');
  return mod.waitForCode(domain, timeoutMs);
}

async function realRecordUnknown(q: { question: string; jobId: string | null; fieldKind: string; options?: string[] }): Promise<string | null> {
  try {
    const mod = await import('../profile/index.ts');
    return mod.recordUnknown(q);
  } catch {
    return null;
  }
}

export async function runFill(packet: ApplicationPacket, opts: FillOptions, deps: EngineDeps = {}): Promise<FillOutcome> {
  aborted(opts);
  const job = deps.job ?? jobInfo(packet.jobId);
  if (!job) return finish(null, { status: 'failed', reason: 'Job not found.' });
  if (opts.submit && alreadySubmitted(packet.jobId)) return finish(null, { status: 'skipped', reason: 'Already submitted: Bureau never applies twice.' });
  const url = deps.url ?? targetUrl(packet.jobId);
  if (!url) return finish(null, { status: 'needs_you', reason: 'No application page for this role.' });
  if (/(^|\.)(linkedin|indeed)\.[a-z.]+\//i.test(effectiveUrl(url) + '/')) return finish(null, { status: 'needs_you', reason: 'LinkedIn and Indeed applications are not automated. It needs you.' });

  const runId = crypto.randomUUID();
  run('INSERT INTO form_runs (id, job_id, application_id, campaign_id, url, submit, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)', runId, packet.jobId, packet.applicationId, opts.campaignId ?? null, url, opts.submit ? 1 : 0, now());

  const lease = deps.browser ? await deps.browser() : opts.headful ? { browser: await launchBrowser(false), release: () => {}, keepOpen: true, own: true } : await leaseBrowser();
  const own = !deps.browser && !!opts.headful;
  let ctx: BrowserContext | null = null;
  let keepOpen = false;
  const onAbort = () => {
    void ctx?.close().catch(() => {});
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  invalidateCandidate();
  try {
    ctx = await guardedContext(lease.browser, { timezoneId: campaignZone(opts.campaignId) ?? Intl.DateTimeFormat().resolvedOptions().timeZone });
    const page = await ctx.newPage();
    page.setDefaultTimeout(5_000);
    const candidate = deps.map?.candidate ? deps.map.candidate() : await loadCandidate();
    const r: Run = {
      id: runId,
      packet,
      opts,
      deps,
      job,
      page,
      ats: null,
      adapter: GENERIC,
      recipe: null,
      via: 'generic',
      steps: [],
      shots: [],
      unknown: new Map(),
      cache: new Map(),
      files: { cv: packet.cvPdfPath, letter: packet.letterPdfPath },
      notes: [],
      trace: [],
      nexts: [],
      submitSelectors: [],
      healed: 0,
      recipeMissing: 0,
      candidate,
    };

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await settle(page, 500);
    aborted(opts);
    r.ats = await detectOnPage(page, job.ats);
    r.adapter = adapterFor(r.ats) ?? GENERIC;
    if (r.adapter.applyUrl) {
      const want = r.adapter.applyUrl(page.url());
      if (want !== page.url()) await page.goto(want, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    if (r.adapter.openForm) await r.adapter.openForm(page, adapterRun(r, 0));
    await settle(page, 300);

    const wall = await challengeOn(page);
    if (wall.found && wall.kind === 'bot_wall') {
      keepOpen = !!opts.headful;
      return finish(r, { status: 'needs_you', reason: 'The site blocks automated browsers here. It needs you.', shotPath: await proofShot(page, packet.applicationId) });
    }

    // Login wall (it can take a moment to render after Apply).
    const wallWait = Date.now() + (r.adapter.account ? 6000 : 0);
    let needsLogin = false;
    while (r.adapter.account && !(needsLogin = await r.adapter.account.needed(page)) && Date.now() < wallWait) await page.waitForTimeout(250);
    if (needsLogin) {
      const out = await login(r);
      if (out) {
        keepOpen = !!opts.headful;
        return out;
      }
    }

    // From here on the page cannot submit anything Bureau did not mean to.
    await armSubmitGuard(ctx, page);
    const ex0 = await findForm(r);
    r.ats = r.ats && r.ats !== 'other' ? r.ats : await detectOnPage(page, job.ats);
    if (r.adapter === GENERIC && adapterFor(r.ats)) r.adapter = adapterFor(r.ats)!;
    const company = companyKey(job.company);
    r.recipe = findRecipe({ ats: r.ats, company: job.company, url: page.url() });
    r.via = r.recipe ? 'recipe' : r.adapter !== GENERIC ? 'adapter' : 'generic';

    let finalNav: Nav = null;
    let stopReason = '';
    let agentDone = false;
    if (!stepPresent(ex0) && !(await r.adapter.isFinal?.(page, ex0))) {
      // Nothing recognisable: the browser agent's job (A06). Its fills are re-verified here before anything is submitted.
      const out = await agentOrNeedsYou(r, ex0.fields, 'Could not find an application form on the page.');
      if (out) return out;
      agentDone = true;
      const rec = await agentStep(r, 0, new Set());
      if (rec) r.steps.push(rec);
      const nav = await pickNav(r, await extract(r, rec?.step ?? 0));
      finalNav = nav?.kind === 'submit' ? nav : null;
      if (!finalNav) stopReason = 'no_submit';
    }

    // ── The wizard.
    for (let step = 0; step < MAX_STEPS && !agentDone; step++) {
      aborted(opts);
      if (r.adapter.account && (await r.adapter.account.needed(page))) {
        const out = await login(r);
        if (out) {
          keepOpen = !!opts.headful;
          return out;
        }
      }
      let { rec, ex } = await fillStep(r, step);
      if (!rec.verified && !r.unknown.size) {
        // One repair pass: fields that did not stick (re-renders, traps that clear values) get filled again.
        r.shots.pop();
        ({ rec, ex } = await fillStep(r, step));
      }
      r.steps.push(rec);
      if (r.unknown.size) {
        // A required question nobody can answer: never move on past it (or past a value we did not choose).
        stopReason = 'unknown';
        break;
      }
      const nav = await pickNav(r, ex);
      if (!nav) {
        stopReason = rec.verified ? 'no_submit' : 'unverified';
        break;
      }
      if (nav.kind === 'submit') {
        finalNav = nav;
        break;
      }
      if (!rec.verified) {
        stopReason = 'unverified';
        break;
      }
      r.nexts.push({ step, selectors: [nav.selector.startsWith('[data-bureau') ? '' : nav.selector].filter(Boolean) });
      dbg(r, `next: ${nav.selector}`);
      const moved = await clickNext(r, nav);
      if (!moved.moved) {
        r.steps[r.steps.length - 1].problems.push(...(moved.errors.length ? moved.errors : ['the form did not move to the next step']));
        r.steps[r.steps.length - 1].verified = false;
        stopReason = 'stuck';
        break;
      }
    }

    // Generic forms that would not verify: the agent gets a go (when allowed).
    const problems = r.steps.flatMap((s) => s.problems);
    let verified = r.steps.length > 0 && r.steps.every((s) => s.verified) && !r.unknown.size && !!finalNav;
    // Generic forms, and recipes that no longer get through, too (A06 compiles the agent's repaired run into a new version).
    if (!verified && (r.via === 'generic' || r.via === 'recipe') && !r.unknown.size && stopReason !== 'stuck' && opts.allowAgent !== false) {
      const res = await tryAgent(r, r.steps.at(-1)?.fields ?? []);
      if (res?.status === 'done') {
        const last = r.steps.at(-1);
        if (last) {
          const v = await verifyFields(page, last.fields, last.values, { ignoreErrors: r.adapter.ignoreErrors });
          last.verified = v.verified;
          last.log = v.fieldLog;
          last.problems = v.problems;
        }
        if (r.via === 'recipe' && r.recipe?.id) recordRecipeRun(r.recipe.id, false, 'did not verify; the browser agent completed the form');
        r.via = 'agent';
        // The agent's own fills (on the page it finished on) are verified here as well.
        const extra = await agentStep(r, (last?.step ?? -1) + 1, new Set(last?.fields.map((f) => f.id) ?? []));
        if (extra) r.steps.push(extra);
        if (finalNav?.kind !== 'submit') {
          const nav = await pickNav(r, await extract(r, r.steps.at(-1)?.step ?? 0));
          finalNav = nav?.kind === 'submit' ? nav : null;
        }
        verified = r.steps.length > 0 && r.steps.every((s) => s.verified) && !r.unknown.size && !!finalNav;
      }
    }

    // Unknown required questions → the answer-bank loop.
    if (r.unknown.size) {
      const rec = deps.recordUnknown ?? realRecordUnknown;
      for (const u of r.unknown.values()) await Promise.resolve(rec({ question: u.label, jobId: packet.jobId, fieldKind: u.kind, options: u.options.length ? u.options : undefined })).catch(() => null);
      const list = [...r.unknown.values()].map((u) => `“${u.label}”`).join('; ');
      const status = opts.onUnknown === 'needs_you' ? 'needs_you' : 'skipped';
      keepOpen = !!opts.headful;
      recordRecipe(r, false, 'unknown questions');
      return finish(r, { status, reason: `unknown_question: ${list}`, shotPath: await proofShot(page, packet.applicationId), verified: false });
    }

    const challenge = await challengeOn(page);
    if (challenge.found) {
      keepOpen = !!opts.headful;
      recordRecipe(r, verified, 'captcha');
      return finish(r, { status: 'needs_you', reason: `This form has a CAPTCHA (${challenge.kind}), so it needs your click. Everything else is filled in${verified ? ' and verified' : ''}.`, shotPath: await proofShot(page, packet.applicationId), verified: false });
    }

    if (!verified) {
      keepOpen = !!opts.headful;
      recordRecipe(r, false, problems.slice(0, 3).join('; '));
      const why = problems.length ? problems.slice(0, 4).join('; ') : stopReason === 'no_submit' ? 'no submit button found' : 'could not verify every field';
      return finish(r, { status: 'needs_you', reason: `Could not verify the form: ${why}`, shotPath: await proofShot(page, packet.applicationId), verified: false });
    }

    recordRecipe(r, true);
    await shadowHook(r);
    if (!opts.submit) {
      keepOpen = !!opts.headful;
      return finish(r, { status: opts.headful ? 'needs_you' : 'rehearsed', reason: opts.headful ? 'Filled in and verified. Review it and press submit in the browser window.' : 'Rehearsal: filled and verified, not submitted.', shotPath: await proofShot(page, packet.applicationId), verified: true });
    }

    // ── Submit (verified only).
    aborted(opts);
    if (alreadySubmitted(packet.jobId)) return finish(r, { status: 'skipped', reason: 'Already submitted: Bureau never applies twice.', verified: true });
    const last = r.steps.at(-1)!;
    const recheck = await verifyFields(page, last.fields.filter((f) => !last.saved?.has(f.id)), last.values, { ignoreErrors: r.adapter.ignoreErrors });
    if (!recheck.verified) {
      return finish(r, { status: 'needs_you', reason: `The form changed before submit: ${recheck.problems.slice(0, 3).join('; ')}`, shotPath: await proofShot(page, packet.applicationId), verified: false });
    }
    r.submitSelectors = finalNav!.selector.startsWith('[data-bureau') ? [] : [finalNav!.selector];
    run("UPDATE form_runs SET status = 'submitting' WHERE id = ?", runId);
    dbg(r, `submit: ${finalNav!.selector}`);
    await submitVerified({ page, verified, problems }, finalNav!);
    const until = Date.now() + 25_000;
    let ok = false;
    while (Date.now() < until) {
      await page.waitForTimeout(400);
      if (await confirmed(r)) {
        ok = true;
        break;
      }
      const ch = await challengeOn(page);
      if (ch.found) return finish(r, { status: 'needs_you', reason: `A CAPTCHA (${ch.kind}) appeared on submit. It needs your click.`, shotPath: await proofShot(page, packet.applicationId), verified: true });
    }
    const shot = await proofShot(page, packet.applicationId);
    if (ok) {
      emit({ type: 'activity', message: `Submitted ${job.title} at ${job.company} via ${r.via}`, jobId: packet.jobId });
      return finish(r, { status: 'submitted', reason: `Submitted through the ${r.adapter === GENERIC ? 'company' : r.adapter.name} form.`, shotPath: shot, verified: true });
    }
    const errors = await pageErrors(page, r.adapter.ignoreErrors);
    // The browser's own constraint validation blocks a submit silently: name the invalid controls.
    for (const fr of page.frames()) {
      const bad = (await fr.evaluate(`Array.from(document.querySelectorAll('input:invalid, select:invalid, textarea:invalid')).map((e) => e.name || e.id || e.type).slice(0, 5)`).catch(() => [])) as string[];
      if (bad.length) errors.push(`the browser refused: invalid ${bad.join(', ')}`);
    }
    return finish(r, { status: 'needs_you', reason: errors.length ? `The form reported: ${errors.slice(0, 3).join(' · ').slice(0, 300)}` : 'Submitted, but no confirmation appeared. Check before applying again.', shotPath: shot, verified: true });
  } catch (err) {
    if ((err as Error).name === 'AbortError' || opts.signal?.aborted) throw err;
    if (err instanceof UnverifiedSubmitError) throw err;
    const msg = (err as Error).message.split('\n')[0].slice(0, 300);
    run("UPDATE form_runs SET status = 'failed', reason = ?, finished_at = ? WHERE id = ?", msg, now(), runId);
    return { status: 'failed', reason: msg, shotPath: null, shots: [], answers: [], verified: false, unknownQuestions: [], fieldLog: [], ats: null, via: null, recipeId: null, url };
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    if (!keepOpen) {
      await ctx?.close().catch(() => {});
      if (own) await lease.browser.close().catch(() => {});
    }
    lease.release();
  }

  async function login(r: Run): Promise<FillOutcome | null> {
    const sel: AccountSelectors = { ...DEFAULT_ACCOUNT_SELECTORS, ...(r.adapter.account?.selectors ?? {}) };
    // Account forms submit by design: the gate is open only for them.
    const acct = await withSubmitAllowed(r.page, () => ensureAccount(r.page, { waitForCode: deps.waitForCode ?? realWaitForCode, email: jobSearchEmail }, sel));
    if (!acct.ok) return finish(r, { status: 'needs_you', reason: acct.reason, shotPath: await proofShot(r.page, packet.applicationId) });
    r.notes.push(acct.created ? `created an account for ${acct.email}` : `signed in as ${acct.email}`);
    await settle(r.page, 500);
    return null;
  }

  async function agentOrNeedsYou(r: Run, fields: FormField[], why: string): Promise<FillOutcome | null> {
    if (opts.allowAgent === false) return finish(r, { status: 'needs_you', reason: `${why} The browser agent is switched off for this campaign.`, shotPath: await proofShot(r.page, packet.applicationId) });
    const res = await tryAgent(r, fields);
    if (!res) return finish(r, { status: 'needs_you', reason: `${why} No browser agent is available yet.`, shotPath: await proofShot(r.page, packet.applicationId) });
    if (res.status !== 'done') return finish(r, { status: 'needs_you', reason: `${why} The browser agent stopped: ${res.reason}`, shotPath: await proofShot(r.page, packet.applicationId) });
    r.via = 'agent';
    // The agent filled it: the run carries on to verification here, and only a verified form is ever submitted.
    return null;
  }

  async function tryAgent(r: Run, fields: FormField[]): Promise<AgentRunResult | null> {
    if (opts.allowAgent === false) return null;
    const agent = deps.agentFill === undefined ? await realAgent() : deps.agentFill;
    if (!agent) return null;
    try {
      return await agent({ page: r.page, fields, packet, jobId: packet.jobId, signal: opts.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError' || opts.signal?.aborted) throw err;
      if ((err as Error).name === 'NotImplemented') {
        r.notes.push('browser agent not available (A06)');
        return null;
      }
      r.notes.push(`agent error: ${(err as Error).message.split('\n')[0]}`);
      return null;
    }
  }
}

async function loadCandidate(): Promise<Candidate | null> {
  const { loadProfile } = await import('../services/profileStore.ts');
  const { candidateFrom } = await import('./candidate.ts');
  const p = loadProfile();
  if (!p) return null;
  let links = {};
  try {
    links = (await import('../profile/links.ts')).getLinks(p);
  } catch {
    /* no links module */
  }
  return candidateFrom(p, links);
}

/** Record how the recipe (if any) did, heal it into a new version, or learn one from a verified run. */
function recordRecipe(r: Run, verified: boolean, detail = '') {
  // The browser agent (A06) records its own recipe runs and learns from its own traces.
  if (r.via === 'agent') return;
  try {
    if (r.recipe?.id) {
      if (verified && (r.healed || r.recipeMissing)) {
        const fresh = learned(r, r.recipe.scope, r.recipe.scopeKey, r.recipe.match.urlPattern);
        if (fresh) {
          const id = saveRecipe({ ...fresh, status: 'active' });
          recordRecipeRun(id, true, `healed ${r.healed} step(s) from v${r.recipe.version}`);
          recordRecipeRun(r.recipe.id, false, `superseded by a healed version (${r.healed} healed, ${r.recipeMissing} missing)`);
          r.notes.push(`recipe healed: new version ${id}`);
          return;
        }
      }
      // Failures that are not the recipe's fault (unknown questions, CAPTCHAs) don't count against it.
      if (detail === 'unknown questions' || detail === 'captcha') return;
      recordRecipeRun(r.recipe.id, verified, detail || (verified ? 'verified' : 'not verified'));
      return;
    }
    if (!verified) return;
    // First verified run of an adapter / generic form: emit a recipe.
    const ats = (r.ats ?? 'other') as AtsFamily;
    const scope: Recipe['scope'] = companyKey(r.job.company) ? 'company' : 'url';
    const key = scope === 'company' ? r.job.company : effectiveUrl(r.page.url()).split(/[?#]/)[0];
    const exists = all<{ id: string }>("SELECT id FROM form_recipes WHERE ats = ? AND scope = ? AND scope_key = ? AND status IN ('active','candidate','shadow')", ats, scope, scope === 'company' ? companyKey(key) : key);
    if (exists.length) return;
    const rec = learned(r, scope, key);
    if (rec) {
      const id = saveRecipe(rec);
      recordRecipeRun(id, true, `learned from a verified ${r.via} run`);
      r.notes.push(`recipe learned: ${id}`);
    }
  } catch (err) {
    r.notes.push(`recipe bookkeeping failed: ${(err as Error).message}`);
  }
}

function learned(r: Run, scope: Recipe['scope'], scopeKey: string, urlPattern?: string): Recipe | null {
  const filled = r.trace.filter((t) => t.field.selectors.length);
  if (!filled.length) return null;
  return buildRecipe({ ats: (r.ats ?? 'other') as AtsFamily, scope, scopeKey, urlPattern, filled, nexts: r.nexts.filter((n) => n.selectors.length), submit: r.submitSelectors.length ? r.submitSelectors : (r.adapter.submit ?? []) });
}

/**
 * The browser agent's fills on the page it finished on (A06 `agentIntended`),
 * plus every required field there, re-verified by the engine. Null when the
 * page has nothing to check.
 */
async function agentStep(r: Run, step: number, skip: Set<string>): Promise<StepRecord | null> {
  let got: { fields: ExtractedField[]; values: MappedValue[] } | null = null;
  try {
    got = (await import('../agent/index.ts')).agentIntended(r.page);
  } catch {
    got = null;
  }
  const fields: ExtractedField[] = (got?.fields ?? []).filter((f) => !skip.has(f.id));
  const ex = await extract(r, step);
  for (const f of ex.fields) if (f.required && !skip.has(f.id) && !fields.some((x) => x.id === f.id || x.signature === f.signature)) fields.push(f);
  if (!fields.length) return null;
  const values = (got?.values ?? []).filter((v) => fields.some((f) => f.id === v.fieldId));
  const v = await verifyFields(r.page, fields, values, { ignoreErrors: r.adapter.ignoreErrors });
  for (const x of values) {
    const f = fields.find((y) => y.id === x.fieldId);
    if (f) r.trace.push({ field: f, value: x, step });
  }
  dbg(r, `agent step: ${fields.length} fields, verified=${v.verified}${v.problems.length ? ` problems: ${v.problems.slice(0, 3).join(' | ')}` : ''}`);
  const shot = await stepShot(r.page, r.id, `step-${step + 1}-agent`);
  if (shot) r.shots.push(shot);
  return { step, fields, values, log: v.fieldLog, verified: v.verified, problems: v.problems, shot };
}

/** A verified run doubles as a shadow run for a matching candidate recipe (A06 compares in dry mode; nothing is typed). */
async function shadowHook(r: Run) {
  if (r.via === 'agent' || !r.trace.length) return;
  try {
    const mod = await import('../agent/index.ts');
    const res = await mod.shadowFromEngine({ ats: r.ats, company: r.job.company, url: r.page.url(), filled: r.trace, packet: r.packet, runId: r.id });
    if (res) r.notes.push(`shadow check of candidate recipe ${res.recipeId}: ${res.ok ? 'match' : `mismatch (${res.diff.slice(0, 2).map((d) => d.problem).join('; ')})`}, now ${res.status}`);
  } catch (err) {
    r.notes.push(`shadow check skipped: ${(err as Error).message.split('\n')[0]}`);
  }
}
