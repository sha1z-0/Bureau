import { get, now, run } from '../db.ts';
import './schema.ts';

/** The learning queue (`agent_learning`): one row per trace once it has been seen. */

export type LearningStatus = 'queued' | 'compiled' | 'duplicate' | 'skipped' | 'failed';

export function queueTrace(traceId: string, origin: string, status: LearningStatus = 'queued', detail = '') {
  const ts = now();
  run('INSERT OR IGNORE INTO agent_learning (trace_id, origin, status, detail, queued_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', traceId, origin, status, detail.slice(0, 500), ts, ts);
}

export function setLearning(traceId: string, status: LearningStatus, recipeId: string | null = null, detail = '') {
  const row = get<{ origin: string }>('SELECT origin FROM agent_traces WHERE id = ?', traceId);
  queueTrace(traceId, row?.origin ?? 'internal', status, detail);
  run('UPDATE agent_learning SET status = ?, recipe_id = COALESCE(?, recipe_id), detail = ?, updated_at = ? WHERE trace_id = ?', status, recipeId, detail.slice(0, 500), now(), traceId);
}
