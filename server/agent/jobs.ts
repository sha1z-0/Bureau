import { all, get, now, run } from '../db.ts';
import { compileTrace, type CompileDeps, normaliseKey } from './compile.ts';
import { recipeValue } from '../forms/recipeRun.ts';
import type { ExtractedField } from '../forms/extract.ts';
import { evaluateCandidate, type Observed, shadowVerify } from './shadow.ts';
import { loadTrace } from './trace.ts';
import { loadCandidate } from './values.ts';
import { findRecipe } from '../forms/recipes.ts';
import { companyKey } from '../forms/normalize.ts';
import type { AtsFamily } from '../contracts/job.ts';
import './schema.ts';

/**
 * The learning work queue (A08's campaign engine calls runRecipeJobs every six
 * hours while a campaign is active; the UI can run it now).
 *
 * 1. Intake: every `agent_traces` row never queued — including external traces
 *    A07 stored itself while A06 was a stub (`origin LIKE 'external:%'`).
 * 2. Compile queued, successful traces into candidate recipes (or link them to an
 *    equivalent recipe). An external trace that matches an existing candidate is
 *    recorded as an external shadow observation, which never counts.
 * 3. Re-evaluate every candidate against the promotion / discard thresholds.
 *    Promotion needs three INTERNAL shadow matches: external input never suffices.
 */

export interface RecipeJobsSummary {
  queued: number;
  compiled: number;
  duplicates: number;
  skipped: number;
  failed: number;
  externalObservations: number;
  promoted: number;
  discarded: number;
  at: string;
}

let running: Promise<RecipeJobsSummary> | null = null;

export function runRecipeJobs(deps: CompileDeps & { limit?: number } = {}): Promise<RecipeJobsSummary> {
  running ??= work(deps).finally(() => {
    running = null;
  });
  return running;
}

async function work(deps: CompileDeps & { limit?: number }): Promise<RecipeJobsSummary> {
  const out: RecipeJobsSummary = { queued: 0, compiled: 0, duplicates: 0, skipped: 0, failed: 0, externalObservations: 0, promoted: 0, discarded: 0, at: now() };
  // 1. Intake.
  const fresh = all<{ id: string; origin: string }>('SELECT t.id, t.origin FROM agent_traces t LEFT JOIN agent_learning l ON l.trace_id = t.id WHERE l.trace_id IS NULL ORDER BY t.created_at LIMIT 500');
  for (const t of fresh) {
    run('INSERT OR IGNORE INTO agent_learning (trace_id, origin, status, detail, queued_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', t.id, t.origin, 'queued', 'picked up by the learning queue', now(), now());
    out.queued++;
  }
  // 2. Compile.
  const queued = all<{ trace_id: string; origin: string }>("SELECT trace_id, origin FROM agent_learning WHERE status = 'queued' ORDER BY queued_at LIMIT ?", Math.max(1, deps.limit ?? 100));
  let candidate: Awaited<ReturnType<typeof loadCandidate>> | undefined;
  for (const q of queued) {
    const external = q.origin.startsWith('external:');
    // An external trace for a form that already has a candidate: a data point for the record, never a vote.
    if (external) {
      const t = loadTrace(q.trace_id);
      if (t && (t.outcome === 'verified' || t.outcome === 'submitted')) {
        const company = t.jobId ? (get<{ company: string }>('SELECT company FROM jobs WHERE id = ?', t.jobId)?.company ?? '') : '';
        const cand = findRecipe({ ats: (t.ats ?? null) as AtsFamily | null, company: companyKey(company) ? company : undefined, url: t.url, statuses: ['candidate', 'shadow'] });
        if (cand?.id) {
          candidate ??= await loadCandidate().catch(() => null);
          const vctx = { packet: { cvPdfPath: 'cv', letterPdfPath: 'letter', coverLetter: '', shortAnswers: {} } as never, candidate: candidate ?? null, job: null };
          // What the external agent typed is unknown (and untrusted): its keys are resolved our way, for the record.
          const observed: Observed[] = t.steps
            .filter((s) => s.ok && s.valueSource && s.valueKey && ['fill', 'select', 'check', 'upload'].includes(s.action))
            .map((s, i) => {
              const field = { id: `ext${i}`, signature: s.fieldSignature ?? '', labelNorm: s.labelNorm ?? '', kind: (s.widget ?? 'text') as never, label: s.labelNorm ?? '', required: false, step: s.step };
              const key = normaliseKey(s.valueSource!, s.valueKey!);
              const v = recipeValue({ action: 'fill', selectors: [], widget: s.widget ?? 'text', valueSource: s.valueSource, valueKey: key }, { ...field, meta: {}, selectors: [], rawLabel: '', order: 0 } as unknown as ExtractedField, vctx);
              return { field, value: { source: s.valueSource!, key, value: v?.value ?? key } };
            });
          await shadowVerify({ recipe: cand, observed, source: q.origin, ref: q.trace_id, vctx }).catch(() => null);
          out.externalObservations++;
        }
      }
    }
    try {
      const r = await compileTrace(q.trace_id, deps);
      const st = get<{ status: string }>('SELECT status FROM agent_learning WHERE trace_id = ?', q.trace_id)?.status;
      if (r && st === 'compiled') out.compiled++;
      else if (st === 'duplicate') out.duplicates++;
      else if (st === 'failed') out.failed++;
      else out.skipped++;
    } catch (err) {
      run("UPDATE agent_learning SET status = 'failed', detail = ?, updated_at = ? WHERE trace_id = ?", (err as Error).message.slice(0, 500), now(), q.trace_id);
      out.failed++;
    }
  }
  // 3. Thresholds.
  for (const r of all<{ id: string }>("SELECT id FROM form_recipes WHERE status IN ('candidate','shadow')")) {
    const s = evaluateCandidate(r.id);
    if (s === 'active') out.promoted++;
    if (s === 'demoted') out.discarded++;
  }
  return out;
}
