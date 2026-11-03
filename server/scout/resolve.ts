import type { AtsFamily, RawJob } from '../contracts/job.ts';
import { all, db, get, now, run } from '../db.ts';
import { canonicalUrl, normalizeForFingerprint } from '../services/classify.ts';
import { searchableAts, searchBoard, type BoardPosting } from '../sources/boardSearch.ts';
import { request, usingLiveTransport } from '../sources/http.ts';
import { boardUrlFor, detectAts, detectAtsInHtml, employerDomain, findAtsUrls } from './detect.ts';
import { isGenericCompany, titleTokens } from './ingest.ts';
import { companyKey } from './registry.ts';

/**
 * Resolve aggregator listings (JobSpy rows from LinkedIn/Indeed/Google/Bayt,
 * remote boards, HN, Reddit) to the employer's own apply URL, cheapest first:
 *
 *  Offline (no request, no budget):
 *   1. the resolver cache (listing URL → apply URL, with a TTL per outcome);
 *   2. an ATS posting link in the listing's own text (HN comments, feeds);
 *   3. a posting already stored from the company's ATS board, matched by
 *      title (company by registry name or domain).
 *  Network (per-run budget, deadline, small concurrency; every request goes
 *  through sources/http.ts → the SSRF-guarded safeFetch, spaced per host):
 *   4. the company's ATS board from the registry, searched by title through
 *      the public board API;
 *   5. the listing page (guest pages only, robots.txt respected; never
 *      LinkedIn/Indeed/Google/Bayt/Reddit/HN/YC): its redirect, ATS links and
 *      embeds, then its outbound "apply" link followed one hop (Arbeitnow's
 *      /apply and Working Nomads' /job/go/ redirect straight to the ATS);
 *   6. a board guessed from the company name on Greenhouse/Lever/Ashby/Workable
 *      (kept only when a posting's title matches closely);
 *   7. the employer's careers page (domain from JobSpy's company_url_direct or
 *      an employer-site apply link), for an ATS embed, then step 4's search.
 *  Failing all that, an outbound apply link on the employer's own site is
 *  kept as the apply URL (counted as `employerSite`, not `resolved`).
 *
 * Nothing here logs in, solves a challenge, fills or submits a form. Under
 * replay (BUREAU_REPLAY=1) with the live transport — the e2e — the new network
 * lookups (4, 6, 7 and the outbound follow in 5) are off: only the offline
 * steps and the original single page fetch run, and those go to the recorded
 * feeds like every other request.
 */

/** Guest-search and community pages are never fetched for resolution. */
const NO_RESOLVE = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.[a-z.]+|google\.[a-z.]+|ziprecruiter\.com|naukri\.com|naukrigulf\.com|bayt\.com|reddit\.com|ycombinator\.com|workatastartup\.com|rozee\.pk|mustakbil\.com|github\.com|githubusercontent\.com|simplify\.jobs)$/i;

/**
 * Listing pages that never carry the employer's link for a guest (apply is
 * login-gated or script-only, or the page is behind a bot wall): not fetched.
 */
const NO_PAGE = /(^|\.)(weworkremotely\.com|remotive\.com|himalayas\.app|themuse\.com|remoteok\.com)$/i;

/** Job boards, aggregators and social sites: a link there is never the employer's own apply page. */
const BOARD_HOST =
  /(^|\.)(linkedin|indeed|glassdoor|ziprecruiter|google|bayt|naukri|naukrigulf|rozee|mustakbil|ycombinator|workatastartup|github|githubusercontent|reddit|remoteok|remotive|himalayas|jobicy|weworkremotely|arbeitnow|themuse|workingnomads|4dayweek|python|simplify|wellfound|angel|larajobs|jobspresso|workwithindies|remotegamejobs|aiapply|facebook|twitter|x|instagram|youtube|t|discord|tiktok|pinterest|medium|fairygodboss|apple|bit|lnkd|live|outlook|office|office365|gmail|yahoo|proton)\.[a-z.]+$/i;

