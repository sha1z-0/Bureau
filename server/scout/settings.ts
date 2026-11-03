import { z } from 'zod/v4';
import { getSetting, setSetting } from '../db.ts';

/**
 * Scout tuning, stored under the `scout` settings key. Every field has a
 * default, so an empty or partial value is always valid.
 */
export const ScoutSettingsSchema = z.object({
  /** Boards polled per ATS family per run (oldest-checked first; signal companies and settings boards always). */
  boardsPerRun: z.record(z.string(), z.number().int().min(0).max(5000)).default({ workday: 60, smartrecruiters: 120 }),
  defaultBoardsPerRun: z.number().int().min(0).max(5000).default(150),
  /** Detail requests per board for ATSs whose list has no description. */
  detailBudget: z.number().int().min(0).max(500).default(40),
  /** Detail requests per connector per run, across all its boards (later runs continue where this stops). */
  detailPerRun: z.number().int().min(0).max(20000).default(600),
  workdayPages: z.number().int().min(1).max(50).default(5),
  /** Aggregator listings looked up online per run to find the employer's own ATS URL (offline matches are free). */
  resolvePerRun: z.number().int().min(0).max(2000).default(300),
  /** …and at most this many per source, so one aggregator can't spend the whole budget. */
  resolvePerSource: z.number().int().min(0).max(2000).default(60),
  /** Cosine similarity at or above which two postings from the same company are one. */
  embedThreshold: z.number().min(0.5).max(1).default(0.92),
  freshHours: z.number().min(1).max(240).default(48),
  /** Parallel connectors. */
  concurrency: z.number().int().min(1).max(16).default(6),
  jobspy: z
    .object({
      sites: z.array(z.enum(['linkedin', 'indeed', 'glassdoor', 'google', 'zip_recruiter', 'bayt', 'naukri'])).default(['indeed', 'linkedin', 'google', 'bayt']),
      termsPerRun: z.number().int().min(1).max(40).default(4),
      resultsPerSite: z.number().int().min(5).max(200).default(40),
      hoursOld: z.number().int().min(1).max(24 * 30).default(72),
      countryIndeed: z.string().max(40).default('USA'),
      proxies: z.array(z.string().max(300)).max(20).default([]),
      timeoutSec: z.number().int().min(30).max(1800).default(300),
    })
    .default({ sites: ['indeed', 'linkedin', 'google', 'bayt'], termsPerRun: 4, resultsPerSite: 40, hoursOld: 72, countryIndeed: 'USA', proxies: [], timeoutSec: 300 }),
  /** Weekly Claude web-search discovery of new company boards (costs a little; needs an API key). */
  discoveryEnabled: z.boolean().default(true),
});
export type ScoutSettings = z.infer<typeof ScoutSettingsSchema>;

export function scoutSettings(): ScoutSettings {
  const raw = getSetting<unknown>('scout', {});
  const parsed = ScoutSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : ScoutSettingsSchema.parse({});
}

export function saveScoutSettings(patch: unknown): ScoutSettings {
  const next = ScoutSettingsSchema.parse({ ...scoutSettings(), ...(patch as object) });
  setSetting('scout', next);
  return next;
}

/** Small persisted scout state (cursors, last runs) that isn't user-facing config. */
export function scoutState<T>(key: string, fallback: T): T {
  return getSetting<T>(`scout.${key}`, fallback);
}

export function setScoutState(key: string, value: unknown) {
  setSetting(`scout.${key}`, value);
}
