import { htmlToText } from '../security/sanitize.ts';
import type { AtsFamily, RawJob as Raw } from '../contracts/job.ts';
import type { CompanyTarget, SourceContext } from './types.ts';
import { HttpError } from './http.ts';

export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isRemote(...hints: (string | undefined | null | boolean)[]): boolean {
  return hints.some((h) => h === true || (typeof h === 'string' && /remote|anywhere|worldwide|distributed/i.test(h)));
}

export function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.]/g, '')) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Mailboxes that never take applications: privacy, legal, support, accessibility requests and no-reply senders. */
const NOT_APPLY = /^(privacy|dpo|gdpr|legal|abuse|security|support|help|info@?|noreply|no-reply|donotreply|do-not-reply|accommodations?|accessibility|press|media|billing|sales|unsubscribe|postmaster|webmaster)([._+-]|$)/i;

/** The first address in a posting that could take an application (null when there is none). */
export function firstEmail(text: string): string | null {
  for (const m of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) if (!NOT_APPLY.test(m[0].split('@')[0])) return m[0];
  return null;
}

/**
 * A job seeker's own post ("Location: … Remote: Yes / Willing to relocate: No / Technologies: …"), the format of
 * HN's "Who wants to be hired?" thread, sometimes posted in "Who is hiring?" by mistake. It is not a job.
 */
export function looksLikeSeekerPost(text: string): boolean {
  const head = text.slice(0, 600);
  return /willing to relocate\s*:/i.test(head) || (/^\s*location\s*:/im.test(head) && /\bremote\s*:\s*(yes|no)\b/i.test(head));
}

export function withinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() <= days * 86_400_000;
}

/** Run tasks with a small concurrency cap; failures are reported, never thrown. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = text.toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

export { htmlToText };

// ── v2: per-company board polling ───────────────────────────────────────────

/** Registry targets for this ATS, plus (for the v1 families) the boards saved in settings. */
export function targetsFor(ctx: SourceContext, ats: AtsFamily, settingsTokens: string[] = []): CompanyTarget[] {
  const out: CompanyTarget[] = [];
  const seen = new Set<string>();
  for (const t of ctx.targets?.(ats) ?? []) {
    const k = t.token.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  for (const token of settingsTokens) {
    const k = token.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ companyId: null, name: null, token });
    }
  }
  return out;
}

/**
 * Poll many company boards with a concurrency cap. Each board's outcome goes to
 * `ctx.reportBoard` (open-role counts, dead boards); failures are logged in one
 * line and never sink the whole connector.
 */
export async function pollBoards(
  ctx: SourceContext,
  ats: AtsFamily,
  label: string,
  targets: CompanyTarget[],
  concurrency: number,
  fetchBoard: (t: CompanyTarget) => Promise<{ jobs: Raw[]; count: number; name?: string }>,
): Promise<Raw[]> {
  const failed: string[] = [];
  const results = await pool(targets, concurrency, async (t) => {
    try {
      const r = await fetchBoard(t);
      ctx.reportBoard?.(ats, t.token, { ok: true, count: r.count, name: r.name });
      return r.jobs;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : (err as { status?: number }).status;
      ctx.reportBoard?.(ats, t.token, { ok: false, count: 0, status, error: (err as Error).message });
      failed.push(t.token);
      throw err;
    }
  });
  if (failed.length) ctx.log(`${label}: ${failed.length}/${targets.length} board(s) unreachable — ${failed.slice(0, 6).join(', ')}`);
  if (targets.length && failed.length === targets.length) throw new Error(`${label}: every board failed (${failed.length})`);
  return results.flatMap((r) => r ?? []);
}

/** "Acme_Corp" / "acme-corp" → "Acme Corp" when the ATS doesn't tell us the company name. */
export function prettyCompany(token: string): string {
  return token
    .replace(/^eu:/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(inc|llc|hq|jobs|careers)\b/gi, '')
    .replace(/\d+$/, '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Thrown by a connector that can't run on this machine or is blocked by policy; the scout shows it as `unavailable`, not `failing`. */
export class SourceUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceUnavailable';
  }
}
