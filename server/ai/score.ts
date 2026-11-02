import { z } from 'zod/v4';
import { all, now, run } from '../db.ts';
import { profileForPrompt, type Profile } from '../services/profileStore.ts';
import { structured } from './claude.ts';
import { emailInText, fence, SCORING_RUBRIC } from './prompts.ts';

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

interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remote: number;
  description_text: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  prefilter_score: number;
  url: string;
}

const MAX_DESCRIPTION = 9000;
const BATCH = 6;

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

function renderJob(j: JobRow): string {
  const desc = (j.description_text ?? '').slice(0, MAX_DESCRIPTION);
  const salary = j.salary_min || j.salary_max ? `${j.salary_min ?? '?'}–${j.salary_max ?? '?'} ${j.salary_currency ?? ''}` : 'not stated';
  return `<job_posting id="${j.id}">
Title: ${fence(j.title)}
Company: ${fence(j.company)}
Location: ${j.location || 'not stated'}${j.remote ? ' (remote)' : ''}
Salary: ${salary}
URL: ${j.url}

${fence(desc)}${(j.description_text ?? '').length > MAX_DESCRIPTION ? '\n[posting continues — trimmed for length]' : ''}
</job_posting>`;
}

export async function scoreJobs(ids: string[], profile: Profile, onProgress?: (done: number) => void): Promise<number> {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const rows = all<JobRow>(
    `SELECT id, title, company, location, remote, description_text, salary_min, salary_max, salary_currency, prefilter_score, url
     FROM jobs WHERE id IN (${placeholders})`,
    ...ids,
  );
  const system = [
    { type: 'text' as const, text: SCORING_RUBRIC },
    { type: 'text' as const, text: profileForPrompt(profile), cache_control: { type: 'ephemeral' as const } },
  ];
  let scored = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const out = await structured({
      task: 'score',
      system,
      content: `Assess these ${batch.length} job(s) for the candidate.\n\n${batch.map(renderJob).join('\n\n')}`,
      schema: BatchResult,
      maxTokens: 24000,
    });
    for (const a of out.results) {
      const row = batch.find((b) => b.id === a.id);
      if (!row) continue;
      const { score, grade, decision, breakdown } = computeScore(a, row.prefilter_score);
      const assessment: Assessment = { ...a, breakdown, decision };
      run(
        `UPDATE jobs SET ai_score = ?, ai_grade = ?, ai_analysis = ?, scored_at = ?, updated_at = ?,
           apply_email = COALESCE(NULLIF(?, ''), apply_email) WHERE id = ?`,
        score,
        grade,
        JSON.stringify(assessment),
        now(),
        now(),
        emailInText(a.applyEmail, `${row.title}\n${row.description_text ?? ''}`) ?? '',
        a.id,
      );
      scored++;
    }
    onProgress?.(scored);
  }
  return scored;
}
