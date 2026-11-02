import { all, get, now, run, tx } from '../db.ts';

/**
 * Short leases that stop Bureau's own autopilot and an external agent from
 * applying to the same job at once. Lead baseline; A07 exposes it over the API
 * and A08's apply worker checks it before touching a job.
 */

export interface Claim {
  jobId: string;
  holder: string;
  expiresAt: string;
}

export function activeClaim(jobId: string): Claim | null {
  const r = get<{ job_id: string; holder: string; expires_at: string }>('SELECT * FROM claims WHERE job_id = ? AND expires_at > ?', jobId, now());
  return r ? { jobId: r.job_id, holder: r.holder, expiresAt: r.expires_at } : null;
}

/** Take (or extend) the claim. Returns null when someone else holds it. */
export function claimJob(jobId: string, holder: string, ttlMinutes = 20): Claim | null {
  return tx(() => {
    run('DELETE FROM claims WHERE expires_at <= ?', now());
    const cur = activeClaim(jobId);
    if (cur && cur.holder !== holder) return null;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    run(
      'INSERT INTO claims (job_id, holder, expires_at) VALUES (?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at',
      jobId,
      holder,
      expiresAt,
    );
    return { jobId, holder, expiresAt };
  });
}

export function releaseClaim(jobId: string, holder: string) {
  run('DELETE FROM claims WHERE job_id = ? AND holder = ?', jobId, holder);
}

/** Drop every claim one holder has (the autopilot at start-up: a dead process's leases are void). */
export function releaseAllClaims(holder: string): number {
  return Number(run('DELETE FROM claims WHERE holder = ?', holder).changes);
}

/** Job ids another holder is working on right now. */
export function claimedByOthers(holder: string): Set<string> {
  const rows = all<{ job_id: string }>('SELECT job_id FROM claims WHERE holder != ? AND expires_at > ?', holder, now());
  return new Set(rows.map((r) => r.job_id));
}
