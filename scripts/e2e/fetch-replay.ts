import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { FIXTURES } from './manifest.ts';

/**
 * Offline HTTP for connectors: serves fixtures/feeds/** by request URL so the
 * scout runs with no network. Two sets exist:
 *   - `recorded`: real public payloads captured once (parser tests).
 *   - `e2e`:      fictional employers whose apply URLs point at the local
 *                 fixture server ({{ORIGIN_A}} is substituted).
 * Anything not in the chosen set is refused (null → the caller throws
 * REPLAY_FETCH_MISSING), so a test can never silently reach the internet.
 *
 * How it plugs in: server/security/safeFetch.ts needs a replay hook (see
 * docs/build/requests/A11.md). `installFetchReplay()` uses it when present and
 * reports false otherwise, so the e2e marks the scout stage pending instead of
 * going online.
 */

const EntrySchema = z.object({
  connector: z.string(),
  method: z.string().default('GET'),
  /** Exact URL, or `re:<regex>`. */
  url: z.string(),
  file: z.string(),
  contentType: z.string().default('application/json'),
  recordedAt: z.string().optional(),
  notes: z.string().optional(),
  source: z.string().optional(),
  requestBody: z.unknown().optional(),
});
export type FeedEntry = z.infer<typeof EntrySchema>;

export const FeedIndexSchema = z.object({
  recorded: z.array(EntrySchema),
  e2e: z.array(EntrySchema),
  dedupe: z.object({ company: z.string(), title: z.string(), sources: z.array(z.string()), files: z.array(z.string()).default([]), canonicalUrl: z.string().optional() }),
  traps: z.array(z.object({ kind: z.string(), file: z.string(), company: z.string(), why: z.string() })).default([]),
});
export type FeedIndex = z.infer<typeof FeedIndexSchema>;

export const FEEDS_DIR = path.join(FIXTURES, 'feeds');

export function loadFeedIndex(): FeedIndex {
  return FeedIndexSchema.parse(JSON.parse(fs.readFileSync(path.join(FEEDS_DIR, 'index.json'), 'utf8')));
}

export interface ReplayResponse {
  status: number;
  url: string;
  contentType: string;
  body: Buffer;
}

export type FetchResolver = (url: string, init?: { method?: string; body?: string }) => ReplayResponse | null;

function matches(entry: FeedEntry, url: string, method: string): boolean {
  if (entry.method.toUpperCase() !== method.toUpperCase()) return false;
  if (entry.url.startsWith('re:')) return new RegExp(entry.url.slice(3)).test(url);
  return entry.url === url;
}

/** The e2e payloads were written as of this day; `shiftDates` keeps them fresh relative to today. */
export const E2E_ANCHOR = Date.UTC(2026, 10, 2);
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO_DATE = new RegExp(String.raw`\b(20[2-3]\d)-(\d\d)-(\d\d)`, 'g');
const EPOCH = new RegExp(String.raw`\b(1[78]\d{8})(\d{3})?\b`, 'g');
const RFC822 = new RegExp(String.raw`\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (20\d\d)`, 'g');
const PLACEHOLDER = new RegExp(String.raw`\{\{([A-Z_]+)\}\}`, 'g');

/**
 * Move every date in a fixture body forward by whole days so postings dated
 * "two days ago" stay two days old whenever the suite runs: ISO dates
 * (YYYY-MM-DD…), epoch seconds/milliseconds from 2025–2027, and RFC 822 dates.
 */
export function shiftDates(text: string, days: number): string {
  if (days <= 0) return text;
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10);
  let out = text.replace(ISO_DATE, (_m, y: string, mo: string, d: string) => iso(+y, +mo, +d));
  out = out.replace(EPOCH, (m, sec: string, ms?: string) => {
    const n = Number(sec);
    if (n < 1_735_689_600 || n > 1_830_297_600) return m; // 2025-01-01 … 2027-12-31
    return String(n + days * 86_400) + (ms ?? '');
  });
  out = out.replace(RFC822, (_m, _w, d: string, mon: string, y: string) => {
    const t = new Date(Date.UTC(+y, MONTHS.indexOf(mon), +d) + days * DAY);
    return `${WEEKDAYS[t.getUTCDay()]}, ${String(t.getUTCDate()).padStart(2, '0')} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
  });
  return out;
}

/** Build a resolver over one fixture set. `vars` fills {{NAME}} placeholders in bodies; e2e bodies are date-shifted to today. */
export function feedResolver(
  set: 'recorded' | 'e2e',
  vars: Record<string, string> = {},
  opts: { onMiss?: (url: string) => void; onHit?: (url: string, e: FeedEntry) => void; now?: number } = {},
): FetchResolver {
  const shiftDays = set === 'e2e' ? Math.floor(((opts.now ?? Date.now()) - E2E_ANCHOR) / DAY) : 0;
  const entries = loadFeedIndex()[set];
  return (url, init = {}) => {
    const method = init.method ?? 'GET';
    // Exact entries win over regex entries.
    const entry = entries.find((e) => !e.url.startsWith('re:') && matches(e, url, method)) ?? entries.find((e) => matches(e, url, method));
    if (!entry) {
      opts.onMiss?.(url);
      return null;
    }
    opts.onHit?.(url, entry);
    const raw = fs.readFileSync(path.join(FEEDS_DIR, entry.file), 'utf8');
    const text = shiftDates(raw.replace(PLACEHOLDER, (m, k: string) => vars[k] ?? m), shiftDays);
    return { status: 200, url, contentType: entry.contentType, body: Buffer.from(text, 'utf8') };
  };
}

/**
 * Install a resolver into safeFetch if it exposes the replay hook. Returns
 * whether replay is active. Never falls back to the network.
 */
export async function installFetchReplay(resolver: FetchResolver | null): Promise<boolean> {
  const mod = (await import('../../server/security/safeFetch.ts')) as Record<string, unknown>;
  const hook = mod.setFetchReplay;
  if (typeof hook !== 'function') return false;
  (hook as (r: FetchResolver | null) => void)(resolver);
  return true;
}
