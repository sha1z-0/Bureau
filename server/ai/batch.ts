import crypto from 'node:crypto';
import fs from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod/v4';
import { all, db, get, logEvent, now as nowIso, run, tx } from '../db.ts';
import { AppError } from '../errors.ts';
import {
  cachedSystem,
  client,
  currentCampaignId,
  effortFor,
  guardBudget,
  meterUsage,
  modelFor,
  recordingPath,
  REPLAY,
  replayHash,
  type SystemBlocks,
  type Task,
  type Usage,
  type UserContent,
} from './claude.ts';

/**
 * The Message Batches API: work that can wait an hour runs at half price.
 *
 * Requests are queued in memory, sent as one batch by flush(), and tracked in
 * sqlite (ai_batches, ai_batch_requests) so a restart picks up where it left
 * off: poll() asks Anthropic about each open batch no more often than its
 * backoff allows (1 minute at first, growing with the batch's age to 15
 * minutes), and when a batch has ended stores every result and meters it at
 * the batch price (50% of every token rate) against the campaign that queued
 * it. A result is read back by its custom id, a hash of the full request, so
 * asking the same question again finds the same answer.
 *
 * A request carries the same model, system blocks (with their prompt-cache
 * breakpoints), effort, output schema and max_tokens as the direct call. The
 * direct call's server-side refusal fallback (`fallbacks`) is not accepted by
 * the Batches API, so it is left out; a refused, cut-off, errored, expired or
 * cancelled request is marked failed and the caller makes the normal call. A
 * batch that cannot be created switches batching off for an hour (normal calls
 * meanwhile).
 *
 * Uses client().beta.messages.batches (create, retrieve, results). In replay
 * mode (BUREAU_REPLAY=1) a fake served from the recordings stands in, and tests
 * can pass any BatchApi.
 */

export const BATCH_PRICE_FACTOR = 0.5;
const MIN_POLL_MS = 60_000;
const MAX_POLL_MS = 15 * 60_000;
const KEEP_MS = 7 * 24 * 3_600_000;
const DOWN_MS = 3_600_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_batches (
    id            TEXT PRIMARY KEY,
    task          TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('in_progress', 'ended', 'failed')),
    requests      INTEGER NOT NULL,
    created_at    TEXT NOT NULL,
    expires_at    TEXT,
    checked_at    TEXT,
    next_check_at TEXT NOT NULL,
    ended_at      TEXT,
    error         TEXT
  );
  CREATE TABLE IF NOT EXISTS ai_batch_requests (
    custom_id   TEXT PRIMARY KEY,
    batch_id    TEXT NOT NULL,
    task        TEXT NOT NULL,
    model       TEXT NOT NULL,
    campaign_id TEXT,
    meta        TEXT,
    status      TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'consumed')),
    text        TEXT,
    error       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ai_batch_requests_batch ON ai_batch_requests(batch_id);
  CREATE INDEX IF NOT EXISTS ai_batch_requests_task ON ai_batch_requests(task, status);