/** Boards whose listing has an apply endpoint that redirects to the employer (saves fetching the listing). */
const APPLY_HOP: [RegExp, (u: URL) => string | null][] = [
  [/(^|\.)arbeitnow\.(com|co\.uk|de)$/i, (u) => (/^\/jobs\/companies\/[^/]+\/[^/]+\/?$/.test(u.pathname) ? `${u.origin}${u.pathname.replace(/\/$/, '')}/apply` : null)],
];

const FAMILIES_TO_GUESS: AtsFamily[] = ['greenhouse', 'lever', 'ashby', 'workable'];
const DAY = 86_400_000;
const TTL = { hit: 30 * DAY, miss: 2 * DAY, company: 14 * DAY };

db.exec(`CREATE TABLE IF NOT EXISTS resolver_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  checked_at TEXT NOT NULL
)`);

export interface ResolveOptions {
  budget: { left: number };
  deadline: number;
  isKnown?: (url: string) => boolean;
  discover?: (urls: string[], via: string) => void;
  concurrency?: number;
  /**
   * Run the network lookups beyond the listing page itself (board APIs, name
   * guesses, careers pages, outbound links). Default: on, except under replay
   * with the live transport, where only recorded feeds may be fetched.
   */
  lookups?: boolean;
}

export interface ResolveStats {
  /** Listings that went to the network phase (each spends one unit of budget). */
  tried: number;
  /** Listings now pointing at a posting on the employer's ATS. */
  resolved: number;
  skippedKnown: number;
  failed: number;
  /** Of `resolved`: without a request (cache, the listing's own text, a stored posting). */
  offline: number;
  /** Of `resolved`: by title on the company's ATS board (registry, page link, careers page or name guess). */
  boards: number;
  /** Of `resolved`: the listing page's redirect or links. */
  pages: number;
  /** Not on a known ATS, but now pointing at the employer's own apply page. */
  employerSite: number;
}

export function emptyResolveStats(): ResolveStats {
  return { tried: 0, resolved: 0, skippedKnown: 0, failed: 0, offline: 0, boards: 0, pages: 0, employerSite: 0 };
}

export function lookupsAllowed(): boolean {
  return !(process.env.BUREAU_REPLAY === '1' && usingLiveTransport());
}

const web = (u?: string | null): u is string => !!u && /^https?:\/\//i.test(u);
const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const isBoardHost = (u: string) => BOARD_HOST.test(hostOf(u));
const postingUrl = (u?: string | null): u is string => web(u) && !!detectAts(u)?.jobId;

/** The listing page to fetch, or null when there's nothing to resolve or the page is off limits. */
export function resolutionStart(j: RawJob): string | null {
  if (web(j.applyUrl) && detectAts(j.applyUrl)) return null;
  if (web(j.url) && detectAts(j.url)) return null;
  const start = web(j.applyUrl) ? j.applyUrl : web(j.url) ? j.url : null;
  if (!start) return null;
  const host = hostOf(start);
  if (!host || NO_RESOLVE.test(host)) return null;
  return start;
}

// ── Title matching ──────────────────────────────────────────────────────────

const SENIORITY = new Set(['senior', 'junior', 'staff', 'principal', 'lead', 'intern', 'internship', 'head', 'director', 'manager', 'associate', 'assistant', 'graduate', 'entry', 'ii', 'iii', 'iv', 'vp', 'chief', 'apprentice', 'trainee', 'founding', 'working', 'student']);
const ROMAN: Record<string, string> = { '2': 'ii', '3': 'iii', '4': 'iv' };

/** Strip what boards add to a title: emoji, "| 55-69K", "(Remote)", "- Remote - Nationwide", "[Hiring]". */
export function cleanTitle(t: string): string {
  return t
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/\s+[|•·]\s+/)[0]
    .replace(/\(([^)]*\b(remote|hybrid|on-?site|anywhere|usa?|uk|eu|emea|apac|latam|worldwide|full[- ]time|part[- ]time|contract|m\/w\/d|f\/m\/d|m\/f\/d)\b[^)]*)\)/gi, ' ')
    .replace(/\s[-–—,]\s*(remote|hybrid|on-?site|full[- ]time|part[- ]time|contract|work from home)\b.*$/i, ' ')
    .replace(/[$€£]?\d+(?:[.,]\d+)?\s?k?\s?[-–]\s?[$€£]?\d+(?:[.,]\d+)?\s?k\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(title: string): Set<string> {
  return new Set([...titleTokens(cleanTitle(title))].map((w) => ROMAN[w] ?? w));
}

/** Jaccard similarity of cleaned title tokens, or 0 when the two differ in seniority ("Senior" vs none, "II" vs "III"). */
export function titleMatch(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter++;
    else if (SENIORITY.has(x)) return 0;
  }
  for (const x of B) if (!A.has(x) && SENIORITY.has(x)) return 0;
  return inter / (A.size + B.size - inter);
}

