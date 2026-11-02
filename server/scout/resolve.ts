import type { RawJob } from '../contracts/job.ts';
import { request } from '../sources/http.ts';
import { detectAts, findAtsUrls } from './detect.ts';

/**
 * Resolve aggregator listings to the employer's own apply URL. Plain HTTP
 * through the SSRF-guarded fetch (no browser), robots.txt respected, spaced per
 * host, inside a per-run budget and deadline. The redirect target is checked
 * first (Working Nomads' /job/go/ links redirect straight to the ATS); then the
 * page itself is searched for ATS links. Board-level ATS links found on the way
 * go to registry discovery.
 */

/** Guest-search and community pages are never fetched for resolution. */
const NO_RESOLVE = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.[a-z.]+|google\.[a-z.]+|ziprecruiter\.com|naukri\.com|naukrigulf\.com|bayt\.com|reddit\.com|ycombinator\.com|workatastartup\.com|rozee\.pk|mustakbil\.com|github\.com|githubusercontent\.com|simplify\.jobs)$/i;

export interface ResolveOptions {
  budget: { left: number };
  deadline: number;
  isKnown?: (url: string) => boolean;
  discover?: (urls: string[], via: string) => void;
  concurrency?: number;
}

export interface ResolveStats {
  tried: number;
  resolved: number;
  skippedKnown: number;
  failed: number;
}

/** The URL to start from, or null when there's nothing to resolve. */
export function resolutionStart(j: RawJob): string | null {
  const web = (u?: string | null) => !!u && /^https?:\/\//i.test(u);
  if (web(j.applyUrl) && detectAts(j.applyUrl!)) return null;
  if (web(j.url) && detectAts(j.url)) return null;
  const start = web(j.applyUrl) ? j.applyUrl! : web(j.url) ? j.url : null;
  if (!start) return null;
  try {
    if (NO_RESOLVE.test(new URL(start).hostname)) return null;
  } catch {
    return null;
  }
  return start;
}

export async function resolveApplyUrls(jobs: RawJob[], opts: ResolveOptions): Promise<ResolveStats> {
  const stats: ResolveStats = { tried: 0, resolved: 0, skippedKnown: 0, failed: 0 };
  const todo: { job: RawJob; start: string }[] = [];
  for (const job of jobs) {
    const start = resolutionStart(job);
    if (!start) continue;
    if (opts.isKnown?.(job.url)) {
      stats.skippedKnown++;
      continue;
    }
    if (opts.budget.left <= 0) break;
    opts.budget.left--;
    todo.push({ job, start });
  }
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const { job, start } = todo[i++];
      if (Date.now() > opts.deadline) return;
      stats.tried++;
      try {
        const res = await request(start, { robots: true, accept: 'text/html,application/xhtml+xml', maxBytes: 1_500_000, timeoutMs: 20_000 });
        if (detectAts(res.url)?.jobId || (detectAts(res.url) && !detectAts(start))) {
          job.applyUrl = res.url;
          stats.resolved++;
          continue;
        }
        if (!res.ok || !/html/i.test(res.contentType)) continue;
        const found = findAtsUrls(res.text());
        const jobLink = found.find((u) => detectAts(u)?.jobId);
        if (jobLink) {
          job.applyUrl = jobLink;
          stats.resolved++;
        }
        if (found.length) opts.discover?.(found, 'resolve');
      } catch {
        stats.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, todo.length) }, worker));
  return stats;
}