`);

type BatchParams = Anthropic.Beta.Messages.BatchCreateParams;
type BatchRequestParams = BatchParams['requests'][number]['params'];
type MessageBatch = Anthropic.Beta.Messages.BetaMessageBatch;
type BatchResponse = Anthropic.Beta.Messages.BetaMessageBatchIndividualResponse;

/** The three calls the queue makes (the SDK's client.beta.messages.batches, or a fake). */
export interface BatchApi {
  create(params: BatchParams): Promise<MessageBatch>;
  retrieve(id: string): Promise<MessageBatch>;
  results(id: string): Promise<AsyncIterable<BatchResponse>>;
}

export function sdkBatchApi(): BatchApi {
  return {
    create: (params) => client().beta.messages.batches.create(params),
    retrieve: (id) => client().beta.messages.batches.retrieve(id),
    results: (id) => client().beta.messages.batches.results(id),
  };
}

export interface BatchRequest<S extends z.ZodType = z.ZodType> {
  task: Task;
  system: SystemBlocks;
  content: UserContent;
  schema: S;
  effort?: ReturnType<typeof effortFor>;
  maxTokens?: number;
  /** Caller data kept with the request (e.g. the job ids it covers). */
  meta?: unknown;
}

export type RequestState =
  | { status: 'none' }
  | { status: 'queued' }
  | { status: 'pending'; batchId: string }
  | { status: 'succeeded'; text: string; meta: unknown }
  | { status: 'failed'; error: string; meta: unknown }
  | { status: 'consumed' };

/** Thrown to a caller whose answer is in a batch that has not ended yet. */
export class BatchPending extends AppError {
  constructor(message = 'Queued for the Message Batches API; the answer arrives with the batch.') {
    super(202, 'BATCH_PENDING', message);
  }
}

export function isBatchPending(err: unknown): boolean {
  return err instanceof AppError && err.code === 'BATCH_PENDING';
}

/** A request's custom id: task plus a hash of everything sent. Same request, same id. */
export function customIdFor(req: BatchRequest): string {
  const body = JSON.stringify({
    task: req.task,
    model: modelFor(req.task),
    system: req.system,
    content: req.content,
    effort: req.effort ?? effortFor(req.task),
    maxTokens: req.maxTokens ?? 16000,
  });
  return `${req.task}_${crypto.createHash('sha256').update(body).digest('hex').slice(0, 40)}`;
}

/** The Messages API body of a batched request: the direct call's, minus the server-side fallback. */
export function batchParams(req: BatchRequest): BatchRequestParams {
  return {
    model: modelFor(req.task),
    max_tokens: req.maxTokens ?? 16000,
    system: cachedSystem(req.system),
    output_config: { effort: req.effort ?? effortFor(req.task), format: betaZodOutputFormat(req.schema) },
    messages: [{ role: 'user', content: req.content }],
  };
}

interface Queued {
  customId: string;
  task: Task;
  model: string;
  campaignId: string | null;
  meta: unknown;
  params: BatchRequestParams;
}

interface RequestRow {
  custom_id: string;
  batch_id: string;
  task: Task;
  model: string;
  campaign_id: string | null;
  meta: string | null;
  status: 'pending' | 'succeeded' | 'failed' | 'consumed';
  text: string | null;
  error: string | null;
  updated_at: string;
}

interface BatchRow {
  id: string;
  task: string;
  status: 'in_progress' | 'ended' | 'failed';
  created_at: string;
  expires_at: string | null;
  next_check_at: string;
}

const parseMeta = (s: string | null): unknown => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

export class BatchQueue {
  private readonly api: () => BatchApi;
  private readonly clock: () => number;
  private queued = new Map<string, Queued>();
  private downUntil = 0;
  private polling: Promise<number> | null = null;

  constructor(opts: { api?: () => BatchApi; now?: () => number } = {}) {
    this.api = opts.api ?? (() => (REPLAY ? replayBatchApi() : sdkBatchApi()));
    this.clock = opts.now ?? Date.now;
  }

  private iso(ms = this.clock()) {
    return new Date(ms).toISOString();
  }

  /** False for an hour after a batch could not be created: callers make normal calls meanwhile. */
  available(): boolean {
    return this.clock() >= this.downUntil;
  }

  state(customId: string): RequestState {
    if (this.queued.has(customId)) return { status: 'queued' };
    const row = get<RequestRow>('SELECT * FROM ai_batch_requests WHERE custom_id = ?', customId);
    if (!row) return { status: 'none' };
    if (row.status === 'pending') return { status: 'pending', batchId: row.batch_id };
    if (row.status === 'succeeded') return { status: 'succeeded', text: row.text ?? '', meta: parseMeta(row.meta) };
    if (row.status === 'failed') return { status: 'failed', error: row.error ?? 'failed', meta: parseMeta(row.meta) };
    return { status: 'consumed' };
  }

  /** Queue a request for the next flush(). Returns its custom id (an already queued or stored request is not added twice). */
  enqueue(req: BatchRequest): string {
    guardBudget();
    const customId = customIdFor(req);
    const st = this.state(customId);
    if (st.status === 'queued' || st.status === 'pending' || st.status === 'succeeded') return customId;
    // A failed or consumed answer is asked again as a new request.
    if (st.status !== 'none') run('DELETE FROM ai_batch_requests WHERE custom_id = ?', customId);
    this.queued.set(customId, {
      customId,
      task: req.task,
      model: modelFor(req.task),
      campaignId: currentCampaignId(),
      meta: req.meta ?? null,
      params: batchParams(req),
    });
    return customId;
  }

  queuedCount(): number {
    return this.queued.size;
  }

  /** Parse a succeeded answer against its schema; a bad one is marked failed (the caller then calls directly). */
  read<S extends z.ZodType>(customId: string, schema: S): z.infer<S> | null {
    const st = this.state(customId);
    if (st.status !== 'succeeded') return null;
    try {
      return betaZodOutputFormat(schema).parse(st.text) as z.infer<S>;
    } catch {
      run("UPDATE ai_batch_requests SET status = 'failed', error = ?, updated_at = ? WHERE custom_id = ?", 'unreadable answer', this.iso(), customId);
      return null;
    }
  }

  /** Mark an answer as used: the same request asked later is a new request. */
  consume(customId: string) {
    run("UPDATE ai_batch_requests SET status = 'consumed', updated_at = ? WHERE custom_id = ?", this.iso(), customId);
  }

  /** Forget a failed request so the caller's direct call is the only answer. */
  forget(customId: string) {
    run('DELETE FROM ai_batch_requests WHERE custom_id = ?', customId);
  }

  /** Rows for one task, for callers that look answers up by their own keys (e.g. job ids in meta). */
  rows(task: Task, statuses: RequestRow['status'][] = ['pending', 'succeeded', 'failed']): { customId: string; status: RequestRow['status']; meta: unknown; text: string | null; batchId: string; updatedAt: string }[] {
    const marks = statuses.map(() => '?').join(',');
    return all<RequestRow>(`SELECT * FROM ai_batch_requests WHERE task = ? AND status IN (${marks}) ORDER BY created_at DESC`, task, ...statuses).map((r) => ({
      customId: r.custom_id,
      status: r.status,
      meta: parseMeta(r.meta),
      text: r.text,
      batchId: r.batch_id,
      updatedAt: r.updated_at,
    }));
  }

  /** Send everything queued as one batch per task. Returns how many requests went out. */
  async flush(): Promise<number> {
    if (!this.queued.size) return 0;
    const byTask = new Map<Task, Queued[]>();
    for (const q of this.queued.values()) byTask.set(q.task, [...(byTask.get(q.task) ?? []), q]);
    this.queued.clear();
    let sent = 0;
    for (const [task, items] of byTask) {
      let batch: MessageBatch;
      try {
        batch = await this.api().create({ requests: items.map((q) => ({ custom_id: q.customId, params: q.params })) });
      } catch (err) {
        this.downUntil = this.clock() + DOWN_MS;
        logEvent('ai', `Message batch for ${items.length} ${task} request(s) could not be created; normal calls for the next hour. ${(err as Error).message.slice(0, 200)}`);
        continue;
      }
      const ts = this.iso();
      tx(() => {
        run(
          `INSERT INTO ai_batches (id, task, status, requests, created_at, expires_at, next_check_at) VALUES (?, ?, 'in_progress', ?, ?, ?, ?)`,
          batch.id,
          task,
          items.length,
          ts,
          batch.expires_at ?? null,
          this.iso(this.clock() + MIN_POLL_MS),
        );
        for (const q of items) {
          run(
            `INSERT OR REPLACE INTO ai_batch_requests (custom_id, batch_id, task, model, campaign_id, meta, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
            q.customId,
            batch.id,
            q.task,
            q.model,
            q.campaignId,
            JSON.stringify(q.meta ?? null),
            ts,
            ts,
          );
        }
      });
      sent += items.length;
      logEvent('ai', `Sent ${items.length} ${task} request(s) as message batch ${batch.id} (50% off; results usually within the hour)`);
    }
    return sent;
  }

  /** Open batches whose next check is due (or all open batches with force). */
  dueBatches(force = false): BatchRow[] {
    const rows = all<BatchRow>("SELECT * FROM ai_batches WHERE status = 'in_progress' ORDER BY created_at");
    return force ? rows : rows.filter((b) => Date.parse(b.next_check_at) <= this.clock());
  }

  openBatches(): number {
    return get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_batches WHERE status = 'in_progress'")?.n ?? 0;
  }

  /** Check every due batch once; collect the results of those that ended. Returns how many answers arrived. */
  poll(force = false): Promise<number> {
    if (this.polling) return this.polling;
    this.polling = this.pollOnce(force).finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async pollOnce(force: boolean): Promise<number> {
    let arrived = 0;
    for (const b of this.dueBatches(force)) {
      const nowMs = this.clock();
      let info: MessageBatch;
      try {
        info = await this.api().retrieve(b.id);
      } catch (err) {
        // A batch Anthropic no longer knows (404) is gone: its requests fall back to normal calls.
        const status = (err as { status?: number }).status;
        if (status === 404) this.failBatch(b.id, 'batch not found');
        else this.reschedule(b, nowMs);
        continue;
      }
      if (info.processing_status === 'ended') {
        try {
          arrived += await this.collect(b.id);
        } catch {
          this.reschedule(b, nowMs);
        }
        continue;
      }
      const expires = Date.parse(info.expires_at ?? b.expires_at ?? '');
      if (Number.isFinite(expires) && nowMs > expires + 10 * 60_000) {
        this.failBatch(b.id, 'batch expired');
        continue;
      }
      this.reschedule(b, nowMs);
    }
    this.prune();
    return arrived;
  }

  private reschedule(b: BatchRow, nowMs: number) {
    const age = nowMs - Date.parse(b.created_at);
    const wait = Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, age / 4));
    run('UPDATE ai_batches SET checked_at = ?, next_check_at = ? WHERE id = ?', this.iso(nowMs), this.iso(nowMs + wait), b.id);
  }

  private failBatch(id: string, error: string) {
    const ts = this.iso();
    tx(() => {
      run("UPDATE ai_batches SET status = 'failed', error = ?, checked_at = ?, ended_at = ? WHERE id = ?", error, ts, ts, id);
      run("UPDATE ai_batch_requests SET status = 'failed', error = ?, updated_at = ? WHERE batch_id = ? AND status = 'pending'", error, ts, id);
    });
  }

  /** Store every result of an ended batch and meter the succeeded ones at the batch price. */
  private async collect(batchId: string): Promise<number> {
    const pending = new Map(all<RequestRow>("SELECT * FROM ai_batch_requests WHERE batch_id = ? AND status = 'pending'", batchId).map((r) => [r.custom_id, r]));
    let ok = 0;
    for await (const r of await this.api().results(batchId)) {
      const row = pending.get(r.custom_id);
      if (!row) continue;
      pending.delete(r.custom_id);
      const ts = this.iso();
      if (r.result.type !== 'succeeded') {
        run("UPDATE ai_batch_requests SET status = 'failed', error = ?, updated_at = ? WHERE custom_id = ?", r.result.type, ts, r.custom_id);
        continue;
      }
      const msg = r.result.message;
      meterUsage(row.task, msg.model ?? row.model, msg.usage as Usage, { priceFactor: BATCH_PRICE_FACTOR, campaignId: row.campaign_id });
      if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') {
        run("UPDATE ai_batch_requests SET status = 'failed', error = ?, updated_at = ? WHERE custom_id = ?", msg.stop_reason, ts, r.custom_id);
        continue;
      }
      const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      run("UPDATE ai_batch_requests SET status = 'succeeded', text = ?, updated_at = ? WHERE custom_id = ?", text, ts, r.custom_id);
      ok++;
    }
    const ts = this.iso();
    tx(() => {
      // Anything the results file did not mention counts as failed.
      for (const id of pending.keys()) run("UPDATE ai_batch_requests SET status = 'failed', error = 'missing from results', updated_at = ? WHERE custom_id = ?", ts, id);
      run("UPDATE ai_batches SET status = 'ended', checked_at = ?, ended_at = ? WHERE id = ?", ts, ts, batchId);
    });
    if (ok) logEvent('ai', `Message batch ${batchId} ended: ${ok} answer(s) in`);
    return ok;
  }

  private prune() {
    const cutoff = this.iso(this.clock() - KEEP_MS);
    run("DELETE FROM ai_batch_requests WHERE updated_at < ? AND status IN ('consumed', 'failed', 'succeeded')", cutoff);
    run("DELETE FROM ai_batches WHERE status IN ('ended', 'failed') AND COALESCE(ended_at, created_at) < ?", cutoff);
  }
}