/** The posting whose title matches best (at least `min`), location breaking ties. */
export function matchPosting(title: string, location: string | null | undefined, postings: BoardPosting[], min = 0.7): BoardPosting | null {
  const loc = new Set(normalizeForFingerprint(location ?? '').split(' ').filter((w) => w.length > 1));
  let best: { p: BoardPosting; score: number; loc: number } | null = null;
  for (const p of postings) {
    if (!web(p.url)) continue;
    const score = titleMatch(title, p.title);
    if (score < min) continue;
    const l = normalizeForFingerprint(p.location).split(' ').filter((w) => loc.has(w)).length;
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && l > best.loc)) best = { p, score, loc: l };
  }
  return best?.p ?? null;
}

// ── Cache ───────────────────────────────────────────────────────────────────

function cacheGet<T>(key: string, ttl: (v: T) => number): T | undefined {
  const row = get<{ value: string; checked_at: string }>('SELECT value, checked_at FROM resolver_cache WHERE key = ?', key);
  if (!row) return undefined;
  try {
    const v = JSON.parse(row.value) as T;
    return Date.now() - Date.parse(row.checked_at) < ttl(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function cachePut(key: string, value: unknown) {
  run(
    'INSERT INTO resolver_cache (key, value, checked_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, checked_at = excluded.checked_at',
    key,
    JSON.stringify(value),
    now(),
  );
}

interface Outcome {
  /** '' when nothing was found. */
  url: string;
  kind: 'ats' | 'site' | 'none';
}
const listingKey = (j: RawJob) => `job:${canonicalUrl(j.url || j.applyUrl || '')}`;
const outcomeTtl = (o: Outcome) => (o.kind === 'ats' ? TTL.hit : o.kind === 'site' ? TTL.miss * 3 : TTL.miss);

// ── Registry ────────────────────────────────────────────────────────────────

interface Board {
  ats: AtsFamily;
  token: string;
}
interface RegRow {
  id: string;
  name: string;
  domain: string | null;
  ats: string | null;
  ats_token: string | null;
  status: string;
}
interface Registry {
  byKey: Map<string, RegRow[]>;
  byDomain: Map<string, RegRow[]>;
}

function loadRegistry(): Registry {
  const byKey = new Map<string, RegRow[]>();
  const byDomain = new Map<string, RegRow[]>();
  for (const r of all<RegRow>("SELECT id, name, domain, ats, ats_token, status FROM companies WHERE status != 'paused'")) {
    // "Hewlett Packard (HP)" is also "HP".
    const alias = r.name.match(/\(([^)]{2,40})\)/)?.[1];
    for (const k of new Set([companyKey(r.name), alias ? companyKey(alias) : ''])) if (k) byKey.set(k, [...(byKey.get(k) ?? []), r]);
    if (r.domain) byDomain.set(r.domain, [...(byDomain.get(r.domain) ?? []), r]);
  }
  return { byKey, byDomain };
}

/** The employer's own domain, when the listing carries it (JobSpy's company_url_direct, a registry board's domain). */
function jobDomain(j: RawJob): string | null {
  const d = j.companyDomain ? employerDomain(`https://${j.companyDomain}`) : null;
  return d && !BOARD_HOST.test(d) ? d : null;
}

function companyRows(j: RawJob, reg: Registry): RegRow[] {
  if (isGenericCompany(j.company)) return [];
  const rows = [...(reg.byKey.get(companyKey(j.company)) ?? [])];
  const d = jobDomain(j);
  if (d) rows.push(...(reg.byDomain.get(d) ?? []));
  return [...new Map(rows.map((r) => [r.id, r])).values()];
}

function boardsOf(rows: RegRow[]): Board[] {
  const out: Board[] = [];
  for (const r of rows) {
    if (!r.ats || !r.ats_token || r.status === 'dead' || r.status === 'employer') continue;
    if (searchableAts(r.ats as AtsFamily)) out.push({ ats: r.ats as AtsFamily, token: r.ats_token });
  }
  return out;
}

function addBoard(list: Board[], b: Board | null) {
  if (b && searchableAts(b.ats) && !list.some((x) => x.ats === b.ats && x.token.toLowerCase() === b.token.toLowerCase())) list.push(b);
}

// ── Offline steps ───────────────────────────────────────────────────────────

interface Plan {
  job: RawJob;
  boards: Board[];
  page: string | null;
  priority: number;
}

/** Steps 1–3. Returns the posting URL and how, or the plan for the network phase. */
function resolveOffline(job: RawJob, reg: Registry, cached: Outcome | undefined): { url: string; via: 'cache' | 'text' | 'stored' } | { plan: Omit<Plan, 'page' | 'priority'> } {
  if (cached?.kind === 'ats' && postingUrl(cached.url)) return { url: cached.url, via: 'cache' };
  const boards: Board[] = [];
  for (const u of [job.applyUrl, job.url]) {
    const h = web(u) ? detectAts(u) : null;
    if (h?.token) addBoard(boards, { ats: h.ats, token: h.token });
  }
  // 2. The listing's own text.
  const text = `${job.descriptionHtml ?? ''}\n${job.descriptionText ?? ''}`;
  if (text.trim()) {
    const found = findAtsUrls(text);
    const postings = [...new Set(found.filter((u) => detectAts(u)?.jobId))];
    if (postings.length === 1) return { url: postings[0], via: 'text' };
    for (const u of found) {
      const h = detectAts(u);
      if (h?.token) addBoard(boards, { ats: h.ats, token: h.token });
    }
  }
  // 3. Postings already stored for this company.
  const rows = companyRows(job, reg);
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const stored = all<{ title: string; location: string | null; apply_url_canonical: string }>(
      `SELECT title, location, apply_url_canonical FROM jobs
       WHERE company_id IN (${ids.map(() => '?').join(',')}) AND ats IS NOT NULL AND apply_url_canonical IS NOT NULL
       ORDER BY found_at DESC LIMIT 3000`,
      ...ids,
    )
      .filter((r) => postingUrl(r.apply_url_canonical))
      .map((r) => ({ title: r.title, location: r.location ?? '', url: r.apply_url_canonical }));
    const m = matchPosting(job.title, job.location, stored);
    if (m) return { url: m.url, via: 'stored' };
    for (const b of boardsOf(rows)) addBoard(boards, b);
  }
  return { plan: { job, boards } };
}

// ── Network steps ───────────────────────────────────────────────────────────

interface Ctx {
  lookups: boolean;
  /** Set when a lookup failed for a passing reason (429, timeout): the miss is then not cached. */
  uncertain?: boolean;
  discover?: (urls: string[], via: string) => void;
  deadline: number;
}

interface Found {
  url: string;
  kind: 'ats' | 'site';
  via: 'board' | 'page';
}

async function onBoards(job: RawJob, boards: Board[], ctx: Ctx, min = 0.7): Promise<string | null> {
  for (const b of boards.slice(0, 3)) {
    try {
      const postings = await searchBoard(b.ats, b.token, cleanTitle(job.title));
      const m = postings ? matchPosting(job.title, job.location, postings, min) : null;
      if (m) return m.url;
    } catch {
      ctx.uncertain = true; // a board that's down (or rate-limiting) this minute: try the next
    }
  }
  return null;
}

/** Outbound "apply" links on a listing page: explicit apply-URL fields in page data, then anchors that say apply. */
export function applyLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    try {
      const u = new URL(raw.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/'), pageUrl);
      if (!/^https?:$/.test(u.protocol)) return;
      if (/(sign-?up|log-?in|register|auto-?apply|copilot|bundles|pricing|subscribe|premium|post-?a-?job|employers?\/|\/account)/i.test(`${u.pathname}${u.search}`) && !detectAts(u.toString())) return;
      const s = u.toString();
      if (s !== pageUrl && !out.includes(s)) out.push(s);
    } catch {
      /* not a URL */
    }
  };
  for (const m of html.matchAll(/"(?:applyUrl|apply_url|applicationUrl|application_url|applicationLink|externalApplyUrl|apply_link|applyLink)"\s*:\s*"(https?:[^"]+)"/g)) add(m[1]);
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi)) {
    const attrs = m[1];
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    const text = m[2].replace(/<[^>]+>/g, ' ');
    const hint = `${text} ${attrs.match(/\b(?:class|id|data-[\w-]+|aria-label)\s*=\s*["'][^"']*["']/gi)?.join(' ') ?? ''}`;
    if (/\bapply\b|bewerben|postuler|candidatar|application/i.test(hint) || /\/(apply|go|out|redirect)(\/|$|\?)/i.test(href)) add(href);
  }
  return out.slice(0, 6);
}

