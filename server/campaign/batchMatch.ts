import crypto from 'node:crypto';
import type { z } from 'zod/v4';
import { structured, type SystemBlocks } from '../ai/claude.ts';
import { BatchPending, BatchQueue, isBatchPending, type BatchApi } from '../ai/batch.ts';
import { logEvent } from '../db.ts';
import { renderBatchContent, type BatchCall, type StructuredFn } from '../match/assessment.ts';
import { loadJobs } from '../match/jobs.ts';
import { MatchBatchSchema, type JobMatchAssessment } from '../match/scoring.ts';

/**
 * Bulk match scoring through the Message Batches API (autopilot setting
 * `batchMatching`, off by default).
 *
 * The matcher (server/match) is unchanged: it is handed a structuredFn and an
 * onCall hook. The first cycle queues every assessment it would have made and
 * the jobs wait (they stay `filtered`); flush() sends them as one batch. Later
 * cycles poll the batch and, once it has ended, the same jobs are assessed
 * from the stored answers, keyed by job id so a batch made up differently
 * this time (new jobs arrived, the ranking moved) still finds them. A job whose
 * answer failed (refused, cut off, errored, expired) or a cycle while batching
 * is down gets the normal call. A job already waiting in a batch is never sent
 * twice. Answers belong to the profile they were made against: a changed
 * profile (different system prompt) asks again.
 */

interface Meta {
  kind: 'match';
  systemHash: string;
  jobIds: string[];
}

const hashSystem = (system: SystemBlocks) => crypto.createHash('sha256').update(JSON.stringify(system.map((b) => b.text))).digest('hex').slice(0, 24);
const isMeta = (m: unknown): m is Meta => !!m && typeof m === 'object' && (m as Meta).kind === 'match' && Array.isArray((m as Meta).jobIds);

export interface BatchMatcher {
  /** Seams for runMatch / matchJobs (structuredFn + onCall). */
  seams(): { structuredFn: StructuredFn; onCall: (c: BatchCall) => void };
  /** Send what this cycle queued. */
  flush(): Promise<number>;
  /** Check open batches that are due. */
  poll(force?: boolean): Promise<number>;
  /** Is there something for a match cycle to do now (answers in, or a batch due a check)? */
  ready(): boolean;
  queue: BatchQueue;
}

const MAX_ANSWER_AGE_MS = 2 * 24 * 3_600_000;

