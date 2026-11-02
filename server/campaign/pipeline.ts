import { get, now, run, tx } from '../db.ts';
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
