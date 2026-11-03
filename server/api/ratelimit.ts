import { z } from 'zod/v4';
import { all, getSetting, run, setSetting } from '../db.ts';

/**
 * Per-key rate limits (sliding windows, counted in sqlite so a restart does not
 * reset them and the HTTP server and stdio MCP processes share one count).
 *  - `req`: every authenticated call (default 120 a minute).
 *  - `ai`:  calls that make Bureau spend on Claude: writing a packet, or a
 *           written answer to a form question (default 30 an hour).
 * Per-key overrides live in the same setting. Failed authentication is
 * throttled per client address so a guessing loop is cut off quickly.
 */

const LimitPair = z.object({
  perMinute: z.number().int().min(1).max(10_000),
  aiPerHour: z.number().int().min(0).max(10_000),
});

export const RateLimitSettingsSchema = LimitPair.extend({
  perKey: z.record(z.string().max(64), LimitPair.partial()).default({}),
});
export type RateLimitSettings = z.infer<typeof RateLimitSettingsSchema>;

export const DEFAULT_LIMITS: RateLimitSettings = { perMinute: 120, aiPerHour: 30, perKey: {} };
const SETTING = 'api.rateLimits';

export function rateLimitSettings(): RateLimitSettings {
  const parsed = RateLimitSettingsSchema.safeParse(getSetting<unknown>(SETTING, DEFAULT_LIMITS));
  return parsed.success ? parsed.data : DEFAULT_LIMITS;
}

export function saveRateLimitSettings(next: unknown): RateLimitSettings {
  const merged = RateLimitSettingsSchema.parse({ ...rateLimitSettings(), ...(next as object) });
  setSetting(SETTING, merged);
  cache = null;
  return merged;
}

let cache: { at: number; value: RateLimitSettings } | null = null;
function limitsFor(keyId: string): { perMinute: number; aiPerHour: number } {
  if (!cache || Date.now() - cache.at > 5000) cache = { at: Date.now(), value: rateLimitSettings() };
  const s = cache.value;
  const o = s.perKey[keyId] ?? {};
  return { perMinute: o.perMinute ?? s.perMinute, aiPerHour: o.aiPerHour ?? s.aiPerHour };
}

/**
 * Each window is counted in 60 slots (1 s slots for the minute, 1 min slots for the hour): one upsert per allowed
 * call, a sliding window accurate to one slot. Reading and writing are not one transaction, so two processes
 * racing at the limit may let one extra call through; that is fine for a throttle.
 */
const SLOTS = 60;
/** The longest window (an hour) plus a slot: older rows can never count again. */
const KEEP_MS = 3_600_000 + 60_000;
let lastPrune = 0;

interface Slot {
  slot: number;
  count: number;
}

function slotOf(t: number, windowMs: number): number {
  const size = windowMs / SLOTS;
  return Math.floor(t / size) * size;
}

/** The slots still inside the window ending now, oldest first. */
function slotsIn(bucket: string, windowMs: number, t: number): Slot[] {
  return all<Slot>('SELECT slot, count FROM api_rate_windows WHERE bucket = ? AND slot > ? ORDER BY slot', bucket, slotOf(t, windowMs) - windowMs);
}

/** Seconds until enough of the oldest slots leave the window for one more call. */
function retryAfter(slots: Slot[], max: number, windowMs: number, t: number): number {
  let left = slots.reduce((n, s) => n + s.count, 0);
  for (const s of slots) {
    left -= s.count;
    if (left < max) return Math.max(1, Math.ceil((s.slot + windowMs - t) / 1000));
  }
  return Math.ceil(windowMs / 1000);
}

function record(bucket: string, windowMs: number, t: number) {
  run('INSERT INTO api_rate_windows (bucket, slot, count) VALUES (?, ?, 1) ON CONFLICT(bucket, slot) DO UPDATE SET count = count + 1', bucket, slotOf(t, windowMs));
  // Old windows go once a minute per process (any process may do it: the rows are shared).
  if (t - lastPrune > 60_000) {
    lastPrune = t;
    run('DELETE FROM api_rate_windows WHERE slot < ?', t - KEEP_MS);
  }
}

function take(id: string, max: number, windowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const t = Date.now();
  const slots = slotsIn(id, windowMs, t);
  if (slots.reduce((n, s) => n + s.count, 0) >= max) return { ok: false, retryAfterSec: retryAfter(slots, max, windowMs, t) };
  record(id, windowMs, t);
  return { ok: true };
}

export function takeRequest(keyId: string) {
  return take(`req:${keyId}`, limitsFor(keyId).perMinute, 60_000);
}

export function takeAi(keyId: string) {
  const { aiPerHour } = limitsFor(keyId);
  if (aiPerHour === 0) return { ok: false as const, retryAfterSec: 3600 };
  return take(`ai:${keyId}`, aiPerHour, 3_600_000);
}

/** Failed authentications per client address: 20 in 10 minutes, then 429 until the window clears. */
export function authFailuresExceeded(addr: string): number | null {
  const t = Date.now();
  const slots = slotsIn(`fail:${addr}`, 600_000, t);
  return slots.reduce((n, s) => n + s.count, 0) >= 20 ? retryAfter(slots, 20, 600_000, t) : null;
}

export function recordAuthFailure(addr: string) {
  record(`fail:${addr}`, 600_000, Date.now());
}

/** Tests: start every window afresh. */
export function resetRateLimits() {
  run('DELETE FROM api_rate_windows');
  cache = null;
  lastPrune = 0;
}
