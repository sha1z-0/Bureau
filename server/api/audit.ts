import { all, get, now, run } from '../db.ts';

/**
 * api_audit: one row per external call (REST request, MCP JSON-RPC method or
 * MCP tool call), successful or not. `detail` is a small JSON object and never
 * carries a key, a token, a screenshot or an answer value.
 */

export interface AuditEntry {
  id: number;
  keyId: string | null;
  keyName: string | null;
  ts: string;
  route: string;
  status: number;
  detail: Record<string, unknown>;
}

const RETAIN_DAYS = 90;
let writes = 0;

export function writeAudit(e: { keyId: string | null; route: string; status: number; detail?: Record<string, unknown> }) {
  let detail = '';
  try {
    detail = JSON.stringify(e.detail ?? {});
  } catch {
    detail = '{}';
  }
  if (detail.length > 1000) detail = JSON.stringify({ truncated: true, text: detail.slice(0, 900) });
  try {
    run('INSERT INTO api_audit (key_id, ts, route, status, detail) VALUES (?, ?, ?, ?, ?)', e.keyId, now(), e.route.slice(0, 200), e.status, detail);
    if (++writes % 500 === 0) pruneAudit();
  } catch (err) {
    // The audit log must never take an API call down with it.
    console.error(`api_audit write failed: ${(err as Error).message}`);
  }
}

export function pruneAudit(days = RETAIN_DAYS): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return Number(run('DELETE FROM api_audit WHERE ts < ?', cutoff).changes);
}

export function listAudit(q: { keyId?: string | null; limit?: number; before?: number | null; status?: 'ok' | 'error' | null } = {}): AuditEntry[] {
  const limit = Math.max(1, Math.min(500, q.limit ?? 100));
  const rows = all<{ id: number; key_id: string | null; name: string | null; ts: string; route: string; status: number; detail: string | null }>(
    `SELECT a.id, a.key_id, k.name, a.ts, a.route, a.status, a.detail FROM api_audit a LEFT JOIN api_keys k ON k.id = a.key_id
      WHERE (? IS NULL OR a.key_id = ?) AND (? IS NULL OR a.id < ?)
        AND (? IS NULL OR (? = 'ok' AND a.status < 400) OR (? = 'error' AND a.status >= 400))
      ORDER BY a.id DESC LIMIT ?`,
    q.keyId ?? null,
    q.keyId ?? null,
    q.before ?? null,
    q.before ?? null,
    q.status ?? null,
    q.status ?? null,
    q.status ?? null,
    limit,
  );
  return rows.map((r) => {
    let detail: Record<string, unknown> = {};
    try {
      detail = r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : {};
    } catch {
      /* keep empty */
    }
    return { id: r.id, keyId: r.key_id, keyName: r.name, ts: r.ts, route: r.route, status: r.status, detail };
  });
}

export function auditCount(keyId?: string): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM api_audit WHERE (? IS NULL OR key_id = ?)', keyId ?? null, keyId ?? null)?.n ?? 0;
}
