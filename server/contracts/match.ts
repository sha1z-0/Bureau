import { z } from 'zod/v4';
import { Legitimacy } from './job.ts';

/**
 * The matcher's output. `screenPassScore` means "how likely the candidate is to
 * pass the screen", not "ticks every box".
 */

export const Importance = z.enum(['critical', 'important', 'nice']);
export const RequirementMatch = z.enum(['met', 'partial', 'missing']);

export const RequirementSchema = z.object({
  text: z.string(),
  importance: Importance,
  evidence: z.enum(['stated', 'inferred']),
  match: RequirementMatch,
  proof: z.string(),
  /** Only for legally or practically hard gates: licence, clearance, citizenship, mandated degree, years far out of reach. */
  blocker: z.boolean(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const StretchLevel = z.enum(['conservative', 'balanced', 'aggressive']);
export type StretchLevel = z.infer<typeof StretchLevel>;

/** Missing "important" requirements allowed before the stepped penalty starts. */
export const STRETCH_ALLOWANCE: Record<StretchLevel, number> = { conservative: 1, balanced: 3, aggressive: 5 };

export const MatchResultSchema = z.object({
  jobId: z.string(),
  screenPassScore: z.number().min(0).max(100),
  grade: z.enum(['S', 'A', 'B', 'C', 'D', 'F']),
  requirements: z.array(RequirementSchema),
  /** 0–5 per dimension: skills, experience, domain, logistics, compensation, growth (extensible). */
  dimensions: z.record(z.string(), z.number()),
  legitimacy: Legitimacy,
  verdict: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  atsKeywords: z.array(z.string()),
  stretch: z.object({ unmetImportant: z.number().int(), blockers: z.array(z.string()) }),
  /** True when the posting asks entry-level candidates for senior-level experience. */
  inflatedPosting: z.boolean().default(false),
  decision: z.enum(['selected', 'skipped', 'scored']).default('scored'),
  reason: z.string().default(''),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;
