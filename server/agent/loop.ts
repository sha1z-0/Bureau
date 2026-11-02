import crypto from 'node:crypto';
import type { Page, Route } from 'playwright-core';
import { type AgentAction, AgentActionSchema, type AgentRunResult } from '../contracts/agent.ts';
import type { FormField } from '../contracts/forms.ts';
import type { AtsFamily } from '../contracts/job.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { structured, type SystemBlocks, type UserContent, REPLAY } from '../ai/claude.ts';
import { get, now, run } from '../db.ts';
import { emit } from '../services/bus.ts';
import type { Candidate } from '../forms/candidate.ts';
import { detectOnPage } from '../forms/detect.ts';
import { type ExtractedField, extractStep, frameFor } from '../forms/extract.ts';
import { armSubmitGuard, withSubmitAllowed } from '../forms/guard.ts';
import { fillField } from '../forms/handlers/index.ts';
import { jobInfo, type JobInfo, type MapOptions, type MappedValue, mapFieldsWith, MIN_CONFIDENCE } from '../forms/map.ts';
import { labelNorm, valuesMatch } from '../forms/normalize.ts';
import { inFrame, type ReadResult } from '../forms/page.ts';
import { findRecipe, recordRecipeRun } from '../forms/recipes.ts';
import { verifyFields } from '../forms/verify.ts';
import { clickVerdict, detectInjection, FINAL_RE, type InjectionHit, NEXT_RE, policyFor, urlVerdict, type UrlPolicy } from './guard.ts';
import { agentOp, type Clickable, type Snapshot } from './page.ts';
import { agentContent, agentSystem, type FieldView, type HistoryItem } from './prompt.ts';
import { replayRecipe } from './replay.ts';
import { TraceRecorder, saveTrace } from './trace.ts';
import { catalogue, isKnownKey, keyOf, loadCandidate, resolveKey, type ValueCtx } from './values.ts';
import { queueTrace } from './queue.ts';
import './schema.ts';

/**
 * agentFill: Claude drives the browser one action at a time, inside guardrails,
 * for forms no recipe or adapter covers. Recipe first: an active recipe for this
 * page replays deterministically with no Claude call. A candidate recipe is
 * shadow-checked (dry mode) against what the agent does. The agent never presses
 * the final submit: it stops at `done` after verifying, and A05 re-verifies and
 * is the only one that submits.
 */

export const MAX_STEPS = 60;
export const TIME_LIMIT_MS = 6 * 60_000;

export interface DecideRequest {
  system: SystemBlocks;
  content: UserContent;
  turn: number;
  state: TurnState;
}

export interface TurnState {
  url: string;
  fields: FieldView[];
  controls: Clickable[];
  history: HistoryItem[];
  injections: InjectionHit[];
  notes: string[];
  catalogue: ReturnType<typeof catalogue>;
}

export interface AgentDeps {
  /** One agent turn. Default: Claude (`structured()`, task agent_step). Tests and the recorder inject their own. */
  decide?: (req: DecideRequest) => Promise<AgentAction>;
  /** The candidate's facts (default: loaded from the profile). */
  candidate?: Candidate | null;
  /** Answer-bank / writer dependencies for the mapper (ask_value and suggestions). */
  map?: MapOptions['deps'];
  maxSteps?: number;
  timeLimitMs?: number;
  /** Compile a verified trace into a candidate recipe at once (default true; runRecipeJobs does it otherwise). */
  compile?: boolean;
  /** Replay active recipes and shadow-check candidates (default true). */
  recipes?: boolean;
  /** Trace origin (default `internal`). */
  origin?: string;
}

export interface AgentCtx {
  page: Page;
  fields: FormField[];
  packet: ApplicationPacket;
  jobId: string;
  signal?: AbortSignal;
}

interface Intended {
  field: ExtractedField;
  value: MappedValue;
  page: number;
}

/** What the agent filled on the page it finished on, for A05's re-verification. */
const lastIntended = new WeakMap<Page, { fields: ExtractedField[]; values: MappedValue[] }>();

export function agentIntended(page: Page): { fields: ExtractedField[]; values: MappedValue[] } | null {
  return lastIntended.get(page) ?? null;
}

