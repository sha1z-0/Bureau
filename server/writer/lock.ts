import { z } from 'zod/v4';
import type { EvidenceMap } from '../contracts/writer.ts';
import type { WriterAi } from './ai.ts';
import type { WriterContext } from './context.ts';
import type { TailoredCv } from './cvSchema.ts';
import { writerSystem } from './evidence.ts';
import { FACT_AUDITOR } from './prompts.ts';
import { codeTruth, type CodeIssue } from './truth.ts';

/**
 * Step 9: the full truth lock, both halves. The code check (truth.ts) and an
 * independent auditor (task `audit`) read the same texts; the lock is clean
 * only when neither reports a high-severity issue. An auditor that can't run
 * throws: an unaudited packet is never treated as clean.
 */

export const AuditOutSchema = z.object({
  issues: z.array(z.object({ claim: z.string(), reason: z.string(), severity: z.enum(['high', 'medium', 'low']) })),
});

export interface LockTexts {
  letter: string;
  subject: string;
  outreach: string;
  followUp: string;
  shortAnswers: { key: string; answer: string }[];
}

/**
 * `auditor: false` (volume mode) runs the code check alone: it costs nothing and still catches
 * invented skills, employers, titles, dates, numbers and certifications. The independent
 * auditor is the paid second opinion that quality mode adds.
 */
export async function truthLock(ctx: WriterContext, ai: WriterAi, label: string, t: LockTexts, cv: TailoredCv | null, evidence: EvidenceMap | null, opts: { auditor?: boolean } = {}): Promise<CodeIssue[]> {
  const code = codeTruth(
    {
      cv,
      evidence,
      texts: [
        { label: 'Letter', text: t.letter },
        { label: 'Subject', text: t.subject },
        { label: 'Outreach', text: t.outreach },
        { label: 'Follow-up', text: t.followUp },
        ...t.shortAnswers.map((a) => ({ label: `Answer "${a.key}"`, text: a.answer })),
      ].filter((x) => x.text.trim()),
    },
    ctx.source,
  );
  const parts = [
    `COVER LETTER:\n${t.letter}`,
    t.subject ? `SUBJECT: ${t.subject}` : '',
    t.outreach ? `OUTREACH:\n${t.outreach}` : '',
    t.followUp ? `FOLLOW-UP:\n${t.followUp}` : '',
    ...t.shortAnswers.map((a) => `ANSWER (${a.key}):\n${a.answer}`),
    cv ? `CV:\n${JSON.stringify(cv, null, 1)}` : '',
  ].filter(Boolean);
  if (opts.auditor === false) return code;
  const auditor = await ai.ask({
    task: 'audit',
    label,
    system: writerSystem(ctx, FACT_AUDITOR),
    content: `Target role: ${ctx.job.title} at ${ctx.job.company}\n\n<tailored>\n${parts.join('\n\n')}\n</tailored>`,
    schema: AuditOutSchema,
    maxTokens: 6000,
  });
  return [...code, ...auditor.issues.map((i) => ({ ...i, origin: 'auditor' as const }))];
}
