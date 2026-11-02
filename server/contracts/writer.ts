import { z } from 'zod/v4';
import { Importance } from './match.ts';

/** The writer's evidence map, quality gates and the packet every channel applies with. */

export const Framing = z.enum(['direct', 'transferable', 'learning', 'omit']);
export type Framing = z.infer<typeof Framing>;

export const EvidenceItemSchema = z.object({
  requirement: z.string(),
  importance: Importance,
  /** Ids from profile_facts (or learning_list for `learning`). Empty only for `omit`. */
  factIds: z.array(z.string()),
  evidence: z.string(),
  framing: Framing,
  /** How to say it in the job's own vocabulary, within the truth. */
  phrasing: z.string(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const EvidenceMapSchema = z.object({
  jobId: z.string(),
  priorities: z.array(z.string()),
  mustWins: z.array(z.string()),
  tone: z.string(),
  seniority: z.string(),
  hooks: z.array(z.object({ text: z.string(), sourceUrl: z.string() })),
  items: z.array(EvidenceItemSchema),
  /** The single biggest honest gap the letter may address head-on, if any. */
  biggestGap: z.string().nullable(),
});
export type EvidenceMap = z.infer<typeof EvidenceMapSchema>;

export const LetterStrategy = z.enum(['hook', 'proof', 'story']);
export type LetterStrategy = z.infer<typeof LetterStrategy>;

export const CriticResultSchema = z.object({
  score: z.number().min(0).max(10),
  scores: z.object({
    specificity: z.number(),
    evidence: z.number(),
    voice: z.number(),
    clarity: z.number(),
    ask: z.number(),
    aiTells: z.number(),
  }),
  demands: z.array(z.string()),
});
export type CriticResult = z.infer<typeof CriticResultSchema>;

export const LintCheckSchema = z.object({
  id: z.string(),
  pass: z.boolean(),
  value: z.union([z.number(), z.string()]),
  target: z.string(),
});
export const LintResultSchema = z.object({ pass: z.boolean(), checks: z.array(LintCheckSchema) });
export type LintResult = z.infer<typeof LintResultSchema>;

export const TruthIssueSchema = z.object({
  claim: z.string(),
  reason: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  origin: z.enum(['code', 'auditor']),
});
export const TruthResultSchema = z.object({ pass: z.boolean(), issues: z.array(TruthIssueSchema) });
export type TruthResult = z.infer<typeof TruthResultSchema>;

export const LetterVariantSchema = z.object({
  id: z.string(),
  strategy: LetterStrategy,
  text: z.string(),
  /** Voice-bank passage ids this variant adapted (at least two). */
  passagesUsed: z.array(z.string()),
  styleTags: z.array(z.string()),
  critic: CriticResultSchema.nullable(),
  lint: LintResultSchema.nullable(),
  chosen: z.boolean(),
});
export type LetterVariant = z.infer<typeof LetterVariantSchema>;

export const ApplicationPacketSchema = z.object({
  applicationId: z.string(),
  jobId: z.string(),
  cvPdfPath: z.string(),
  letterPdfPath: z.string(),
  subject: z.string(),
  coverLetter: z.string(),
  /** Pre-written answers keyed by normalised question ("why us", "why this role", "tell us about a project"). */
  shortAnswers: z.record(z.string(), z.string()),
  outreach: z.string(),
  followUp: z.string().default(''),
  /** letter_variants.id of the chosen letter (also applications.variant_id). */
  variantId: z.string().optional(),
  strategy: LetterStrategy.optional(),
  /** Measured on the rendered PDF. */
  cvPages: z.number().int().optional(),
  quality: z.object({ critic: CriticResultSchema, lint: LintResultSchema, truth: TruthResultSchema }),
});
export type ApplicationPacket = z.infer<typeof ApplicationPacketSchema>;

export type WriteResult = ApplicationPacket | { skipped: string };