function abortError(): Error {
  const e = new Error('Browser agent stopped by the kill switch.');
  e.name = 'AbortError';
  return e;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

async function settle(page: Page, ms = 400) {
  await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(ms).catch(() => {});
}

async function fingerprint(page: Page): Promise<string> {
  const f = await inFrame<{ heads: string; ctl: number; step: string; url: string }>(page.mainFrame(), 'fingerprint').catch(() => null);
  return f ? `${f.url}|${f.heads}|${f.step}|${f.ctl}` : '';
}

async function challengeOn(page: Page): Promise<string | null> {
  for (const fr of page.frames()) {
    if (fr.isDetached()) continue;
    const c = await inFrame<{ found: boolean; kind: string }>(fr, 'challenge').catch(() => null);
    if (c?.found) return c.kind;
  }
  return null;
}

/** Current values of the fields, read in place (grouped per frame). */
async function readValues(page: Page, fields: ExtractedField[]): Promise<Map<string, ReadResult>> {
  const byFrame = new Map<ReturnType<typeof frameFor>, ExtractedField[]>();
  for (const f of fields) byFrame.set(frameFor(page, f), [...(byFrame.get(frameFor(page, f)) ?? []), f]);
  const out = new Map<string, ReadResult>();
  for (const [fr, list] of byFrame) {
    const res = await inFrame<Record<string, ReadResult>>(fr, 'read', { items: list.map((f) => ({ id: f.id, kind: f.kind, trigger: f.meta?.trigger === 'button' })) }).catch(() => ({}) as Record<string, ReadResult>);
    for (const f of list) out.set(f.id, res[f.id] ?? { exists: false, value: '' });
  }
  return out;
}

function costSince(rowid: number): number {
  return Number(get<{ c: number }>("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_usage WHERE rowid > ? AND task = 'agent_step'", rowid)?.c ?? 0);
}

/** One Claude turn, raced against the kill switch and the time limit. */
async function decideTurn(decide: (r: DecideRequest) => Promise<AgentAction>, req: DecideRequest, signal: AbortSignal | undefined, msLeft: number): Promise<AgentAction | 'timeout'> {
  let onAbort: (() => void) | null = null;
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      decide(req),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), Math.max(1, msLeft));
      }),
      new Promise<never>((_, reject) => {
        if (!signal) return;
        onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

async function claudeDecide(req: DecideRequest): Promise<AgentAction> {
  return structured({ task: 'agent_step', system: req.system, content: req.content, schema: AgentActionSchema, maxTokens: 1200 });
}

/** Screenshots go to Claude only on live runs: they would make replay hashes unstable. */
async function withVision(page: Page, text: string): Promise<UserContent> {
  if (REPLAY || process.env.BUREAU_RECORD === '1' || process.env.BUREAU_AGENT_VISION === '0') return text;
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 45, timeout: 5_000 });
    return [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } },
      { type: 'text', text },
    ];
  } catch {
    return text;
  }
}

