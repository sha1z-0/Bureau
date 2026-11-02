import { z } from 'zod/v4';
import { getSetting, setSetting } from '../db.ts';
import { CampaignConfigSchema, type CampaignConfig } from '../contracts/campaign.ts';
import { Legitimacy } from '../contracts/job.ts';
import type { MatchProfile } from './profile.ts';

const fields = {
  /** Most jobs sent to Claude per matchJobs call; the rest wait at `filtered` for the next cycle. Fresh jobs go first. */
  assessPerCycle: z.number().int().min(1).max(500),
  /** Jobs whose pre-rank (similarity + prefilter) is below this are skipped without spending tokens. */
  minPreRank: z.number().min(0).max(100),
  /** Jobs per Claude call. The rubric and profile are cached, so bigger batches mostly save output overhead. */
  batchSize: z.number().int().min(1).max(10),
  /** Parallel Claude calls after the first (which warms the cache). */
  concurrency: z.number().int().min(1).max(4),
  /** Lowest scout legitimacy that still reaches assessment. */
  legitimacyFloor: Legitimacy,
};

export const DEFAULT_MATCH_SETTINGS = { assessPerCycle: 40, minPreRank: 20, batchSize: 6, concurrency: 3, legitimacyFloor: 'suspect' } as const;

/** Matcher knobs that are not per campaign. Stored under the `match` setting. */
export const MatchSettingsSchema = z.object(fields);
/** A partial update (no defaults, so omitted fields keep their saved values). */
export const MatchSettingsPatch = z.object(fields).partial();
export type MatchSettings = z.infer<typeof MatchSettingsSchema>;

export function matchSettings(): MatchSettings {
  const saved = getSetting<Record<string, unknown>>('match', {});
  const parsed = MatchSettingsSchema.safeParse({ ...DEFAULT_MATCH_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) });
  return parsed.success ? parsed.data : { ...DEFAULT_MATCH_SETTINGS };
}

export function saveMatchSettings(next: Partial<MatchSettings>): MatchSettings {
  const merged = MatchSettingsSchema.parse({ ...matchSettings(), ...next });
  setSetting('match', merged);
  return merged;
}

/** A campaign config from the profile's preferences, for scoring outside a campaign (v1 hunt, the UI's "score again"). */
export function defaultMatchConfig(profile: MatchProfile | null, now = new Date().toISOString()): CampaignConfig {
  const prefs = profile?.preferences;
  return CampaignConfigSchema.parse({
    startsAt: now,
    endsAt: new Date(Date.parse(now) + 30 * 86_400_000).toISOString(),
    roles: profile?.targetRoles.slice(0, 40) ?? [],
    categories: [],
    locations: prefs?.locations ?? [],
    remoteOnly: prefs?.remoteOnly ?? false,
    stretchLevel: 'balanced',
    minScore: 60,
    dailyCap: 10,
    companyCooldownDays: 30,
    activeHours: { tz: 'UTC', start: '08:00', end: '20:00' },
    pacingMinutes: { min: 8, max: 25 },
    budgetUsd: 0,
    dryRunDays: 0,
    channels: { email: true, forms: true, agent: true },
    sources: {},
  });
}
