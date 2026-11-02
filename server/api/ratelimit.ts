import { z } from 'zod/v4';
import { getSetting, setSetting } from '../db.ts';

/**
 * Per-key rate limits (sliding windows, in memory, per process).
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

const windows = new Map<string, number[]>();

function take(id: string, max: number, windowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const t = Date.now();
  const arr = (windows.get(id) ?? []).filter((x) => x > t - windowMs);
  if (arr.length >= max) {
    windows.set(id, arr);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + windowMs - t) / 1000)) };
  }
  arr.push(t);
  windows.set(id, arr);
  if (windows.size > 5000) for (const [k, v] of windows) if (!v.length || v[v.length - 1] < t - 3_600_000) windows.delete(k);
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
  const arr = (windows.get(`fail:${addr}`) ?? []).filter((x) => x > Date.now() - 600_000);
  windows.set(`fail:${addr}`, arr);
  return arr.length >= 20 ? Math.max(1, Math.ceil((arr[0] + 600_000 - Date.now()) / 1000)) : null;
}

export function recordAuthFailure(addr: string) {
  const arr = windows.get(`fail:${addr}`) ?? [];
  arr.push(Date.now());
  windows.set(`fail:${addr}`, arr);
}

/** Tests: start every window afresh. */
export function resetRateLimits() {
  windows.clear();
  cache = null;
}
