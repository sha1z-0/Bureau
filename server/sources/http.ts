import dns from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';
import { AppError } from '../errors.ts';
import { isBlockedIp } from '../security/ip.ts';
import { safeFetch, USER_AGENT } from '../security/safeFetch.ts';

/**
 * Every connector's network access goes through here, so that:
 *  - requests are polite: a per-host concurrency cap and minimum spacing,
 *  - scraped HTML pages obey robots.txt (APIs published for programmatic
 *    access are read directly),
 *  - tests can swap the transport for recorded payloads (fixtures/feeds/),
 *    which keeps selfcheck fully offline.
 *
 * GETs use the shared SSRF-guarded `safeFetch`. `safeFetch` has no POST yet
 * (requested in docs/build/requests/A01.md), so POSTs (Workday's CXS search)
 * use a local adapter with the same connect-time private-address guard and no
 * redirects.
 */

export interface HttpOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  accept?: string;
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  /** Check robots.txt before fetching (HTML pages scraped for listings, resolver hops). */
  robots?: boolean;
  /** Minimum gap between two requests to the same host. Defaults to 250 ms (1.5 s when `robots` is set). */
  minIntervalMs?: number;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: () => string;
  json: <T = unknown>() => T;
}

export type Transport = (url: string, opts: HttpOptions) => Promise<HttpResponse>;

export class RobotsDisallowed extends AppError {
  constructor(url: string) {
    super(403, 'ROBOTS_DISALLOWED', `robots.txt disallows ${safeHostPath(url)}`);
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    url: string,
  ) {
    super(`HTTP ${status} from ${safeHost(url)}`);
    this.name = 'HttpError';
  }
}

// ── Transport ────────────────────────────────────────────────────────────

const guardedLookup = ((hostname: string, options: dns.LookupOptions, callback: Function) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedIp(a.address))) {
      return callback(new AppError(400, 'BLOCKED_HOST', `Refusing to connect to a private address for ${hostname}`));
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}) as unknown as typeof dns.lookup;

const postAgent = new Agent({ connect: { lookup: guardedLookup, timeout: 10_000 }, headersTimeout: 20_000, bodyTimeout: 30_000 });