export function createBatchMatcher(opts: { api?: () => BatchApi; now?: () => number; direct?: StructuredFn } = {}): BatchMatcher {
  const now = opts.now ?? Date.now;
  const queue = new BatchQueue({ api: opts.api, now });
  const direct = opts.direct ?? structured;
  let lastCallJobs: string[] | null = null;

  /** The newest stored answer for each job (same profile, at most two days old), and which jobs are waiting or failed. */
  function lookup(task: Parameters<StructuredFn>[0]['task'], systemHash: string, jobIds: string[]) {
    const ready = new Map<string, { assessment: JobMatchAssessment; customId: string }>();
    const waiting = new Set<string>();
    const failed = new Set<string>();
    const want = new Set(jobIds);
    const fresh = (now()) - MAX_ANSWER_AGE_MS;
    for (const r of queue.rows(task)) {
      if (!isMeta(r.meta) || r.meta.systemHash !== systemHash) continue;
      if (r.status === 'succeeded' && Date.parse(r.updatedAt) < fresh) continue;
      const mine = r.meta.jobIds.filter((id) => want.has(id) && !ready.has(id) && !waiting.has(id) && !failed.has(id));
      if (!mine.length) continue;
      if (r.status === 'pending') mine.forEach((id) => waiting.add(id));
      else if (r.status === 'failed') mine.forEach((id) => failed.add(id));
      else if (r.status === 'succeeded') {
        const out = queue.read(r.customId, MatchBatchSchema);
        if (!out) {
          mine.forEach((id) => failed.add(id));
          continue;
        }
        const meta = r.meta;
        for (const a of out.results) {
          const id = meta.jobIds[Number(a.id.trim()) - 1];
          if (id && want.has(id) && !ready.has(id)) ready.set(id, { assessment: a, customId: r.customId });
        }
        // A job the answer left out counts as failed.
        for (const id of mine) if (!ready.has(id)) failed.add(id);
      }
    }
    return { ready, waiting, failed };
  }

  const structuredFn = (async (o: Parameters<StructuredFn>[0]) => {
    const jobIds = lastCallJobs;
    lastCallJobs = null;
    // Not a matcher call we can key by job (no onCall first): plain request-level batching would mis-key it.
    if (!jobIds || (o.task !== 'match' && o.task !== 'score')) return direct(o);
    const systemHash = hashSystem(o.system);
    const { ready, waiting, failed } = lookup(o.task, systemHash, jobIds);
    const fresh = jobIds.filter((id) => !ready.has(id) && !waiting.has(id) && !failed.has(id));
    const results: JobMatchAssessment[] = [];
    const pos = new Map(jobIds.map((id, i) => [id, String(i + 1)]));
    for (const [id, r] of ready) results.push({ ...r.assessment, id: pos.get(id)! });

    // Failed answers, and everything while batching is down, take the normal call.
    const directIds = [...jobIds.filter((id) => failed.has(id)), ...(queue.available() ? [] : fresh)];
    const queuedIds = queue.available() ? fresh : [];
    if (directIds.length) {
      const sub = loadJobs(directIds);
      const order = directIds.filter((id) => sub.some((j) => j.id === id));
      const jobs = order.map((id) => sub.find((j) => j.id === id)!);
      const content = order.length === jobIds.length ? o.content : renderBatchContent(jobs);
      const out = (await direct({ ...o, content, maxTokens: 16000 + 1500 * Math.max(0, jobs.length - 6) } as Parameters<StructuredFn>[0])) as z.infer<typeof MatchBatchSchema>;
      for (const a of out.results) {
        const id = order[Number(a.id.trim()) - 1];
        if (id) results.push({ ...a, id: pos.get(id)! });
      }
      for (const r of queue.rows(o.task, ['failed'])) if (isMeta(r.meta) && r.meta.jobIds.some((id) => failed.has(id))) queue.forget(r.customId);
    }
    if (queuedIds.length) {
      if (queuedIds.length === jobIds.length) queue.enqueue({ task: o.task, system: o.system, content: o.content, schema: MatchBatchSchema, effort: o.effort, maxTokens: o.maxTokens, meta: { kind: 'match', systemHash, jobIds } satisfies Meta });
      else {
        const sub = loadJobs(queuedIds);
        const order = queuedIds.filter((id) => sub.some((j) => j.id === id));
        const jobs = order.map((id) => sub.find((j) => j.id === id)!);
        queue.enqueue({ task: o.task, system: o.system, content: renderBatchContent(jobs), schema: MatchBatchSchema, effort: o.effort, maxTokens: 16000 + 1500 * Math.max(0, jobs.length - 6), meta: { kind: 'match', systemHash, jobIds: order } satisfies Meta });
      }
    }
    // Answers stay stored (a batch may cover jobs this call did not ask about); they age out after two days.
    if (!results.length) throw new BatchPending(`${jobIds.length} job(s) wait for a message batch`);
    return { results } as z.infer<typeof MatchBatchSchema>;
  }) as StructuredFn;

  return {
    queue,
    seams: () => ({
      structuredFn,
      onCall: (c: BatchCall) => {
        lastCallJobs = c.jobIds;
      },
    }),
    async flush() {
      const n = await queue.flush();
      return n;
    },
    poll: (force = false) => queue.poll(force),
    // A batch due a check is reason enough: the match cycle polls it and uses whatever arrived.
    ready: () => queue.dueBatches().length > 0,
  };
}

let shared: BatchMatcher | null = null;
/** The process-wide batch matcher the autopilot uses. */
export function batchMatcher(): BatchMatcher {
  return (shared ??= createBatchMatcher());
}
export function setBatchMatcher(m: BatchMatcher | null) {
  shared = m;
}

/**
 * Run the matcher through the batch queue: poll due batches, match (answers in
 * are used, the rest queue), then send the queue. Jobs still waiting stay
 * `filtered` for the next cycle. Returns the matcher's results (possibly none).
 */
export async function matchViaBatch<R>(bm: BatchMatcher, run: (seams: ReturnType<BatchMatcher['seams']>) => Promise<R[]>): Promise<R[]> {
  await bm.poll().catch(() => 0);
  try {
    return await run(bm.seams());
  } catch (err) {
    if (isBatchPending(err)) return [];
    throw err;
  } finally {
    const sent = await bm.flush().catch((err) => {
      logEvent('ai', `Message batch flush failed: ${(err as Error).message.slice(0, 200)}`);
      return 0;
    });
    if (sent) logEvent('campaign', `Matcher: ${sent} assessment request(s) sent to the Message Batches API`);
  }
}