/** Step 5: the listing page — its redirect, ATS links and embeds, then one hop along its apply link. */
async function onPage(job: RawJob, start: string, ctx: Ctx): Promise<Found | null> {
  const hopRule = ctx.lookups ? APPLY_HOP.find(([re]) => re.test(hostOf(start))) : undefined;
  const hop = hopRule?.[1](new URL(start)) ?? null;
  if (hop) {
    try {
      const r = await request(hop, { robots: true, accept: 'text/html,application/xhtml+xml', maxBytes: 1_500_000, timeoutMs: 20_000 });
      if (postingUrl(r.url)) return { url: r.url, kind: 'ats', via: 'page' };
    } catch {
      /* fall back to the listing page */
    }
  }
  const res = await request(start, { robots: true, accept: 'text/html,application/xhtml+xml', maxBytes: 1_500_000, timeoutMs: 20_000 });
  const landed = detectAts(res.url);
  if (landed?.jobId) return { url: res.url, kind: 'ats', via: 'page' };
  if (landed && !detectAts(start)) {
    if (ctx.lookups && landed.token) {
      const u = await onBoards(job, [{ ats: landed.ats, token: landed.token }], ctx);
      if (u) return { url: u, kind: 'ats', via: 'board' };
    }
    return { url: res.url, kind: 'site', via: 'page' };
  }
  if (!res.ok || !/html/i.test(res.contentType)) return null;
  const html = res.text();
  const found = findAtsUrls(html);
  if (found.length) ctx.discover?.(found, 'resolve');
  const jobLink = found.find((u) => detectAts(u)?.jobId);
  if (jobLink) return { url: jobLink, kind: 'ats', via: 'page' };
  if (!ctx.lookups) return null;

  // Board-level links and embeds on the page: search them by title.
  const boards: Board[] = [];
  for (const h of detectAtsInHtml(html)) if (h.token) addBoard(boards, { ats: h.ats, token: h.token });
  const viaBoard = await onBoards(job, boards, ctx);
  if (viaBoard) return { url: viaBoard, kind: 'ats', via: 'board' };

  // The page's own apply link, one hop.
  let site: string | null = null;
  const pageHost = hostOf(res.url);
  for (const link of applyLinks(html, res.url).slice(0, 3)) {
    if (Date.now() > ctx.deadline) break;
    if (postingUrl(link)) return { url: link, kind: 'ats', via: 'page' };
    const sameHost = hostOf(link) === pageHost;
    if (!sameHost && isBoardHost(link)) continue;
    try {
      const r = await request(link, { robots: true, accept: 'text/html,application/xhtml+xml', maxBytes: 1_500_000, timeoutMs: 20_000 });
      const hit = detectAts(r.url);
      if (hit?.jobId) return { url: r.url, kind: 'ats', via: 'page' };
      if (hit?.token) {
        const u = await onBoards(job, [{ ats: hit.ats, token: hit.token }], ctx);
        if (u) return { url: u, kind: 'ats', via: 'board' };
      }
      if (r.ok && /html/i.test(r.contentType)) {
        const inner = findAtsUrls(r.text()).find((u) => detectAts(u)?.jobId);
        if (inner) return { url: inner, kind: 'ats', via: 'page' };
      }
      if (r.ok && !site && !isBoardHost(r.url) && hostOf(r.url) !== pageHost) site = r.url;
    } catch {
      /* robots-disallowed or unreachable: try the next link */
    }
  }
  return site ? { url: site, kind: 'site', via: 'page' } : null;
}

