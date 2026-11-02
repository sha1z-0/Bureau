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

/** One posting, fenced. Only stable fields: no clocks, no ids that change between runs. */
export function renderJob(j: MatchJob): string {
  const desc = j.descriptionText.slice(0, MAX_DESCRIPTION);
  const salary =
    j.salaryMin || j.salaryMax ? `${j.salaryMin ? money(j.salaryMin) : '?'} to ${j.salaryMax ? money(j.salaryMax) : '?'} ${j.salaryCurrency ?? ''}`.trim() : 'not stated';
  return `<job_posting id="${j.id}">
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
  return `Assess ${jobs.length === 1 ? 'this job' : `these ${jobs.length} jobs`} for the candidate: the chance they pass the screen.\n\n${jobs.map(renderJob).join('\n\n')}`;
}

export type StructuredFn = typeof structured;

export interface BatchCall {
  task: Task;
  system: SystemBlocks;
  content: string;
  jobIds: string[];
}

/** Assess one batch. Results come back keyed by job id; unknown ids are dropped. */
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
  const wanted = new Set(jobs.map((j) => j.id));
  const byId = new Map<string, JobMatchAssessment>();
  for (const r of out.results) if (wanted.has(r.id) && !byId.has(r.id)) byId.set(r.id, r);
  return byId;
}