async function guardedPost(url: string, opts: HttpOptions): Promise<HttpResponse> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new AppError(400, 'BAD_URL', 'POST is only allowed over https');
  if (/^(localhost|.*\.(localhost|local|internal|lan|home\.arpa))$/i.test(u.hostname)) throw new AppError(400, 'BLOCKED_HOST', 'Refusing a local address');
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  const res = await undiciFetch(u, {
    method: 'POST',
    dispatcher: postAgent,
    redirect: 'error',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    headers: { 'user-agent': USER_AGENT, accept: opts.accept ?? 'application/json', 'content-type': 'application/json', ...opts.headers },
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? {}),
  }).catch((err: unknown) => {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof AppError) throw cause;
    if ((err as Error).name === 'TimeoutError') throw new AppError(504, 'FETCH_TIMEOUT', `${u.hostname} took too long to answer`);
    throw new AppError(502, 'FETCH_FAILED', `Could not reach ${u.hostname}`);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError(413, 'TOO_LARGE', `Response from ${u.hostname} exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  const body = Buffer.concat(chunks);
  return {
    ok: res.ok,
    status: res.status,
    url,
    contentType: res.headers.get('content-type') ?? '',
    text: () => body.toString('utf8'),
    json: <T>() => JSON.parse(body.toString('utf8')) as T,
  };
}

const liveTransport: Transport = async (url, opts) => {
  if (opts.method === 'POST') return guardedPost(url, opts);
  return safeFetch(url, { maxBytes: opts.maxBytes, timeoutMs: opts.timeoutMs, accept: opts.accept, headers: opts.headers });
};

let transport: Transport = liveTransport;

/** Tests swap in recorded payloads. Pass null to restore the live transport. */
export function setTransport(t: Transport | null) {
  transport = t ?? liveTransport;
  robotsCache.clear();
  gates.clear();
}

export function usingLiveTransport() {
  return transport === liveTransport;
}

// ── Politeness ───────────────────────────────────────────────────────────

interface Gate {
  active: number;
  last: number;
  queue: (() => void)[];
}
const gates = new Map<string, Gate>();
const PER_HOST_CONCURRENCY = 4;

async function acquire(host: string, minInterval: number, concurrency: number): Promise<() => void> {
  let g = gates.get(host);
  if (!g) gates.set(host, (g = { active: 0, last: 0, queue: [] }));
  const gate = g;
  if (gate.active >= concurrency) await new Promise<void>((r) => gate.queue.push(r));
  gate.active++;
  const slot = gate.last ? Math.max(Date.now(), gate.last + minInterval) : Date.now();
  const wait = slot - Date.now();
  gate.last = slot;
  if (wait > 0 && usingLiveTransport()) await new Promise((r) => setTimeout(r, wait));
  return () => {
    gate.active--;
    gate.queue.shift()?.();
  };
}

// ── robots.txt ───────────────────────────────────────────────────────────

interface RobotsRules {
  rules: { allow: boolean; pattern: string }[];
  crawlDelayMs: number;
  fetchedAt: number;
  disallowAll: boolean;
}
const robotsCache = new Map<string, RobotsRules | Promise<RobotsRules>>();
const ROBOTS_TTL = 12 * 3_600_000;
const AGENT_TOKEN = 'bureau';

/** Parse robots.txt into the rule set that applies to us (a "bureau" group if present, else "*"). */
export function parseRobots(txt: string): Pick<RobotsRules, 'rules' | 'crawlDelayMs'> {
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[]; delay: number };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const line of txt.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, '').trim();
    const m = clean.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [], delay: 0 }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') {
      if (val === '' && key === 'disallow') continue; // "Disallow:" with nothing means allow all
      cur.rules.push({ allow: key === 'allow', pattern: val });
    } else if (key === 'crawl-delay') {
      const n = Number(val);
      if (Number.isFinite(n)) cur.delay = Math.min(30, n) * 1000;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && AGENT_TOKEN.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return { rules: chosen.flatMap((g) => g.rules), crawlDelayMs: Math.max(0, ...chosen.map((g) => g.delay)) };
}

function patternToRe(p: string): RegExp {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Longest matching rule wins; on a tie, allow wins (Google's documented behaviour). */
export function robotsAllows(rules: { allow: boolean; pattern: string }[], pathAndQuery: string): boolean {
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    if (!patternToRe(r.pattern).test(pathAndQuery)) continue;
    const len = r.pattern.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}

async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached && (cached instanceof Promise || Date.now() - cached.fetchedAt < ROBOTS_TTL)) return cached;
  const p = (async (): Promise<RobotsRules> => {
    try {
      const res = await transport(`${origin}/robots.txt`, { accept: 'text/plain', maxBytes: 512 * 1024, timeoutMs: 15_000 });
      if (res.status >= 500) return { rules: [], crawlDelayMs: 0, fetchedAt: Date.now(), disallowAll: true };
      if (!res.ok) return { rules: [], crawlDelayMs: 0, fetchedAt: Date.now(), disallowAll: false };
      return { ...parseRobots(res.text()), fetchedAt: Date.now(), disallowAll: false };
    } catch {
      // Unreachable robots.txt: be conservative for a while, then try again.
      return { rules: [], crawlDelayMs: 0, fetchedAt: Date.now() - ROBOTS_TTL + 600_000, disallowAll: true };
    }
  })();
  robotsCache.set(origin, p);
  const done = await p;
  robotsCache.set(origin, done);
  return done;
}

export async function allowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  const r = await robotsFor(u.origin);
  return !r.disallowAll && robotsAllows(r.rules, `${u.pathname}${u.search}`);
}

// ── Public helpers ───────────────────────────────────────────────────────

export async function request(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const u = new URL(url);
  let minInterval = opts.minIntervalMs ?? (opts.robots ? 1500 : 250);
  if (opts.robots) {
    const r = await robotsFor(u.origin);
    if (r.disallowAll || !robotsAllows(r.rules, `${u.pathname}${u.search}`)) throw new RobotsDisallowed(url);
    minInterval = Math.max(minInterval, r.crawlDelayMs);
  }
  const release = await acquire(u.hostname, minInterval, opts.robots ? 2 : PER_HOST_CONCURRENCY);
  try {
    return await transport(url, opts);
  } finally {
    release();
  }
}

export async function getJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await request(url, { accept: 'application/json', ...opts });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.json<T>();
}

export async function postJson<T>(url: string, body: unknown, opts: HttpOptions = {}): Promise<T> {
  const res = await request(url, { accept: 'application/json', ...opts, method: 'POST', body });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.json<T>();
}

export async function getText(url: string, opts: HttpOptions = {}): Promise<string> {
  const res = await request(url, opts);
  if (!res.ok) throw new HttpError(res.status, url);
  return res.text();
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown host';
  }
}

function safeHostPath(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url.slice(0, 80);
  }
}
