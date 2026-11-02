import { z } from 'zod/v4';
import { LetterStrategy, type CriticResult, type EvidenceMap } from '../contracts/writer.ts';
import type { WriterAi } from './ai.ts';
import { jobBlock, type WriterContext } from './context.ts';
import { evidenceForPrompt, writerSystem } from './evidence.ts';
import { CRITIC_SYSTEM } from './prompts.ts';
import { mean, round } from './text.ts';

/**
 * Step 6 and 10: the recruiter-critic (task `critic`, a skeptical senior
 * hiring manager on Opus). It scores every variant, returns the edits it
 * would demand, and picks the best subject line.
 *
 * The overall score is the critic's own verdict, held to its sub-scores in
 * code: it can't exceed the sub-score mean by more than half a point, and any
 * sub-score under 6 caps it at 7.5, so a letter with weak evidence or obvious
 * AI tells can never clear the 8 bar on charm alone.
 */

export const CRITIC_BAR = 8;

const Scores = z.object({ specificity: z.number(), evidence: z.number(), voice: z.number(), clarity: z.number(), ask: z.number(), aiTells: z.number() });

export const CriticOutSchema = z.object({
  variants: z.array(z.object({ strategy: LetterStrategy, score: z.number(), scores: Scores, demands: z.array(z.string()) })),
  bestSubject: z.number().int(),
});
export type CriticOut = z.infer<typeof CriticOutSchema>;

const clamp = (n: number) => Math.max(0, Math.min(10, Number.isFinite(n) ? n : 0));

export function normalizeCritic(v: { score: number; scores: z.infer<typeof Scores>; demands: string[] }): CriticResult {
  const scores = {
    specificity: clamp(v.scores.specificity),
    evidence: clamp(v.scores.evidence),
    voice: clamp(v.scores.voice),
    clarity: clamp(v.scores.clarity),
    ask: clamp(v.scores.ask),
    aiTells: clamp(v.scores.aiTells),
  };
  const subs = Object.values(scores);
  let score = Math.min(clamp(v.score), mean(subs) + 0.5);
  if (subs.some((s) => s < 6)) score = Math.min(score, 7.5);
  return { score: round(score, 1), scores, demands: v.demands.map((d) => d.trim()).filter(Boolean) };
}

export async function critique(
  ctx: WriterContext,
  evidence: EvidenceMap,
  letters: { strategy: z.infer<typeof LetterStrategy>; text: string }[],
  subjects: string[],
  ai: WriterAi,
  label: string,
): Promise<{ results: Map<string, CriticResult>; bestSubject: number }> {
  const content = `${jobBlock(ctx)}

${evidenceForPrompt(evidence)}

${letters.map((l) => `<letter strategy="${l.strategy}">\n${l.text}\n</letter>`).join('\n\n')}

Subject lines:
${subjects.map((s, i) => `${i}. ${s}`).join('\n')}

Score every letter and pick the best subject line.`;
  const out = await ai.ask({ task: 'critic', label, system: writerSystem(ctx, CRITIC_SYSTEM), content, schema: CriticOutSchema, maxTokens: 6000 });
  const results = new Map<string, CriticResult>();
  for (const l of letters) {
    const v = out.variants.find((x) => x.strategy === l.strategy);
    // A letter the critic skipped scores zero: it is never chosen unread.
    results.set(l.strategy, v ? normalizeCritic(v) : { score: 0, scores: { specificity: 0, evidence: 0, voice: 0, clarity: 0, ask: 0, aiTells: 0 }, demands: ['The critic did not score this letter.'] });
  }
  return { results, bestSubject: out.bestSubject };
}