/** Slug candidates for a company name: "Launch Darkly, Inc." → launchdarkly, launch-darkly. */
export function slugGuesses(company: string): string[] {
  const words = normalizeForFingerprint(company.replace(/&/g, ' and ')).split(' ').filter(Boolean);
  if (!words.length || words.length > 4) return [];
  const core = words.filter((w) => !/^(technologies|technology|tech|labs|software|group|holdings|limited|solutions|systems|io|ai|hq|global|international)$/.test(w)).join('');
  const out = [words.join(''), core.length >= 4 ? core : '', words.join('-')];
  return [...new Set(out)].filter((s) => s.length >= 3).slice(0, 2);
}

/** Step 6: a board guessed from the company name, cached per company. Only a close title match counts. */
async function onGuess(job: RawJob, ctx: Ctx): Promise<string | null> {
  const key = `co:${companyKey(job.company)}`;
  let boards = cacheGet<Board[]>(key, () => TTL.company);
  if (!boards) {
    boards = [];
    // Only a definite answer from every family (a board, or a 404) is remembered; a 429 or timeout is retried another run.
    let definite = true;
    for (const slug of slugGuesses(job.company)) {
      const hits = await Promise.all(
        FAMILIES_TO_GUESS.map(async (ats) => {
          try {
            return (await searchBoard(ats, slug, '')) ? { ats, token: slug } : null;
          } catch {
            definite = false;
            ctx.uncertain = true;
            return null;
          }
        }),
      );
      for (const h of hits) addBoard(boards, h);
      if (boards.length) break;
    }
    if (definite || boards.length) cachePut(key, boards);
  }
  for (const b of boards) {
    const u = await onBoards(job, [b], ctx, 0.8);
    if (u) {
      const board = boardUrlFor(b.ats, b.token);
      if (board) ctx.discover?.([board], 'resolve');
      return u;
    }
  }
  return null;
}

