import { extractFacts, type FactSourceDoc } from '../ai/profile.ts';
import { getSetting, setSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { htmlToText } from '../security/sanitize.ts';
import type { AiClient } from './ai.ts';
import { reconcileFacts, type IncomingFact } from './facts.ts';
import type { Fetcher } from './fetch.ts';
import { clip, sha } from './text.ts';
import type { PartReport } from './types.ts';

/**
 * Crawl the owner's portfolio site (same origin, at most 30 pages, robots.txt
 * respected, every request through the injected fetcher) and turn what it
 * says into near-verbatim facts with the page URL as source.
 */

export const MAX_PAGES = 30;
const PAGE_CACHE = 'profile.portfolio.pageFacts';
const MAX_BATCH_CHARS = 60_000;
const SKIP_EXT = /\.(pdf|png|jpe?g|gif|svg|webp|avif|ico|zip|gz|tgz|rar|7z|mp4|mp3|webm|mov|wav|css|js|mjs|json|xml|rss|atom|txt|woff2?|ttf|otf|eot|map|docx?|pptx?|xlsx?)$/i;

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export interface CrawlResult {
  pages: CrawledPage[];
  /** Pages that errored this time (their facts are kept from the last sync). */
  failed: string[];
  /** Pages that answered 404/410. */
  gone: string[];
  disallowed: number;
}

const hostKey = (h: string) => h.toLowerCase().replace(/^www\./, '');

function canonical(u: URL): string {
  const c = new URL(u.toString());
  c.hash = '';
  for (const k of [...c.searchParams.keys()]) if (/^(utm_|ref$|fbclid$|gclid$)/i.test(k)) c.searchParams.delete(k);
  if (c.pathname !== '/' && c.pathname.endsWith('/')) c.pathname = c.pathname.replace(/\/+$/, '');
  return c.toString();
}

/** Disallow rules for `User-agent: *` (and Bureau), longest-prefix semantics with Allow overrides. */
export function parseRobots(txt: string): (path: string) => boolean {
  const rules: { allow: boolean; path: string }[] = [];
  let applies = false;
  let inGroup = false;
  for (const line of txt.split(/\r?\n/)) {
    const l = line.replace(/#.*/, '').trim();
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m;
    if (/^user-agent$/i.test(key)) {
      if (!inGroup) applies = false;
      inGroup = true;
      if (value === '*' || /bureau/i.test(value)) applies = true;
    } else {
      inGroup = false;
      if (applies && /^(dis)?allow$/i.test(key) && value) rules.push({ allow: /^allow$/i.test(key), path: value.replace(/\*$/, '') });
    }
  }
  return (path: string) => {
    let best: { allow: boolean; path: string } | null = null;
    for (const r of rules) if (path.startsWith(r.path) && (!best || r.path.length > best.path.length)) best = r;
    return !best || best.allow;
  };
}

function links(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!href || /^(mailto|tel|javascript|data):/i.test(href) || href.startsWith('#')) continue;
    try {
      out.push(new URL(href, base).toString());
    } catch {
      /* not a URL */
    }
  }
  return out;
}

export async function crawlSite(start: string, fetcher: Fetcher, maxPages = MAX_PAGES): Promise<CrawlResult> {
  let root: URL;
  try {
    root = new URL(start);
  } catch {
    throw new AppError(400, 'BAD_URL', 'The portfolio link is not a valid web address.');
  }
  if (!/^https?:$/.test(root.protocol)) throw new AppError(400, 'BAD_URL', 'The portfolio link must be http(s).');
  const site = hostKey(root.hostname);
  let allowed: (path: string) => boolean = () => true;
  try {
    const robots = await fetcher(`${root.origin}/robots.txt`, { accept: 'text/plain', maxBytes: 256 * 1024, timeoutMs: 10_000 });
    if (robots.ok && !/html/i.test(robots.contentType)) allowed = parseRobots(robots.text());
  } catch {
    /* no robots.txt: crawl politely anyway */
  }

  const queue = [canonical(root)];
  const queued = new Set(queue);
  const res: CrawlResult = { pages: [], failed: [], gone: [], disallowed: 0 };
  let fetches = 0;
  while (queue.length && res.pages.length + res.failed.length < maxPages && fetches < maxPages * 3) {
    const url = queue.shift()!;
    const u = new URL(url);
    if (!allowed(u.pathname + u.search)) {
      res.disallowed++;
      continue;
    }
    let page;
    fetches++;
    try {
      page = await fetcher(url, { accept: 'text/html,application/xhtml+xml', maxBytes: 2 * 1024 * 1024, timeoutMs: 20_000 });
    } catch {
      res.failed.push(url);
      continue;
    }
    if (page.status === 404 || page.status === 410) {
      res.gone.push(url);
      continue;
    }
    if (!page.ok) {
      res.failed.push(url);
      continue;
    }
    if (page.contentType && !/html|xml/i.test(page.contentType)) continue;
    const finalUrl = new URL(page.url || url);
    if (hostKey(finalUrl.hostname) !== site) continue; // redirected off-site
    const html = page.text();
    const title = htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0, 200);
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
    const text = clip(htmlToText(body.replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, ' ')), 8000);
    res.pages.push({ url: canonical(finalUrl), title, text });
    for (const l of links(html, finalUrl.toString())) {
      let lu: URL;
      try {
        lu = new URL(l);
      } catch {
        continue;
      }
      if (!/^https?:$/.test(lu.protocol) || hostKey(lu.hostname) !== site || SKIP_EXT.test(lu.pathname) || /\/cdn-cgi\//.test(lu.pathname)) continue;
      const c = canonical(lu);
      if (!queued.has(c)) {
        queued.add(c);
        queue.push(c);
      }
    }
  }
  return res;
}

