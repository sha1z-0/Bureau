import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors.ts';
import { safeFetch } from '../security/safeFetch.ts';

/**
 * Every outbound request the profile sync and company research make goes
 * through a Fetcher. Production uses safeFetch (private-address blocking,
 * redirect re-validation, size and time caps). Tests and e2e inject a
 * recorded fetcher that serves files from fixtures/, so nothing touches the
 * network.
 */

export interface FetchOptions {
  accept?: string;
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  /** Final URL after redirects. */
  url: string;
  contentType: string;
  text(): string;
  json<T = unknown>(): T;
}

export type Fetcher = (url: string, opts?: FetchOptions) => Promise<FetchResult>;

export const defaultFetcher: Fetcher = (url, opts) => safeFetch(url, opts);

interface RecordedEntry {
  /** File relative to the recording folder. Omit for an empty body. */
  file?: string;
  /** Inline body, for tiny payloads. */
  body?: string;
  status?: number;
  contentType?: string;
}

/**
 * A fetcher backed by a folder with an `index.json` that maps URLs to files:
 * `{ "https://api.github.com/users/x/repos?...": { "file": "repos.json" } }`.
 * Unknown URLs answer 404, like a site without that page would.
 */
export function recordedFetcher(...dirs: string[]): Fetcher & { requests: string[] } {
  const map = new Map<string, { dir: string; entry: RecordedEntry }>();
  for (const dir of dirs) {
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as Record<string, RecordedEntry>;
    for (const [url, entry] of Object.entries(index)) map.set(url, { dir, entry });
  }
  const requests: string[] = [];
  const fetcher = (async (url: string) => {
    requests.push(url);
    const hit = map.get(url);
    const status = hit ? (hit.entry.status ?? 200) : 404;
    const body = !hit ? 'Not found' : hit.entry.file ? fs.readFileSync(path.join(hit.dir, hit.entry.file), 'utf8') : (hit.entry.body ?? '');
    const contentType = hit?.entry.contentType ?? (hit?.entry.file?.endsWith('.json') ? 'application/json' : hit?.entry.file?.endsWith('.md') ? 'text/plain' : 'text/html; charset=utf-8');
    return {
      ok: status >= 200 && status < 300,
      status,
      url,
      contentType,
      text: () => body,
      json: <T>() => JSON.parse(body) as T,
    };
  }) as Fetcher & { requests: string[] };
  fetcher.requests = requests;
  return fetcher;
}

/** A fetcher that fails every request: proves a code path stays offline. */
export const offlineFetcher: Fetcher = async (url) => {
  throw new AppError(503, 'OFFLINE', `Offline: refused to fetch ${url}`);
};