/** Step 7: the employer's careers page, for an ATS embed or link; boards cached per domain. */
async function onCareers(job: RawJob, domain: string, ctx: Ctx): Promise<string | null> {
  const key = `careers:${domain}`;
  let boards = cacheGet<Board[]>(key, () => TTL.company);
  if (!boards) {
    boards = [];
    for (const url of [`https://${domain}/careers`, `https://careers.${domain}/`]) {
      try {
        const r = await request(url, { robots: true, accept: 'text/html,application/xhtml+xml', maxBytes: 2_000_000, timeoutMs: 20_000 });
        const landed = detectAts(r.url);
        if (landed?.token) addBoard(boards, { ats: landed.ats, token: landed.token });
        if (r.ok && /html/i.test(r.contentType)) for (const h of detectAtsInHtml(r.text())) if (h.token) addBoard(boards, { ats: h.ats, token: h.token });
      } catch {
        /* no such page, or robots says no */
      }
      if (boards.length) break;
    }
    cachePut(key, boards);
  }
  return onBoards(job, boards, ctx);
}

/** A careers-looking employer link in the listing's text (HN comments link a careers page, not a posting). */
function textCareersLink(job: RawJob): string | null {
  const text = `${job.descriptionHtml ?? ''} ${job.descriptionText ?? ''}`.replace(/&amp;/g, '&');
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>()\\]+/g)) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    if (!isBoardHost(u) && !NO_RESOLVE.test(hostOf(u)) && /(careers?|jobs?|join|hiring|work-with-us|positions|openings|apply)/i.test(u)) return u;
  }
  return null;
}

