import { z } from 'zod/v4';
import type { Profile } from '../services/profileStore.ts';
import { runMatch } from '../match/engine.ts';
import { matchProfileFrom } from '../match/profile.ts';
import { defaultMatchConfig } from '../match/settings.ts';

/**
 * v1 scoring entry points, kept for the v1 scanner, hunt and jobs routes.
 *
 * `scoreJobs` now runs the v2 matcher (server/match): the new rubric, whose
 * score means "chance of passing the screen", deterministic code-side scoring,
 * and both `jobs.match` and the v1 `ai_*` columns filled. It does not move the
 * campaign pipeline or apply hard filters; campaigns call `matchJobs` instead.
 *
 * `JobAssessment`, `BatchResult` and `computeScore` are the v1 shapes and
 * formula, kept unchanged for code that still holds a v1 assessment.
 */

const Level = z.enum(['high', 'medium', 'low']);

export const JobAssessment = z.object({
  id: z.string(),
  requirements: z.array(
    z.object({
      text: z.string(),
      importance: z.enum(['critical', 'important', 'nice']),
      evidence: z.enum(['stated', 'inferred']),
      match: z.enum(['met', 'partial', 'missing']),
      proof: z.string(),
    }),
  ),
  dimensions: z.object({
    skills: z.number(),
    experience: z.number(),
    domain: z.number(),
    logistics: z.number(),
    compensation: z.number(),
    growth: z.number(),
  }),
  legitimacy: Level,
  confidence: Level,
  verdict: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  redFlags: z.array(z.string()),
  applyChannel: z.enum(['email', 'ats', 'dm', 'unknown']),
  applyEmail: z.string(),
  atsKeywords: z.array(z.string()),
  seniorityFit: z.enum(['under', 'match', 'over', 'unknown']),
});

export const BatchResult = z.object({ results: z.array(JobAssessment) });

export type Assessment = z.infer<typeof JobAssessment> & {
  breakdown: { requirements: number; dimensions: number; prefilter: number };
  decision: 'apply' | 'consider' | 'research' | 'skip';
};

const clamp5 = (n: number) => Math.max(0, Math.min(5, Math.round(n)));

/**
 * The score is computed here, in code, from the model's structured judgement —
 * so the same assessment always produces the same number, and the weights are
 * ours to tune rather than the model's mood.
 */
export function computeScore(a: z.infer<typeof JobAssessment>, prefilter: number) {
  const W = { critical: 3, important: 2, nice: 1 } as const;
  const M = { met: 1, partial: 0.5, missing: 0 } as const;
  let total = 0;
  let earned = 0;
  for (const r of a.requirements) {
    total += W[r.importance];
    earned += W[r.importance] * M[r.match];
  }
  const requirements = total ? (earned / total) * 100 : 50;

  const d = Object.fromEntries(Object.entries(a.dimensions).map(([k, v]) => [k, clamp5(v)])) as typeof a.dimensions;
  const dimensions =
    ((d.skills * 0.3 + d.experience * 0.2 + d.domain * 0.15 + d.logistics * 0.15 + d.compensation * 0.1 + d.growth * 0.1) / 5) * 100;

  let score = requirements * 0.45 + dimensions * 0.35 + prefilter * 0.2;

  const hardMiss = a.requirements.some((r) => r.importance === 'critical' && r.evidence === 'stated' && r.match === 'missing');
  if (hardMiss) score = Math.min(score, 64);
  if (d.logistics === 0) score = Math.min(score, 40);
  if (a.legitimacy === 'low') score -= 25;
  else if (a.legitimacy === 'medium') score -= 6;
  if (a.seniorityFit === 'under') score -= 8;

  score = Math.round(Math.max(0, Math.min(100, score)));
  const grade = score >= 88 ? 'S' : score >= 78 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
  const decision = score >= 78 ? 'apply' : score >= 65 ? 'consider' : score >= 50 ? 'research' : 'skip';
  return {
    score,
    grade,
    decision: decision as Assessment['decision'],
    breakdown: { requirements: Math.round(requirements), dimensions: Math.round(dimensions), prefilter },
  };
}

/**
 * Score jobs with Claude (v2 matcher, metered as the v1 `score` task). Returns how many were scored.
 * The profile's hard filters run first (free): an on-site role abroad or a remote role closed to the owner's
 * country is recorded as ruled out, never paid for. Jobs the owner picked by hand (`skipFilters`) are always scored.
 */
export async function scoreJobs(ids: string[], profile: Profile, onProgress?: (done: number) => void, opts: { skipFilters?: boolean } = {}): Promise<number> {
  if (!ids.length) return 0;
  const mp = matchProfileFrom(profile);
  const run = await runMatch(ids, defaultMatchConfig(mp), {
    profile: mp,
    task: 'score',
    movePipeline: false,
    skipFilters: opts.skipFilters ?? false,
    assessLimit: ids.length,
    onProgress,
  });
  return run.results.filter((r) => !r.explain.filter).length;
}