interface PageCache {
  [url: string]: { hash: string; facts: { kind: IncomingFact['kind']; text: string }[] };
}

function batches(docs: FactSourceDoc[]): FactSourceDoc[][] {
  const out: FactSourceDoc[][] = [];
  let cur: FactSourceDoc[] = [];
  let size = 0;
  for (const d of docs) {
    if (cur.length && size + d.text.length > MAX_BATCH_CHARS) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(d);
    size += d.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function syncPortfolio(opts: { url: string; fetcher: Fetcher; ai: AiClient }): Promise<PartReport> {
  const crawl = await crawlSite(opts.url, opts.fetcher);
  if (!crawl.pages.length) {
    if (crawl.failed.length) throw new AppError(502, 'PORTFOLIO_UNREACHABLE', `Could not read ${opts.url}.`);
    throw new AppError(404, 'PORTFOLIO_EMPTY', `${opts.url} has no readable pages.`);
  }
  const cache = getSetting<PageCache>(PAGE_CACHE, {});
  const next: PageCache = {};
  const docs: FactSourceDoc[] = crawl.pages.filter((p) => p.text.length > 40).map((p) => ({ ref: p.url, label: p.title ? `Portfolio page: ${p.title}` : 'Portfolio page', text: p.text }));
  const changed = docs.filter((d) => cache[d.ref]?.hash !== sha(d.text));
  for (const d of docs) if (!changed.includes(d)) next[d.ref] = cache[d.ref];
  for (const url of crawl.failed) if (cache[url]) next[url] = cache[url];
  let aiError: string | null = null;
  let rejected = 0;
  for (const batch of batches(changed)) {
    try {
      const out = await extractFacts(batch, opts.ai);
      rejected += out.rejected.length;
      for (const d of batch) next[d.ref] = { hash: sha(d.text), facts: out.facts.filter((f) => f.sourceRef === d.ref).map(({ kind, text }) => ({ kind, text })) };
    } catch (err) {
      aiError = (err as Error).message;
      for (const d of batch) if (cache[d.ref]) next[d.ref] = cache[d.ref];
    }
  }
  const incoming: IncomingFact[] = [{ kind: 'link', text: `Portfolio: ${opts.url}`, sourceRef: opts.url }];
  for (const [url, entry] of Object.entries(next)) for (const f of entry.facts) incoming.push({ kind: f.kind, text: f.text, sourceRef: url });
  const result = reconcileFacts('portfolio', incoming);
  setSetting(PAGE_CACHE, next);
  const notes = [`${crawl.pages.length} page(s) read`];
  if (changed.length) notes.push(`${changed.length} new or changed`);
  if (crawl.failed.length) notes.push(`${crawl.failed.length} unreachable (kept last facts)`);
  if (crawl.disallowed) notes.push(`${crawl.disallowed} skipped by robots.txt`);
  if (rejected) notes.push(`${rejected} unverifiable claim(s) dropped`);
  if (aiError) notes.push(`claims kept from the last sync: ${aiError}`);
  return { status: aiError ? 'partial' : 'ok', ...result, message: notes.join('; ') };
}
