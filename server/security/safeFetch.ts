import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { AppError } from '../errors.ts';
import { isBlockedIp } from './ip.ts';

/**
 * Outbound HTTP for anything whose URL could come from a user, a job post, or a
 * model. Blocks private, loopback, link-local and metadata addresses at connect
 * time (so DNS rebinding can't slip past a pre-check), re-validates every
 * redirect hop, and caps size and time.
 */

const guardedLookup: typeof dns.lookup = ((hostname: string, options: dns.LookupOptions, callback: Function) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    const blocked = list.find((a) => isBlockedIp(a.address));
    if (blocked || list.length === 0) {
      return callback(new AppError(400, 'BLOCKED_HOST', `Refusing to connect to a private address for ${hostname}`));
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}) as unknown as typeof dns.lookup;

const agent = new Agent({
  connect: { lookup: guardedLookup, timeout: 10_000 },
  headersTimeout: 20_000,
  bodyTimeout: 30_000,
});

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Bureau/1.0';

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  headers?: Record<string, string>;
  /** GET by default. A POST never follows redirects (a 3xx is an error). */
  method?: 'GET' | 'POST';
  /** Request body for POST; JSON unless a content-type header says otherwise. */
  body?: string;
  /** Treat any redirect as an error (API calls that must hit exactly this URL). */
  noRedirect?: boolean;
  signal?: AbortSignal;
}

export interface SafeResponse {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: () => string;
  json: <T = unknown>() => T;
}

/**
 * Offline replay for tests and the e2e: when set, every safeFetch is answered by
 * the resolver (recorded feeds) and nothing touches the network. A miss is an error.
 */
export type FetchResolver = (
  url: string,
  req: { method: 'GET' | 'POST'; body?: string },
) => { status: number; url: string; contentType: string; body: Buffer } | null;
let replay: FetchResolver | null = null;
export function setFetchReplay(resolver: FetchResolver | null) {
  replay = resolver;
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const { maxBytes = 4 * 1024 * 1024, timeoutMs = 25_000, accept = '*/*', headers = {}, method = 'GET', body: reqBody } = opts;
  let url = parseUrl(rawUrl);
  if (replay) {
    const hit = replay(url.toString(), { method, body: reqBody });
    if (!hit) throw new AppError(503, 'REPLAY_FETCH_MISSING', `No feed fixture for ${method} ${url}`);
    return { ok: hit.status < 400, status: hit.status, url: hit.url, contentType: hit.contentType, text: () => hit.body.toString('utf8'), json: <T>() => JSON.parse(hit.body.toString('utf8')) as T };
  }
  const deadline = opts.signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), opts.signal]) : AbortSignal.timeout(timeoutMs);
  const sendHeaders: Record<string, string> = { 'user-agent': USER_AGENT, accept, ...headers };
  if (reqBody !== undefined && !Object.keys(sendHeaders).some((h) => h.toLowerCase() === 'content-type')) sendHeaders['content-type'] = 'application/json';

  for (let hop = 0; hop < 5; hop++) {
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literal) && isBlockedIp(literal)) {
      throw new AppError(400, 'BLOCKED_HOST', 'Refusing to fetch a private address');
    }
    let res;
    try {
      res = await undiciFetch(url, {
        dispatcher: agent,
        redirect: 'manual',
        signal: deadline,
        method,
        body: method === 'POST' ? reqBody : undefined,
        headers: sendHeaders,
      });
    } catch (err) {
      const cause = (err as { cause?: unknown }).cause;
      if (cause instanceof AppError) throw cause;
      if ((err as Error).name === 'TimeoutError') throw new AppError(504, 'FETCH_TIMEOUT', `${url.hostname} took too long to answer`);
      if ((err as Error).name === 'AbortError') throw new AppError(499, 'FETCH_ABORTED', `Request to ${url.hostname} was cancelled`);
      throw new AppError(502, 'FETCH_FAILED', `Could not reach ${url.hostname}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (method === 'POST' || opts.noRedirect) {
        await res.body?.cancel();
        throw new AppError(502, 'UNEXPECTED_REDIRECT', `${url.hostname} redirected a request that must not be redirected`);
      }
      url = parseUrl(new URL(res.headers.get('location')!, url).toString());
      await res.body?.cancel();
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new AppError(413, 'TOO_LARGE', `Response from ${url.hostname} exceeded ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks);
    return {
      ok: res.ok,
      status: res.status,
      url: url.toString(),
      contentType: res.headers.get('content-type') ?? '',
      text: () => body.toString('utf8'),
      json: <T = unknown>() => JSON.parse(body.toString('utf8')) as T,
    };
  }
  throw new AppError(508, 'TOO_MANY_REDIRECTS', 'Too many redirects');
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, 'BAD_URL', 'That is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError(400, 'BAD_URL', 'Only http and https URLs are allowed');
  }
  if (url.username || url.password) throw new AppError(400, 'BAD_URL', 'URLs with credentials are not allowed');
  if (/^(localhost|.*\.(localhost|local|internal|lan|home\.arpa))$/i.test(url.hostname)) {
    throw new AppError(400, 'BLOCKED_HOST', 'Refusing to fetch a local address');
  }
  return url;
}

export async function getJson<T>(url: string, opts?: SafeFetchOptions): Promise<T> {
  const res = await safeFetch(url, { accept: 'application/json', ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res.json<T>();
}

export async function getText(url: string, opts?: SafeFetchOptions): Promise<string> {
  const res = await safeFetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res.text();
}
