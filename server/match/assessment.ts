import { structured, type SystemBlocks, type Task } from '../ai/claude.ts';
import { fence } from '../ai/prompts.ts';
import type { MatchJob } from './jobs.ts';
import { renderProfile, type MatchProfile } from './profile.ts';
import { MATCH_RUBRIC } from './rubric.ts';
import { MatchBatchSchema, type JobMatchAssessment } from './scoring.ts';

/**
 * The Claude call. The rubric and the profile are two system blocks, each with
 * a cache breakpoint, and both are byte-identical for every batch in a run (and
 * across runs while the profile is unchanged), so every call after the first
 * reads them from Anthropic's prompt cache. Only the postings vary, and they go
 * in the user turn after the last breakpoint.
 */

export const MAX_DESCRIPTION = 9000;
export const DEFAULT_BATCH = 6;

export function buildSystemBlocks(profile: MatchProfile): SystemBlocks {
  return [
    { type: 'text', text: MATCH_RUBRIC, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: renderProfile(profile), cache_control: { type: 'ephemeral' } },
  ];
}

function money(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * One posting, fenced. Only stable fields: no clocks, no ids that change between
 * runs. `key` is the posting's position in its batch ("1", "2", …), not the job's
 * database id (a random UUID), so the same postings always render the same
 * prompt and replay recordings keep matching.
 */
export function renderJob(j: MatchJob, key = '1'): string {
  const desc = j.descriptionText.slice(0, MAX_DESCRIPTION);
  const salary =
    j.salaryMin || j.salaryMax ? `${j.salaryMin ? money(j.salaryMin) : '?'} to ${j.salaryMax ? money(j.salaryMax) : '?'} ${j.salaryCurrency ?? ''}`.trim() : 'not stated';
  return `<job_posting id="${key}">
Title: ${fence(j.title)}
Company: ${fence(j.company)}
Location: ${fence(j.location) || 'not stated'}${j.remote ? ' (remote)' : ''}
Salary: ${salary}
Posted: ${j.postedAt ? j.postedAt.slice(0, 10) : 'unknown'}
URL: ${fence(j.applyUrl ?? j.url)}

${fence(desc)}${j.descriptionText.length > MAX_DESCRIPTION ? '\n[posting continues, trimmed for length]' : ''}
</job_posting>`;
}

export function renderBatchContent(jobs: MatchJob[]): string {
  return `Assess ${jobs.length === 1 ? 'this job' : `these ${jobs.length} jobs`} for the candidate: the chance they pass the screen.\n\n${jobs.map((j, i) => renderJob(j, String(i + 1))).join('\n\n')}`;
}

export type StructuredFn = typeof structured;

export interface BatchCall {
  task: Task;
  system: SystemBlocks;
  content: string;
  jobIds: string[];
}

/** Assess one batch. Results come back keyed by batch position and are returned keyed by job id; unknown keys are dropped. */
export async function assessBatch(
  jobs: MatchJob[],
  system: SystemBlocks,
  opts: { task?: Task; structuredFn?: StructuredFn; onCall?: (c: BatchCall) => void } = {},
): Promise<Map<string, JobMatchAssessment>> {
  const task = opts.task ?? 'match';
  const content = renderBatchContent(jobs);
  opts.onCall?.({ task, system, content, jobIds: jobs.map((j) => j.id) });
  const call = opts.structuredFn ?? structured;
  const out = await call({ task, system, content, schema: MatchBatchSchema, maxTokens: 16000 + 1500 * Math.max(0, jobs.length - 6) });
  // Results come back keyed by the batch position; map them to the real job ids.
  const byKey = new Map(jobs.map((j, i) => [String(i + 1), j.id]));
  const byId = new Map<string, JobMatchAssessment>();
  for (const r of out.results) {
    const id = byKey.get(r.id.trim());
    if (id && !byId.has(id)) byId.set(id, { ...r, id });
  }
  return byId;
}
