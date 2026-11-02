import { z } from 'zod/v4';
import { CATEGORIES } from '../sources/types.ts';
import { StretchLevel } from './match.ts';

/** Campaigns and the per-job pipeline state machine. */

export const CampaignStatus = z.enum(['draft', 'active', 'paused', 'ended']);
export type CampaignStatus = z.infer<typeof CampaignStatus>;

export const CampaignConfigSchema = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
  roles: z.array(z.string().max(120)).max(40),
  categories: z.array(z.enum(CATEGORIES)).max(7),
  locations: z.array(z.string().max(120)).max(40),
  remoteOnly: z.boolean(),
  stretchLevel: StretchLevel,
  minScore: z.number().min(0).max(100),
  dailyCap: z.number().int().min(0).max(200),
  companyCooldownDays: z.number().int().min(0).max(365),
  activeHours: z.object({
    tz: z.string(),
    /** "HH:MM", local to tz. */
    start: z.string().regex(/^\d\d:\d\d$/),
    end: z.string().regex(/^\d\d:\d\d$/),
  }),
  pacingMinutes: z.object({ min: z.number().min(0), max: z.number().min(0) }),
  budgetUsd: z.number().min(0),
  /** First N days rehearse (fill and verify, never submit), then go live automatically. */
  dryRunDays: z.number().int().min(0).max(60),
  channels: z.object({ email: z.boolean(), forms: z.boolean(), agent: z.boolean() }),
  /** Per-connector enable overrides, keyed by connector id. */
  sources: z.record(z.string(), z.boolean()),
  maxAgeDays: z.number().int().min(1).max(60).default(14),
  followUpDays: z.number().int().min(0).max(60).default(7),
  onUnknownQuestion: z.enum(['skip', 'needs_you']).default('skip'),
  scoutEveryHours: z.number().min(1).max(24).default(3),
});
export type CampaignConfig = z.infer<typeof CampaignConfigSchema>;

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: CampaignStatus,
  startsAt: z.string(),
  endsAt: z.string(),
  config: CampaignConfigSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const PIPELINE_STATES = [
  'found',
  'filtered',
  'scored',
  'selected',
  'writing',
  'written',
  'filling',
  'verified',
  'submitted',
  'rehearsed',
  'skipped',
  'needs_you',
  'failed',
] as const;
export const PipelineState = z.enum(PIPELINE_STATES);
export type PipelineState = z.infer<typeof PipelineState>;

/**
 * Legal transitions. `submitted` is terminal. Re-queues (an answered unknown
 * question, a retry, dry-run going live) go back to `selected` or `written`.
 * External agents may mark `submitted` from any pre-terminal state they hold a claim on.
 */
export const TRANSITIONS: Record<PipelineState, readonly PipelineState[]> = {
  found: ['filtered', 'skipped'],
  filtered: ['scored', 'skipped'],
  scored: ['selected', 'skipped'],
  selected: ['writing', 'skipped', 'submitted', 'failed'],
  writing: ['written', 'skipped', 'failed', 'selected'],
  written: ['filling', 'skipped', 'submitted', 'selected'],
  filling: ['verified', 'needs_you', 'skipped', 'failed', 'written', 'submitted'],
  verified: ['submitted', 'rehearsed', 'needs_you', 'failed', 'written'],
  rehearsed: ['written', 'selected', 'skipped', 'submitted'],
  needs_you: ['selected', 'written', 'submitted', 'skipped'],
  failed: ['selected', 'written', 'skipped'],
  skipped: ['selected', 'found'],
  submitted: [],
};

export const PipelineRowSchema = z.object({
  jobId: z.string(),
  campaignId: z.string().nullable(),
  state: PipelineState,
  attempts: z.number().int(),
  nextActionAt: z.string().nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.string(),
});
export type PipelineRow = z.infer<typeof PipelineRowSchema>;
