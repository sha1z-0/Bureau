import type { Page } from 'playwright-core';
import { type AgentRunResult, type Trace, TraceSchema } from '../contracts/agent.ts';
import type { FormField, Recipe } from '../contracts/forms.ts';
import type { AtsFamily } from '../contracts/job.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { get } from '../db.ts';
import type { TraceField } from '../forms/recipeRun.ts';
import { findRecipe } from '../forms/recipes.ts';
import { compileTrace as compile } from './compile.ts';
import { runRecipeJobs as jobs, type RecipeJobsSummary } from './jobs.ts';
import { agentFill as fill, type AgentDeps, agentIntended } from './loop.ts';
import { learningMetrics as metrics } from './metrics.ts';
import { queueTrace } from './queue.ts';
import { type ShadowResult, shadowVerify } from './shadow.ts';
import { saveTrace } from './trace.ts';
import { loadCandidate } from './values.ts';

/** A06 — Claude-driven browser agent for unknown forms, and the recipe learning loop. */

/** Fill the form within guardrails. Never presses the final submit: it stops at `done` for A05 to verify. */
export async function agentFill(ctx: { page: Page; fields: FormField[]; packet: ApplicationPacket; jobId: string; signal?: AbortSignal }, deps?: AgentDeps): Promise<AgentRunResult> {
  return fill(ctx, deps);
}

export async function compileTrace(traceId: string): Promise<Recipe | null> {
  return compile(traceId);
}

/**
 * Store a trace from an external agent; queued for compile and internal shadow
 * verification. Returns the trace id. The origin is always `external:<keyId>`
 * whatever the trace claims, and screenshots from another machine are dropped.
 */
export function submitExternalTrace(trace: Trace, keyId: string): string {
  const origin = `external:${String(keyId).replace(/[^\w-]/g, '').slice(0, 64) || 'unknown'}`;
  const t = TraceSchema.parse({ ...trace, id: undefined, origin, steps: trace.steps.map((s) => ({ ...s, beforeShot: undefined, afterShot: undefined })) });
  const id = saveTrace(t);
  queueTrace(id, origin, 'queued', 'external trace: compile, then internal shadow runs before any promotion');
  return id;
}

/** Recipe coverage by ATS, agent vs recipe runs over time, cost per agent run. */
export function learningMetrics(opts?: { days?: number }): Record<string, unknown> {
  return metrics(opts);
}

/** The compile + shadow-verification work queue (A08 calls it every 6 hours while a campaign is active). */
export function runRecipeJobs(): Promise<RecipeJobsSummary> {
  return jobs();
}

/**
 * A05 hook: after a verified adapter / generic / recipe run, compare the
 * matching candidate recipe (if any) with what the run used, in dry mode.
 */
export async function shadowFromEngine(input: { ats: AtsFamily | null; company: string; url: string; filled: TraceField[]; packet: ApplicationPacket; runId: string }): Promise<ShadowResult | null> {
  const cand = findRecipe({ ats: input.ats, company: input.company, url: input.url, statuses: ['candidate', 'shadow'] });
  if (!cand?.id || !input.filled.length) return null;
  const job = get<{ id: string; title: string; company: string; source: string; url: string; ats: string | null }>('SELECT id, title, company, source, url, ats FROM jobs WHERE id = ?', input.packet.jobId) ?? null;
  return shadowVerify({
    recipe: cand,
    observed: input.filled.map((t) => ({ field: t.field, value: t.value })),
    source: 'internal',
    ref: input.runId,
    vctx: { packet: input.packet, candidate: await loadCandidate().catch(() => null), job },
  });
}

export { agentIntended };
export type { AgentDeps };
