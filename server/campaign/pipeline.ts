import { all, get, now, run, tx } from '../db.ts';
import { AppError } from '../errors.ts';
import { emit } from '../services/bus.ts';
import { TRANSITIONS, type PipelineRow, type PipelineState } from '../contracts/campaign.ts';

/**
 * The per-job state machine. Every module moves jobs through here, so illegal
 * jumps (and double submissions) are impossible by construction. Lead baseline;
 * A08 owns and extends it (backoff, scheduling, resume).
 */

export class IllegalTransition extends AppError {
  constructor(jobId: string, from: PipelineState | null, to: PipelineState) {
    super(409, 'ILLEGAL_TRANSITION', `Job ${jobId} cannot move from ${from ?? 'nothing'} to ${to}`);
  }
}

interface Row {
  job_id: string;
  campaign_id: string | null;
  state: PipelineState;
  attempts: number;
  next_action_at: string | null;
  last_error: string | null;
  updated_at: string;
}

const toRow = (r: Row): PipelineRow => ({
  jobId: r.job_id,
  campaignId: r.campaign_id,
  state: r.state,
  attempts: r.attempts,
  nextActionAt: r.next_action_at,
  lastError: r.last_error,
  updatedAt: r.updated_at,
});

export function pipelineState(jobId: string): PipelineRow | null {
  const r = get<Row>('SELECT * FROM pipeline WHERE job_id = ?', jobId);
  return r ? toRow(r) : null;
}

export function canTransition(from: PipelineState | null, to: PipelineState): boolean {
  if (from === null) return to === 'found';
  return from === to || TRANSITIONS[from].includes(to);
}

/** Put a job into the pipeline at `found` if it isn't there yet. */
export function ensurePipeline(jobId: string, campaignId: string | null = null): PipelineRow {
  const existing = pipelineState(jobId);
  if (existing) return existing;
  return transition(jobId, 'found', { campaignId });
}

/**
 * Move a job to `to`. Moving to the state it is already in is a no-op, so steps
 * can be retried safely. Anything not in TRANSITIONS throws IllegalTransition.
 */
export function transition(
  jobId: string,
  to: PipelineState,
  opts: { campaignId?: string | null; reason?: string; nextActionAt?: string | null; error?: string | null; countAttempt?: boolean } = {},
): PipelineRow {
  const result = tx(() => {
    const cur = get<Row>('SELECT * FROM pipeline WHERE job_id = ?', jobId);
    const from = cur?.state ?? null;
    if (!canTransition(from, to)) throw new IllegalTransition(jobId, from, to);
    if (cur && from === to) return { row: toRow(cur), changed: false, from };
    const ts = now();
    if (!cur) {
      run(
        'INSERT INTO pipeline (job_id, campaign_id, state, attempts, next_action_at, last_error, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
        jobId,
        opts.campaignId ?? null,
        to,
        opts.nextActionAt ?? null,
        opts.error ?? null,
        ts,
      );
    } else {
      run(
        `UPDATE pipeline SET state = ?, campaign_id = COALESCE(?, campaign_id), attempts = attempts + ?, next_action_at = ?,
           last_error = ?, updated_at = ? WHERE job_id = ?`,
        to,
        opts.campaignId ?? null,
        opts.countAttempt ? 1 : 0,
        opts.nextActionAt ?? null,
        opts.error ?? null,
        ts,
        jobId,
      );
    }
    run('INSERT INTO pipeline_log (job_id, ts, from_state, to_state, reason) VALUES (?, ?, ?, ?, ?)', jobId, ts, from, to, opts.reason ?? null);
    return { row: toRow(get<Row>('SELECT * FROM pipeline WHERE job_id = ?', jobId)!), changed: true, from };
  });
  if (result.changed) {
    emit({ type: 'pipeline.state', jobId, from: result.from, to, campaignId: result.row.campaignId, reason: opts.reason });
  }
  return result.row;
}

// ── A08 extensions (read-only helpers; the write path above is unchanged) ────

export interface PipelineLogEntry {
  ts: string;
  from: PipelineState | null;
  to: PipelineState;
  reason: string | null;
}

/** Every transition a job went through, oldest first. */
export function pipelineLog(jobId: string): PipelineLogEntry[] {
  return all<{ ts: string; from_state: PipelineState | null; to_state: PipelineState; reason: string | null }>(
    'SELECT ts, from_state, to_state, reason FROM pipeline_log WHERE job_id = ? ORDER BY id ASC',
    jobId,
  ).map((r) => ({ ts: r.ts, from: r.from_state, to: r.to_state, reason: r.reason }));
}

/** How many jobs sit in each state, for one campaign (or all). */
export function countByState(campaignId: string | null = null): Partial<Record<PipelineState, number>> {
  const rows = all<{ state: PipelineState; n: number }>(
    'SELECT state, COUNT(*) AS n FROM pipeline WHERE (? IS NULL OR campaign_id = ?) GROUP BY state',
    campaignId,
    campaignId,
  );
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}

/** Rows in the given states, newest first. */
export function pipelineRows(campaignId: string | null, states: readonly PipelineState[], limit = 200): PipelineRow[] {
  if (!states.length) return [];
  return all<Row>(
    `SELECT * FROM pipeline WHERE (? IS NULL OR campaign_id = ?) AND state IN (${states.map(() => '?').join(',')})
     ORDER BY updated_at DESC LIMIT ?`,
    campaignId,
    campaignId,
    ...states,
    limit,
  ).map(toRow);
}
