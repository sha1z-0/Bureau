import { z } from 'zod/v4';
import { LetterStrategy, type EvidenceMap } from '../contracts/writer.ts';
import type { WriterAi } from './ai.ts';
import { jobBlock, type WriterContext } from './context.ts';
import { evidenceForPrompt, writerSystem } from './evidence.ts';
import { FIX_SYSTEM, LETTERS_SYSTEM, REVISE_SYSTEM } from './prompts.ts';
import type { CodeIssue } from './truth.ts';

/**
 * Step 5 (letters), 10 (subject lines) and 12 (outreach and follow-up): one
 * `write_letter` call drafts three variants by editing voice-bank passages,
 * five subject lines, the outreach note and the follow-up. `reviseLetters`
 * applies the critic's demands once; `fixTexts` repairs truth-lock findings.
 */

export const LetterDraftSchema = z.object({
  strategy: LetterStrategy,
  passagesUsed: z.array(z.string()),
  text: z.string(),
});
export type LetterDraft = z.infer<typeof LetterDraftSchema>;

export const LettersOutSchema = z.object({
  variants: z.array(LetterDraftSchema),
  subjects: z.array(z.string()),
  outreach: z.string(),
  followUp: z.string(),
});
export type LettersOut = z.infer<typeof LettersOutSchema>;

export interface LengthTarget {
  arm: string;
  min: number;
  max: number;
}

export async function writeLetters(
  ctx: WriterContext,
  evidence: EvidenceMap,
  length: LengthTarget,
  ai: WriterAi,
  opts: { instructions?: string; fastLearning?: string | null } = {},
): Promise<LettersOut> {
  const content = `${jobBlock(ctx)}

${evidenceForPrompt(evidence)}
${opts.fastLearning ? `\nProof of learning fast (use for the biggest gap, if you address it): ${opts.fastLearning}\n` : ''}${opts.instructions ? `\nThe candidate's own instructions:\n${opts.instructions}\n` : ''}
Body length for every variant: ${length.min}–${length.max} words (not counting the greeting and sign-off).
Sign off with: ${ctx.master.preferences.signature?.trim() || ctx.master.name}
Write the three variants (hook, proof, story), five subject lines, the outreach note and the follow-up.`;
  const out = await ai.ask({ task: 'write_letter', label: 'letters', system: writerSystem(ctx, LETTERS_SYSTEM), content, schema: LettersOutSchema, maxTokens: 12000 });
  // One variant per strategy, in a fixed order.
  const variants = LetterStrategy.options.flatMap((s) => {
    const v = out.variants.find((x) => x.strategy === s);
    return v && v.text.trim() ? [{ ...v, text: v.text.trim() }] : [];
  });
  return { ...out, variants };
}

export async function reviseLetters(ctx: WriterContext, evidence: EvidenceMap, items: { draft: LetterDraft; demands: string[] }[], length: LengthTarget, ai: WriterAi): Promise<LetterDraft[]> {
  const content = `${jobBlock(ctx)}

${evidenceForPrompt(evidence)}

Body length band: ${length.min}–${length.max} words.

${items
  .map(
    (it) => `<variant strategy="${it.draft.strategy}" passages="${it.draft.passagesUsed.join(',')}">
${it.draft.text}
</variant>
Demands for ${it.draft.strategy}:
${it.demands.map((d) => `- ${d}`).join('\n')}`,
  )
  .join('\n\n')}

Apply the demands and return the revised variants.`;
  const out = await ai.ask({ task: 'write_letter', label: 'revise', system: writerSystem(ctx, REVISE_SYSTEM), content, schema: z.object({ variants: z.array(LetterDraftSchema) }), maxTokens: 10000 });
  return out.variants.filter((v) => items.some((i) => i.draft.strategy === v.strategy) && v.text.trim());
}

export const FixOutSchema = z.object({
  letter: z.string(),
  subject: z.string(),
  outreach: z.string(),
  followUp: z.string(),
  shortAnswers: z.array(z.object({ key: z.string(), answer: z.string() })),
});
export type FixOut = z.infer<typeof FixOutSchema>;

export async function fixTexts(ctx: WriterContext, texts: FixOut, issues: CodeIssue[], ai: WriterAi): Promise<FixOut> {
  const content = `${jobBlock(ctx)}

<letter>
${texts.letter}
</letter>
<subject>${texts.subject}</subject>
<outreach>
${texts.outreach}
</outreach>
<follow_up>
${texts.followUp}
</follow_up>
${texts.shortAnswers.map((a) => `<answer key="${a.key}">\n${a.answer}\n</answer>`).join('\n')}

Flagged claims:
${issues.map((i) => `- ${i.claim}: ${i.reason}`).join('\n')}

Return every text, with only the flagged claims fixed.`;
  return ai.ask({ task: 'write_letter', label: 'truth_fix', system: writerSystem(ctx, FIX_SYSTEM), content, schema: FixOutSchema, maxTokens: 8000 });
}

// ── Subject lines ────────────────────────────────────────────────────────────

const CLICKBAIT = /\b(?:urgent|must[- ]read|you won'?t believe|don'?t miss|act now|guaranteed|the best candidate|perfect candidate|hire me|read this)\b/i;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/** Under 70 characters, specific, no clickbait, no all-caps words, no emoji, no exclamation marks. */
export function subjectProblems(s: string): string[] {
  const p: string[] = [];
  const t = s.trim();
  if (!t) p.push('empty');
  if (t.length >= 70) p.push(`${t.length} characters (limit 69)`);
  if (/!/.test(t)) p.push('exclamation mark');
  if (EMOJI.test(t)) p.push('emoji');
  if (CLICKBAIT.test(t)) p.push('clickbait');
  if ((t.match(/\b[A-Z]{5,}\b/g) ?? []).length) p.push('all-caps word');
  return p;
}