export async function agentFill(ctx: AgentCtx, deps: AgentDeps = {}): Promise<AgentRunResult> {
  const { page, packet, jobId, signal } = ctx;
  checkAbort(signal);
  const t0 = Date.now();
  const maxSteps = Math.max(1, Math.min(MAX_STEPS, deps.maxSteps ?? MAX_STEPS));
  const timeLimit = Math.max(500, deps.timeLimitMs ?? TIME_LIMIT_MS);
  const decide = deps.decide ?? claudeDecide;
  let job: JobInfo | null = null;
  try {
    job = jobInfo(jobId);
  } catch {
    job = null;
  }
  const jobUrls = get<{ url: string; apply_url_canonical: string | null }>('SELECT url, apply_url_canonical FROM jobs WHERE id = ?', jobId);
  const startUrl = page.url();
  const ats = ((await detectOnPage(page, job?.ats).catch(() => job?.ats ?? null)) ?? null) as AtsFamily | null;
  const policy: UrlPolicy = policyFor([startUrl, jobUrls?.url, jobUrls?.apply_url_canonical], ats);
  const candidate = deps.candidate !== undefined ? deps.candidate : await loadCandidate().catch(() => null);
  const vctx: ValueCtx = { packet, candidate, job };
  const files = { cv: packet.cvPdfPath, letter: packet.letterPdfPath };
  const mapDeps: MapOptions['deps'] = { ...deps.map, candidate: () => candidate };
  const cache = new Map();
  const origin = deps.origin ?? 'internal';
  const runId = crypto.randomUUID();
  const usageMark = Number(get<{ m: number }>('SELECT COALESCE(MAX(rowid), 0) AS m FROM ai_usage')?.m ?? 0);
  run('INSERT INTO agent_runs (id, job_id, url, ats, status, started_at) VALUES (?, ?, ?, ?, ?, ?)', runId, jobId, startUrl, ats, 'running', now());

  const rec = new TraceRecorder(page, { jobId, applicationId: packet.applicationId ?? null, origin, ats });
  const intended = new Map<string, Intended>();
  const injections: InjectionHit[] = [];
  const history: HistoryItem[] = [];
  const notes: string[] = [];
  const blocked: string[] = [];
  let pageStep = 0;
  let mode: 'agent' | 'recipe' = 'agent';
  let recipeId: string | null = null;

  const publish = () => {
    const cur = [...intended.values()].filter((x) => x.page === pageStep);
    lastIntended.set(page, { fields: cur.map((x) => x.field), values: cur.map((x) => x.value) });
  };

  // Navigation guard: the main frame may only go to the job's own application site (no login, no payment).
  const onRoute = async (route: Route) => {
    const req = route.request();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      const v = urlVerdict(req.url(), policy);
      if (!v.ok) {
        blocked.push(`${req.url().slice(0, 120)}: ${v.why}`);
        return route.abort('blockedbyclient');
      }
    }
    return route.fallback();
  };

  const finish = async (status: AgentRunResult['status'], reason: string, outcome: 'verified' | 'failed' | 'gave_up'): Promise<AgentRunResult> => {
    const trace = rec.toTrace(page.url() || startUrl, outcome);
    let traceId: string | null = null;
    try {
      traceId = saveTrace(trace);
      // Only an agent's own verified run teaches anything; a recipe replay or a failure is kept for the record.
      queueTrace(traceId, origin, outcome === 'verified' && mode === 'agent' ? 'queued' : 'skipped', mode === 'recipe' ? `recipe replay (${recipeId})` : outcome !== 'verified' ? `outcome ${outcome}` : '');
    } catch (err) {
      notes.push(`trace not saved: ${(err as Error).message}`);
    }
    const costUsd = Math.round(costSince(usageMark) * 1e6) / 1e6;
    run(
      'UPDATE agent_runs SET trace_id = ?, mode = ?, recipe_id = ?, status = ?, reason = ?, steps = ?, cost_usd = ?, injection_attempts = ?, injections = ?, finished_at = ? WHERE id = ?',
      traceId,
      mode,
      recipeId,
      status,
      reason.slice(0, 1000),
      rec.steps.length,
      costUsd,
      injections.length,
      JSON.stringify(injections),
      now(),
      runId,
    );
    if (injections.length) {
      emit({ type: 'activity', level: 'warn', jobId, message: `Browser agent ignored ${injections.length} prompt-injection attempt(s) on ${new URL(startUrl).host}: “${injections[0].snippet.slice(0, 90)}”` });
    }
    if (status === 'done' && traceId && mode === 'agent') {
      await learnFrom(traceId).catch((err) => notes.push(`learning: ${(err as Error).message}`));
    }
    return { status, reason, traceId, steps: rec.steps.length, costUsd, injectionAttempts: injections.length };
  };

  /** Shadow-check the candidate and compile this run (verified agent runs only). */
  const shadowCandidate = deps.recipes === false ? null : findRecipe({ ats, company: job?.company, url: startUrl, statuses: ['candidate', 'shadow'] });
  const learnFrom = async (traceId: string) => {
    const { shadowVerify } = await import('./shadow.ts');
    if (shadowCandidate?.id) {
      await shadowVerify({ recipe: shadowCandidate, observed: [...intended.values()].map((x) => ({ field: x.field, value: x.value })), source: 'internal', ref: traceId, vctx });
    }
    if (deps.compile !== false) {
      const { compileTrace } = await import('./compile.ts');
      await compileTrace(traceId);
    }
  };

  lastIntended.delete(page);
  await armSubmitGuard(page.context(), page).catch(() => {});
  await page.route('**/*', onRoute).catch(() => {});
  try {
    await rec.begin();

    // 1. An active recipe replays deterministically: no Claude call at all.
    if (deps.recipes !== false) {
      const active = findRecipe({ ats, company: job?.company, url: startUrl, statuses: ['active'] });
      if (active?.id) {
        const r = await replayRecipe(page, active, { vctx, files, signal, policy, rec, mapDeps });
        for (const x of r.intended) intended.set(x.field.id, { ...x, page: x.page });
        pageStep = r.page;
        if (r.verified) {
          mode = 'recipe';
          recipeId = active.id;
          publish();
          recordRecipeRun(active.id, true, `replayed by the agent (${r.filled} fields)`);
          return await finish('done', `Replayed recipe ${active.id} v${active.version} (${active.scope}: ${active.scopeKey}) and verified it.`, 'verified');
        }
        recordRecipeRun(active.id, false, `agent replay did not verify: ${r.problems.slice(0, 3).join('; ')}`);
        notes.push(`A saved recipe did not verify here (${r.problems.slice(0, 2).join('; ')}); finish the form.`);
      }
    }

    // 2. The Claude loop.
    let doneTries = 0;
    for (let turn = 0; ; turn++) {
      checkAbort(signal);
      if (turn >= maxSteps) return await finish('budget', `Step limit reached (${maxSteps} actions).`, 'failed');
      const left = timeLimit - (Date.now() - t0);
      if (left <= 0) return await finish('budget', `Time limit reached (${Math.round(timeLimit / 1000)} s).`, 'failed');

      const here = urlVerdict(page.url(), policy);
      if (!here.ok) {
        await page.goBack({ timeout: 5_000 }).catch(() => {});
        if (!urlVerdict(page.url(), policy).ok) return await finish('blocked', `Left the application site: ${here.why}.`, 'failed');
        notes.push(`Bureau went back: ${here.why}.`);
      }
      const captcha = await challengeOn(page);
      if (captcha) return await finish('blocked', `A CAPTCHA (${captcha}) is on the page: Bureau never touches those, so it needs you.`, 'gave_up');

      // Observe.
      const ex = await extractStep(page, pageStep);
      const fields = ex.fields.slice(0, 60);
      const snap = await agentOp<Snapshot>(page.mainFrame(), 'snapshot', { maxText: 3000 }).catch(() => ({ title: '', url: page.url(), headings: [], clickables: [], text: '' }) as Snapshot);
      const scan: { where: string; text: string }[] = await agentOp<{ where: string; text: string }[]>(page.mainFrame(), 'scan').catch(() => []);
      for (const fr of page.frames()) {
        if (fr === page.mainFrame() || fr.isDetached() || !ex.frames.some((n) => n.url === fr.url() && !n.skipped)) continue;
        scan.push(...(await agentOp<{ where: string; text: string }[]>(fr, 'scan').catch(() => [])));
      }
      for (const h of detectInjection(scan)) if (!injections.some((x) => x.snippet === h.snippet)) injections.push(h);
      const reads = await readValues(page, fields);
      const mapped = await mapFieldsWith(fields, packet, { writer: false, job, cache, deps: mapDeps }).catch(() => [] as MappedValue[]);
      const suggestions = new Map(mapped.filter((m) => !m.unknown && m.value && m.confidence >= MIN_CONFIDENCE).map((m) => [m.fieldId, m]));
      const views: FieldView[] = fields.map((f) => {
        const r = reads.get(f.id);
        const s = suggestions.get(f.id);
        let suggest: string | null = null;
        if (s) {
          const k = keyOf(s);
          const key = `${k.source}:${k.key}`;
          suggest = k.source !== 'answer_bank' && isKnownKey(key, vctx) ? key : 'yes (use "suggested")';
        }
        const current = f.kind === 'file' ? (r?.value ?? '') : (r?.display || r?.value || '');
        return { field: f, current, suggest };
      });
      const state: TurnState = { url: page.url(), fields: views, controls: snap.clickables, history, injections, notes: [...notes], catalogue: catalogue(vctx) };
      const content = agentContent({
        job: job ? { title: job.title, company: job.company } : null,
        url: page.url(),
        title: snap.title,
        turn,
        maxSteps,
        catalogue: state.catalogue,
        fields: views,
        controls: snap.clickables,
        headings: snap.headings,
        text: snap.text,
        history,
        notes,
        injection: injections.length > 0,
      });
      notes.length = 0;

      let action: AgentAction | 'timeout';
      try {
        action = await decideTurn(decide, { system: agentSystem(), content: await withVision(page, content), turn, state }, signal, left);
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        return await finish('error', `Claude could not take the next step: ${(err as Error).message.split('\n')[0].slice(0, 200)}`, 'failed');
      }
      if (action === 'timeout') return await finish('budget', `Time limit reached (${Math.round(timeLimit / 1000)} s).`, 'failed');
      checkAbort(signal);
      const a = AgentActionSchema.parse(action);
      const field = (id: string) => fields.find((f) => f.id === id) ?? fields.find((f) => f.signature === id) ?? null;
      const say = (result: string) => history.push({ action: a.action, target: a.target, valueKey: a.valueKey || (a.file ? `file:${a.file}` : ''), result });

      switch (a.action) {
        case 'fill':
        case 'select':
        case 'check':
        case 'upload': {
          const f = field(a.target);
          if (!f) {
            say(`refused: no field "${a.target.slice(0, 40)}" on this page`);
            break;
          }
          let key = a.valueKey.trim();
          if (a.action === 'upload' || f.kind === 'file') {
            if (!key && a.file) key = `file:${a.file}`;
            if (key === 'cv' || key === 'letter') key = `file:${key}`;
          }
          const res = resolveKey(key, f, vctx, suggestions);
          if ('error' in res) {
            say(`refused: ${res.error}`);
            await rec.add({ action: a.action, fieldSignature: f.signature, labelNorm: f.labelNorm, widget: f.kind, selectors: f.selectors, step: pageStep, ok: false, note: res.error.slice(0, 200) }, { shoot: false });
            break;
          }
          const v = { ...res.value, fieldId: f.id };
          const cur = reads.get(f.id);
          let ok: boolean;
          let readBack = '';
          if (cur?.exists && f.kind !== 'file' && cur.value && valuesMatch(f.kind, v.value, cur.value, { display: cur.display, format: f.meta?.format, strict: true })) {
            ok = true;
            readBack = cur.display || cur.value;
          } else {
            const r = await fillField(page, f, v, files);
            if (r.chosen && f.kind !== 'file') v.value = r.chosen;
            ok = r.ok;
            readBack = r.readBack;
            if (!ok) notes.push(`"${f.label}" did not take the value${r.note ? ` (${r.note.slice(0, 80)})` : ''}.`);
          }
          if (ok) intended.set(f.id, { field: f, value: v, page: pageStep });
          const k = keyOf(v);
          say(ok ? `ok, reads "${(f.kind === 'file' ? readBack.split(/[\\/]/).pop() : readBack)?.slice(0, 60) ?? ''}"` : 'failed to fill');
          await rec.add({ action: a.action, fieldSignature: f.signature, labelNorm: f.labelNorm, widget: f.kind, selectors: f.selectors, valueSource: k.source, valueKey: k.key, step: pageStep, ok });
          break;
        }
        case 'click':
        case 'next': {
          let c = a.action === 'click' ? snap.clickables.find((x) => x.ref === a.target) : undefined;
          if (a.action === 'next') c = snap.clickables.find((x) => x.ref === a.target) ?? snap.clickables.find((x) => NEXT_RE.test(x.name) && !FINAL_RE.test(x.name));
          if (!c) {
            say(a.action === 'next' ? 'refused: no Next button here; use click with a control ref' : `refused: no control "${a.target.slice(0, 40)}"`);
            break;
          }
          const verdict = clickVerdict(c, policy);
          if (!verdict.ok) {
            say(`refused: ${verdict.why}`);
            await rec.add({ action: 'click', labelNorm: labelNorm(c.name), widget: 'button', selectors: c.selectors, step: pageStep, ok: false, note: `refused: ${verdict.why}`.slice(0, 200) }, { shoot: false });
            break;
          }
          if (verdict.next) {
            // Never move past a page that does not verify (as A05 does).
            const cur = [...intended.values()].filter((x) => x.page === pageStep);
            if (cur.length) {
              const v = await verifyFields(page, cur.map((x) => x.field), cur.map((x) => x.value));
              if (!v.verified) {
                say(`refused: this page does not verify yet: ${v.problems.slice(0, 3).join('; ')}`);
                break;
              }
            }
          }
          const before = await fingerprint(page);
          const loc = page.locator(`[data-bureau-agent="${c.ref}"]`).first();
          const click = () => loc.click({ timeout: 5_000 }).then(() => true).catch(() => false);
          const clicked = verdict.next ? await withSubmitAllowed(page, click) : await click();
          await settle(page, 400);
          const after = await fingerprint(page);
          const moved = before !== after;
          const stepBefore = pageStep;
          if (verdict.next && moved) pageStep++;
          const off = urlVerdict(page.url(), policy);
          say(!clicked ? 'failed: could not click it' : blocked.length ? `blocked: ${blocked.at(-1)}` : !off.ok ? `blocked: ${off.why}` : moved ? 'ok, the page changed' : 'ok, nothing visible changed');
          await rec.add({ action: verdict.next ? 'next' : 'click', labelNorm: labelNorm(c.name), widget: 'button', selectors: c.selectors, step: stepBefore, ok: clicked && off.ok });
          blocked.length = 0;
          break;
        }
        case 'wait':
          await page.waitForTimeout(1000);
          say('waited 1 s');
          break;
        case 'ask_value': {
          const f = field(a.target);
          if (!f) {
            say(`refused: no field "${a.target.slice(0, 40)}"`);
            break;
          }
          const question = (a.question || f.label).replace(/\s+/g, ' ').trim().slice(0, 300);
          const synthetic: ExtractedField = { ...f, label: question, labelNorm: labelNorm(question) };
          const got = (await mapFieldsWith([synthetic], packet, { writer: true, job, cache, deps: mapDeps }).catch(() => [] as MappedValue[]))[0];
          if (!got || got.unknown || !got.value || got.confidence < MIN_CONFIDENCE) {
            say(`no truthful answer: ${got?.reason ?? 'nothing in the profile, answer bank or writer'}`);
            break;
          }
          const v = { ...got, fieldId: f.id };
          const r = await fillField(page, f, v, files);
          if (r.chosen && f.kind !== 'file') v.value = r.chosen;
          if (r.ok) intended.set(f.id, { field: f, value: v, page: pageStep });
          const k = keyOf(v);
          say(r.ok ? `ok (${v.source})` : 'found an answer but it did not take');
          await rec.add({ action: 'fill', fieldSignature: f.signature, labelNorm: f.labelNorm, widget: f.kind, selectors: f.selectors, valueSource: k.source, valueKey: k.key, step: pageStep, ok: r.ok, note: 'ask_value' });
          break;
        }
        case 'done': {
          const cur = [...intended.values()].filter((x) => x.page === pageStep);
          const check = [...cur.map((x) => x.field), ...fields.filter((f) => f.required && !intended.has(f.id))];
          const v = await verifyFields(page, check, cur.map((x) => x.value));
          if (v.verified) {
            publish();
            await rec.add({ action: 'done', selectors: [], step: pageStep, ok: true, note: a.reason.slice(0, 200) || undefined });
            return await finish('done', `Filled and verified ${intended.size} field(s) in ${turn + 1} turn(s); waiting for Bureau's verified submit.`, 'verified');
          }
          doneTries++;
          say(`not yet: ${v.problems.slice(0, 4).join('; ')}`);
          if (doneTries >= 3) {
            publish();
            await rec.add({ action: 'done', selectors: [], step: pageStep, ok: false, note: v.problems.slice(0, 3).join('; ').slice(0, 200) });
            return await finish('gave_up', `Could not verify the form: ${v.problems.slice(0, 3).join('; ')}`, 'failed');
          }
          break;
        }
        case 'give_up':
        default:
          publish();
          await rec.add({ action: 'give_up', selectors: [], step: pageStep, ok: true, note: a.reason.slice(0, 200) || undefined }, { shoot: false });
          return await finish('gave_up', a.reason.slice(0, 300) || 'The agent gave up.', 'gave_up');
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError' || signal?.aborted) {
      run("UPDATE agent_runs SET status = 'error', reason = 'aborted', steps = ?, finished_at = ? WHERE id = ?", rec.steps.length, now(), runId);
      throw abortError();
    }
    return await finish('error', `Agent error: ${(err as Error).message.split('\n')[0].slice(0, 200)}`, 'failed').catch(() => ({ status: 'error' as const, reason: (err as Error).message, traceId: null, steps: rec.steps.length, costUsd: 0, injectionAttempts: injections.length }));
  } finally {
    await page.unroute('**/*', onRoute).catch(() => {});
    if (!lastIntended.has(page)) publish();
  }
}
