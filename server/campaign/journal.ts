import { all, get, run } from '../db.ts';
import { ApplicationPacketSchema, type ApplicationPacket } from '../contracts/writer.ts';
import './schema.ts';

/**
 * The apply worker's durable record. `*_intent` rows are written before any
 * irreversible side effect and `*_done` / `outcome` rows after it, so crash
 * recovery can always tell what happened.
 */

export type StepName =
  | 'claim'
  | 'write'
  | 'route'
  | 'fill'
  | 'submit_intent'
  | 'submit_done'
  /** A live submit that may have gone out; counts as sent until the owner settles it. */
  | 'maybe_sent'
  | 'outcome'
  | 'rehearsed'
  | 'submitted'
  | 'skip'
  | 'requeue'
  | 'recover'
  | 'release'
  | 'error';

export interface StepRow {
  id: number;
  ts: string;
  campaignId: string | null;
  jobId: string | null;
  step: StepName;
  status: string;
  detail: Record<string, unknown>;
}

interface Raw {
  id: number;
  ts: string;
  campaign_id: string | null;
  job_id: string | null;
  step: StepName;
  status: string;
  detail: string;
}

const toStep = (r: Raw): StepRow => {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(r.detail) as Record<string, unknown>;
  } catch {
    /* keep empty */
  }
  return { id: r.id, ts: r.ts, campaignId: r.campaign_id, jobId: r.job_id, step: r.step, status: r.status, detail };
};

export function recordStep(
  nowMs: number,
  e: { campaignId: string | null; jobId: string | null; step: StepName; status: string; detail?: Record<string, unknown> },
): number {
  const r = run(
    'INSERT INTO campaign_steps (ts, campaign_id, job_id, step, status, detail) VALUES (?, ?, ?, ?, ?, ?)',
    new Date(nowMs).toISOString(),
    e.campaignId,
    e.jobId,
    e.step,
    e.status,
    JSON.stringify(e.detail ?? {}),
  );
  return Number(r.lastInsertRowid);
}

export function stepsForJob(jobId: string): StepRow[] {
  return all<Raw>('SELECT * FROM campaign_steps WHERE job_id = ? ORDER BY id ASC', jobId).map(toStep);
}

/** Steps for a campaign between two instants (ISO), optionally one kind. */
export function stepsBetween(campaignId: string | null, fromIso: string, toIso: string, step?: StepName): StepRow[] {
  const rows = all<Raw>(
    `SELECT * FROM campaign_steps WHERE (? IS NULL OR campaign_id = ?) AND ts >= ? AND ts < ? AND (? IS NULL OR step = ?) ORDER BY id ASC`,
    campaignId,
    campaignId,
    fromIso,
    toIso,
    step ?? null,
    step ?? null,
  );
  return rows.map(toStep);
}

export function countSteps(campaignId: string | null, step: StepName, fromIso: string, toIso: string): number {
  return (
    get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM campaign_steps WHERE (? IS NULL OR campaign_id = ?) AND step = ? AND ts >= ? AND ts < ?',
      campaignId,
      campaignId,
      step,
      fromIso,
      toIso,
    )?.n ?? 0
  );
}

/**
 * An irreversible action that started and never reported back: the newest
 * submit_intent for the job with no submit_done (or outcome) after it.
 */
export function openSubmitIntent(jobId: string): StepRow | null {
  const steps = stepsForJob(jobId);
  let open: StepRow | null = null;
  for (const s of steps) {
    if (s.step === 'submit_intent') open = s;
    else if (open && (s.step === 'submit_done' || s.step === 'outcome' || s.step === 'recover')) open = null;
  }
  return open;
}

/** The newest fill outcome recorded after the newest fill start, if any. */
export function lastOutcome(jobId: string): StepRow | null {
  const steps = stepsForJob(jobId);
  let out: StepRow | null = null;
  for (const s of steps) {
    if (s.step === 'fill' && s.status === 'started') out = null;
    else if (s.step === 'outcome') out = s;
  }
  return out;
}

// ── Packets ──────────────────────────────────────────────────────────────────

export function savePacket(jobId: string, campaignId: string | null, packet: ApplicationPacket, nowMs: number) {
  run(
    `INSERT INTO campaign_packets (job_id, campaign_id, application_id, packet, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET campaign_id = excluded.campaign_id, application_id = excluded.application_id,
       packet = excluded.packet, created_at = excluded.created_at`,
    jobId,
    campaignId,
    packet.applicationId,
    JSON.stringify(packet),
    new Date(nowMs).toISOString(),
  );
}

export function loadPacket(jobId: string): ApplicationPacket | null {
  const r = get<{ packet: string }>('SELECT packet FROM campaign_packets WHERE job_id = ?', jobId);
  if (!r) return null;
  const parsed = ApplicationPacketSchema.safeParse(JSON.parse(r.packet));
  return parsed.success ? parsed.data : null;
}

// ── Scheduled task bookkeeping ──────────────────────────────────────────────

export interface TaskRun {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

export function taskRun(scope: string, task: string): TaskRun {
  const r = get<{ last_run_at: string | null; last_ok_at: string | null; last_error: string | null }>(
    'SELECT last_run_at, last_ok_at, last_error FROM campaign_tasks WHERE scope = ? AND task = ?',
    scope,
    task,
  );
  return { lastRunAt: r?.last_run_at ?? null, lastOkAt: r?.last_ok_at ?? null, lastError: r?.last_error ?? null };
}

export function markTask(scope: string, task: string, nowMs: number, result: { ok: boolean; error?: string | null }) {
  const ts = new Date(nowMs).toISOString();
  run(
    `INSERT INTO campaign_tasks (scope, task, last_run_at, last_ok_at, last_error) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(scope, task) DO UPDATE SET last_run_at = excluded.last_run_at,
       last_ok_at = COALESCE(excluded.last_ok_at, campaign_tasks.last_ok_at), last_error = excluded.last_error`,
    scope,
    task,
    ts,
    result.ok ? ts : null,
    result.ok ? null : (result.error ?? 'failed'),
  );
}

export function allTaskRuns(scope: string): Record<string, TaskRun> {
  const rows = all<{ task: string; last_run_at: string | null; last_ok_at: string | null; last_error: string | null }>(
    'SELECT * FROM campaign_tasks WHERE scope = ?',
    scope,
  );
  return Object.fromEntries(rows.map((r) => [r.task, { lastRunAt: r.last_run_at, lastOkAt: r.last_ok_at, lastError: r.last_error }]));
}