async function resolveOnline(p: Plan, ctx: Ctx): Promise<Found | null> {
  const { job } = p;
  if (ctx.lookups && p.boards.length) {
    const u = await onBoards(job, p.boards, ctx);
    if (u) return { url: u, kind: 'ats', via: 'board' };
  }
  let site: Found | null = null;
  if (p.page) {
    try {
      const f = await onPage(job, p.page, ctx);
      if (f?.kind === 'ats') return f;
      site = f;
    } catch (err) {
      if (!ctx.lookups) throw err;
    }
  }
  if (!ctx.lookups || Date.now() > ctx.deadline) return site;
  if (!p.boards.length && !isGenericCompany(job.company)) {
    const u = await onGuess(job, ctx);
    if (u) return { url: u, kind: 'ats', via: 'board' };
  }
  const landed = site?.url ?? (p.page && !isBoardHost(p.page) ? p.page : null);
  const domain = jobDomain(job) ?? (landed ? employerDomain(landed) : null);
  if (domain && !BOARD_HOST.test(domain) && Date.now() < ctx.deadline) {
    const u = await onCareers(job, domain, ctx);
    if (u) return { url: u, kind: 'ats', via: 'board' };
  }
  return site;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** Does this listing still need resolving (no posting on an ATS yet)? */
function needsResolving(j: RawJob): boolean {
  return !postingUrl(j.applyUrl) && !postingUrl(j.url);
}

function setSite(job: RawJob, url: string): boolean {
  // An employer page already in hand is only replaced by the employer's ATS (a careers board without a posting id).
  if (web(job.applyUrl) && !isBoardHost(job.applyUrl) && (detectAts(job.applyUrl) || !detectAts(url))) return false;
  job.applyUrl = url;
  return true;
}

export async function resolveApplyUrls(jobs: RawJob[], opts: ResolveOptions): Promise<ResolveStats> {
  const stats = emptyResolveStats();
  const lookups = opts.lookups ?? lookupsAllowed();
  const ctx: Ctx = { lookups, discover: opts.discover, deadline: opts.deadline };
  let reg: Registry | null = null;
  const plans: Plan[] = [];
  for (const job of jobs) {
    if (!needsResolving(job) || !web(job.url || job.applyUrl)) continue;
    // A listing on a board-level ATS URL (careers page, no posting id) still gets resolved below.
    if (opts.isKnown?.(job.url)) {
      stats.skippedKnown++;
      continue;
    }
    const cached = cacheGet<Outcome>(listingKey(job), outcomeTtl);
    reg ??= loadRegistry();
    const off = resolveOffline(job, reg, cached);
    if ('url' in off) {
      job.applyUrl = off.url;
      stats.resolved++;
      stats.offline++;
      if (off.via !== 'cache') cachePut(listingKey(job), { url: off.url, kind: 'ats' } satisfies Outcome);
      continue;
    }
    if (cached?.kind === 'site') {
      if (setSite(job, cached.url)) stats.employerSite++;
      continue;
    }
    if (cached?.kind === 'none') continue; // looked recently, nothing found
    const plan = off.plan;
    const startUrl = resolutionStart(job);
    const page = startUrl && !NO_PAGE.test(hostOf(startUrl)) ? startUrl : lookups && !startUrl ? textCareersLink(job) : null;
    const worthIt = lookups ? plan.boards.length > 0 || !!page || !isGenericCompany(job.company) || !!jobDomain(job) : !!page;
    if (!worthIt) continue;
    plans.push({ ...plan, page, priority: plan.boards.length ? 0 : page ? 1 : 2 });
  }

  // Most promising first: a known board, then a fetchable page, then guesses.
  plans.sort((a, b) => a.priority - b.priority);
  const todo: Plan[] = [];
  for (const p of plans) {
    if (opts.budget.left <= 0) break;
    opts.budget.left--;
    todo.push(p);
  }
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const p = todo[i++];
      if (Date.now() > opts.deadline) return;
      stats.tried++;
      try {
        const jctx: Ctx = { ...ctx, uncertain: false };
        const f = await resolveOnline(p, jctx);
        if (f?.kind === 'ats') {
          p.job.applyUrl = f.url;
          stats.resolved++;
          if (f.via === 'board') stats.boards++;
          else stats.pages++;
        } else if (f?.kind === 'site' && setSite(p.job, f.url)) {
          stats.employerSite++;
        }
        // A miss is only remembered when every lookup gave a definite answer before the deadline.
        if (f || (!jctx.uncertain && Date.now() <= opts.deadline)) cachePut(listingKey(p.job), (f ? { url: f.url, kind: f.kind } : { url: '', kind: 'none' }) satisfies Outcome);
      } catch {
        stats.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, todo.length) }, worker));
  return stats;
}