/**
 * A structured()-shaped function that goes through a batch queue: an answer
 * already in returns at once; one still in a batch, or just queued, throws
 * BatchPending; a failed one, or any call while batching is down, is made
 * directly with `direct` (normally claude.ts structured()).
 */
export function batchedStructured<F extends (opts: BatchRequest & { schema: z.ZodType }) => Promise<unknown>>(queue: BatchQueue, direct: F): F {
  const fn = async (opts: BatchRequest) => {
    const id = customIdFor(opts);
    const st = queue.state(id);
    if (st.status === 'succeeded') {
      const out = queue.read(id, opts.schema);
      if (out !== null) {
        queue.consume(id);
        return out;
      }
      queue.forget(id);
      return direct(opts);
    }
    if (st.status === 'pending' || st.status === 'queued') throw new BatchPending();
    if (st.status === 'failed') {
      queue.forget(id);
      return direct(opts);
    }
    if (!queue.available()) return direct(opts);
    queue.enqueue(opts);
    throw new BatchPending();
  };
  return fn as F;
}

// ── Replay ───────────────────────────────────────────────────────────────────

const replayBatches = new Map<string, { batch: MessageBatch; requests: BatchParams['requests'] }>();

/**
 * Offline stand-in for replay mode: a batch "ends" as soon as it is created and
 * each request is answered from the same recording the direct call would use
 * (fixtures/claude/<task>/<hash>.json, hashed on task, system text and content).
 * A request with no recording comes back errored, so the caller falls back.
 */
