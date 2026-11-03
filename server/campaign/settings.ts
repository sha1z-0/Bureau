import { z } from 'zod/v4';
import { getSetting, setSetting } from '../db.ts';

/** Autopilot knobs that span every campaign. Stored under the `autopilot` setting. */
export const AutopilotSettingsSchema = z.object({
  /** Applications (live or rehearsed) per local day across all active campaigns. */
  globalDailyCap: z.number().int().min(0).max(400),
  /** Local time of the daily profile sync. */
  profileSyncAt: z.string().regex(/^\d\d:\d\d$/),
  inboxEveryMinutes: z.number().min(1).max(120),
  /** Weekly gap report and company discovery: ISO weekday (1 = Monday) and time. */
  weeklyDay: z.number().int().min(1).max(7),
  weeklyAt: z.string().regex(/^\d\d:\d\d$/),
  /** Minutes after a campaign's active hours close that its daily digest goes out. */
  digestDelayMinutes: z.number().int().min(0).max(240),
  /** Keep Windows awake during active hours. */
  keepAwake: z.boolean(),
  /** Give up on a job after this many failed attempts. */
  maxAttempts: z.number().int().min(1).max(10),
  /** Prefer jobs whose employer is in business hours right now (when its zone is known). */
  preferEmployerHours: z.boolean(),
  /**
   * Score matches through the Message Batches API (half price; answers usually within the hour,
   * at most 24 h). Off: every assessment is a normal call, as before. See batchMatch.ts.
   */
  batchMatching: z.boolean().default(false),
  /**
   * Skip the cover letter when it is known before writing that the job's form has no field for one
   * (CV and short answers are still written; email applications always get a letter). See
   * server/writer/letterNeed.ts. Off: every packet has a letter, as before.
   */
  skipUnneededLetters: z.boolean().default(false),
});
export type AutopilotSettings = z.infer<typeof AutopilotSettingsSchema>;

export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  globalDailyCap: 25,
  profileSyncAt: '06:00',
  inboxEveryMinutes: 5,
  weeklyDay: 1,
  weeklyAt: '07:00',
  digestDelayMinutes: 15,
  keepAwake: true,
  maxAttempts: 3,
  preferEmployerHours: true,
  batchMatching: false,
  skipUnneededLetters: false,
};

export function autopilotSettings(): AutopilotSettings {
  const saved = getSetting<Record<string, unknown>>('autopilot', {});
  const parsed = AutopilotSettingsSchema.safeParse({ ...DEFAULT_AUTOPILOT, ...(saved && typeof saved === 'object' ? saved : {}) });
  return parsed.success ? parsed.data : { ...DEFAULT_AUTOPILOT };
}

export function saveAutopilotSettings(patch: Partial<AutopilotSettings>): AutopilotSettings {
  const next = AutopilotSettingsSchema.parse({ ...autopilotSettings(), ...patch });
  setSetting('autopilot', next);
  return next;
}

/** Backoff after a failed attempt: 30 min, 1 h, 2 h … capped at 12 h. */
export function backoffMs(attempts: number): number {
  return Math.min(12 * 3_600_000, 30 * 60_000 * 2 ** Math.max(0, attempts - 1));
}
