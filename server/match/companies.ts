import { all, get } from '../db.ts';

/**
 * Company identity and history across every campaign: the cooldown ("no second
 * application to the same company within N days") and hiring signals.
 * A company is its `company_id` when the scout set one, else its normalised name.
 */

const LEGAL_SUFFIX = /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|plc|gmbh|ag|sa|s\.a|sas|bv|b\.v|nv|oy|ab|aps|srl|spa|pty|pvt|private|corp|corporation|co|company|holdings|group)\b\.?/g;

/** "ACME, Inc." and "Acme Inc" and "acme" are the same company. */
export function companyNameKey(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9. ]+/g, ' ');
  const stripped = base.replace(LEGAL_SUFFIX, ' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  return stripped || base.replace(/\s+/g, ' ').trim();
}

export interface CompanyRef {
  companyId: string | null;
  company: string;
}

/** Every key a company is known by: its id (when set) and its normalised name. */
export function companyKeys(c: CompanyRef): string[] {
  const keys = [`name:${companyNameKey(c.company)}`];
  if (c.companyId) keys.unshift(`id:${c.companyId}`);
  return keys;
}

export interface CompanyActivity {
  key: string;
  company: string;
  jobId: string;
  at: string;
  kind: 'submitted' | 'in_flight';
}

/** States where an application to this company is under way but not yet sent. */
export const IN_FLIGHT_STATES = ['selected', 'writing', 'written', 'filling', 'verified', 'rehearsed'] as const;

/**
 * Applications sent in the last `days` days, across all campaigns: v1/v2
 * applications marked sent/submitted, plus pipeline rows that reached
 * `submitted` (an external agent may mark a job submitted with no application row).
 */
export function recentSubmissions(days: number, nowIso: string): CompanyActivity[] {
  if (days <= 0) return [];
  const since = new Date(Date.parse(nowIso) - days * 86_400_000).toISOString();
  const apps = all<{ job_id: string; company: string; company_id: string | null; at: string }>(
    `SELECT a.job_id, j.company, j.company_id, COALESCE(a.sent_at, a.updated_at) AS at
       FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.status IN ('sent', 'submitted') AND COALESCE(a.sent_at, a.updated_at) >= ?`,
    since,
  );
  const piped = all<{ job_id: string; company: string; company_id: string | null; at: string }>(
    `SELECT p.job_id, j.company, j.company_id, p.updated_at AS at
       FROM pipeline p JOIN jobs j ON j.id = p.job_id
      WHERE (p.state = 'submitted' OR (p.state = 'needs_you' AND ${maybeSentSql('p.job_id')})) AND p.updated_at >= ?`,
    since,
  );
  return expand([...apps, ...piped], 'submitted');
}

/**
 * A live submit that may have gone out (crash or kill mid-submit, a click with no confirmation) is journaled as
 * `maybe_sent`. Until the owner settles it, it counts as sent: no duplicate listing, no second role at that company.
 * The journal table belongs to the campaign engine; without it nothing can be in doubt.
 */
const journalExists = () => !!get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'campaign_steps'");

/** SQL condition: the job in `jobCol` may already have been sent. */
export function maybeSentSql(jobCol: string): string {
  return journalExists() ? `EXISTS (SELECT 1 FROM campaign_steps s WHERE s.job_id = ${jobCol} AND s.step = 'maybe_sent')` : '0';
}

export function maybeSent(jobId: string): boolean {
  return journalExists() && !!get("SELECT 1 FROM campaign_steps WHERE job_id = ? AND step = 'maybe_sent' LIMIT 1", jobId);
}

/** Jobs currently on their way to an application (selected … rehearsed), across all campaigns. */
export function inFlight(): CompanyActivity[] {
  const rows = all<{ job_id: string; company: string; company_id: string | null; at: string }>(
    `SELECT p.job_id, j.company, j.company_id, p.updated_at AS at
       FROM pipeline p JOIN jobs j ON j.id = p.job_id
      WHERE p.state IN (${IN_FLIGHT_STATES.map(() => '?').join(',')})`,
    ...IN_FLIGHT_STATES,
  );
  return expand(rows, 'in_flight');
}

function expand(rows: { job_id: string; company: string; company_id: string | null; at: string }[], kind: CompanyActivity['kind']): CompanyActivity[] {
  const out: CompanyActivity[] = [];
  for (const r of rows) {
    for (const key of companyKeys({ companyId: r.company_id, company: r.company })) out.push({ key, company: r.company, jobId: r.job_id, at: r.at, kind });
  }
  return out;
}

/** Index activity by company key for O(1) lookups. */
export function byCompany(activity: CompanyActivity[]): Map<string, CompanyActivity[]> {
  const m = new Map<string, CompanyActivity[]>();
  for (const a of activity) {
    const list = m.get(a.key) ?? [];
    list.push(a);
    m.set(a.key, list);
  }
  return m;
}

/** The first activity recorded against any of this company's keys, excluding the job itself. */
export function activityFor(index: Map<string, CompanyActivity[]>, c: CompanyRef & { jobId?: string }): CompanyActivity[] {
  const seen = new Set<string>();
  const out: CompanyActivity[] = [];
  for (const key of companyKeys(c)) {
    for (const a of index.get(key) ?? []) {
      if (a.jobId === c.jobId || seen.has(a.jobId)) continue;
      seen.add(a.jobId);
      out.push(a);
    }
  }
  return out.sort((x, y) => y.at.localeCompare(x.at));
}

// ── Hiring signals (A01 fills companies.signals and jobs.priority) ────────────

const SIGNAL_WINDOW_DAYS = 30;

/** Company keys with a hiring signal in the last 30 days (or an undated one). */
export function companiesWithSignals(nowIso: string): Set<string> {
  const rows = all<{ id: string; name: string; signals: string; open_roles: number | null; prev_open_roles: number | null }>(
    "SELECT id, name, signals, open_roles, prev_open_roles FROM companies WHERE signals NOT IN ('', '[]', '{}') OR (open_roles IS NOT NULL AND prev_open_roles IS NOT NULL)",
  );
  const since = Date.parse(nowIso) - SIGNAL_WINDOW_DAYS * 86_400_000;
  const out = new Set<string>();
  for (const r of rows) {
    if (hasRecentSignal(r.signals, since) || roleSurge(r.open_roles, r.prev_open_roles)) {
      out.add(`id:${r.id}`);
      out.add(`name:${companyNameKey(r.name)}`);
    }
  }
  return out;
}

/** A sudden rise in open roles: at least +5 and +50% over the previous count. */
export function roleSurge(open: number | null, prev: number | null): boolean {
  if (open == null || prev == null) return false;
  return open - prev >= 5 && open >= prev * 1.5;
}

function hasRecentSignal(raw: string, since: number): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.values(parsed as Record<string, unknown>) : [];
  return list.some((s) => {
    if (!s) return false;
    if (typeof s !== 'object') return true;
    const o = s as Record<string, unknown>;
    const when = [o.at, o.ts, o.date, o.detectedAt, o.seenAt].find((v) => typeof v === 'string') as string | undefined;
    if (!when) return true;
    const t = Date.parse(when);
    return !Number.isFinite(t) || t >= since;
  });
}

export function hasHiringSignal(signals: Set<string>, c: CompanyRef & { priority: number }): boolean {
  if (c.priority > 0) return true;
  return companyKeys(c).some((k) => signals.has(k));
}