export function replayBatchApi(): BatchApi {
  return {
    async create(params) {
      const id = `msgbatch_replay_${replayBatches.size + 1}_${crypto.randomBytes(4).toString('hex')}`;
      const ts = nowIso();
      const batch: MessageBatch = {
        id,
        type: 'message_batch',
        processing_status: 'ended',
        created_at: ts,
        ended_at: ts,
        expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        archived_at: null,
        cancel_initiated_at: null,
        results_url: null,
        request_counts: { processing: 0, succeeded: params.requests.length, errored: 0, canceled: 0, expired: 0 },
      };
      replayBatches.set(id, { batch, requests: params.requests });
      return batch;
    },
    async retrieve(id) {
      const b = replayBatches.get(id);
      if (!b) throw Object.assign(new Error('batch not found'), { status: 404 });
      return b.batch;
    },
    async results(id) {
      const b = replayBatches.get(id);
      if (!b) throw Object.assign(new Error('batch not found'), { status: 404 });
      return (async function* () {
        for (const r of b.requests) yield replayAnswer(r);
      })();
    },
  };
}

function replayAnswer(r: BatchParams['requests'][number]): BatchResponse {
  const task = r.custom_id.slice(0, r.custom_id.lastIndexOf('_'));
  const system = (Array.isArray(r.params.system) ? r.params.system : []) as SystemBlocks;
  const content = r.params.messages[0]?.content as UserContent;
  const file = recordingPath(task, replayHash(task, system, content));
  if (!fs.existsSync(file)) return { custom_id: r.custom_id, result: { type: 'errored', error: { type: 'error', error: { type: 'not_found_error', message: 'no recording' }, request_id: null } } } as BatchResponse;
  const rec = JSON.parse(fs.readFileSync(file, 'utf8')) as { model: string; usage: Usage; output?: unknown };
  return {
    custom_id: r.custom_id,
    result: {
      type: 'succeeded',
      message: {
        id: `msg_replay_${r.custom_id}`,
        type: 'message',
        role: 'assistant',
        model: rec.model,
        content: [{ type: 'text', text: JSON.stringify(rec.output), citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: rec.usage,
      },
    },
  } as BatchResponse;
}
