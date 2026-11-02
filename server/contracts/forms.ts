import { z } from 'zod/v4';
import { AtsFamily } from './job.ts';

/** Form engine contracts. Field signatures, not raw selectors, are what carries between runs. */

export const FieldKind = z.enum([
  'text',
  'email',
  'tel',
  'url',
  'number',
  'textarea',
  'select',
  'combobox',
  'radio',
  'checkbox',
  'date',
  'file',
  'richtext',
  'location',
  'phone',
  'consent',
  'unknown',
]);
export type FieldKind = z.infer<typeof FieldKind>;

export const FormFieldSchema = z.object({
  /** Run-local id (e.g. a data attribute the extractor stamps). */
  id: z.string(),
  kind: FieldKind,
  label: z.string(),
  labelNorm: z.string(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  section: z.string().optional(),
  /** Wizard step index, 0-based. */
  step: z.number().int(),
  /** Stable hash of labelNorm + kind + option set + section. */
  signature: z.string(),
  /** Frame path when the field lives in an iframe; empty for the main frame. */
  frame: z.string().optional(),
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const ValueSource = z.enum(['profile', 'answer_bank', 'writer', 'file', 'generated']);
export type ValueSource = z.infer<typeof ValueSource>;

export const FieldValueSchema = z.object({
  fieldId: z.string(),
  source: ValueSource,
  /** Profile key, answer-bank id, writer short-answer key, or `cv` / `letter` for files. */
  key: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
});
export type FieldValue = z.infer<typeof FieldValueSchema>;

export const RecipeAction = z.enum(['fill', 'select', 'check', 'upload', 'click', 'next', 'wait', 'submit']);
export const RecipeStepSchema = z.object({
  action: RecipeAction,
  fieldSignature: z.string().optional(),
  /** Candidates tried in order: role-based, label-based, CSS, xpath. */
  selectors: z.array(z.string()),
  widget: z.string(),
  valueSource: ValueSource.optional(),
  valueKey: z.string().optional(),
  labelNorm: z.string().optional(),
});
export type RecipeStep = z.infer<typeof RecipeStepSchema>;

export const RecipeScope = z.enum(['ats', 'company', 'url']);
export const RecipeStatus = z.enum(['candidate', 'shadow', 'active', 'demoted']);

export const RecipeSchema = z.object({
  id: z.string().optional(),
  ats: AtsFamily,
  scope: RecipeScope,
  /** ATS family, company key or URL pattern, by scope. */
  scopeKey: z.string(),
  version: z.number().int().default(1),
  status: RecipeStatus.default('candidate'),
  match: z.object({ urlPattern: z.string().optional(), domFingerprint: z.string().optional() }),
  steps: z.array(RecipeStepSchema),
  /** Company-specific long questions kept as signature → answer-bank hooks rather than steps. */
  hooks: z.array(z.object({ fieldSignature: z.string(), labelNorm: z.string() })).default([]),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const FieldLogEntrySchema = z.object({
  signature: z.string(),
  label: z.string(),
  kind: FieldKind,
  required: z.boolean(),
  source: ValueSource.nullable(),
  key: z.string().nullable(),
  intended: z.string().nullable(),
  readBack: z.string().nullable(),
  ok: z.boolean(),
  note: z.string().optional(),
});
export type FieldLogEntry = z.infer<typeof FieldLogEntrySchema>;

export const FillStatus = z.enum(['submitted', 'rehearsed', 'needs_you', 'skipped', 'failed']);
export type FillStatus = z.infer<typeof FillStatus>;

export const FillOutcomeSchema = z.object({
  status: FillStatus,
  reason: z.string(),
  /** Final screenshot (proof page when submitted). */
  shotPath: z.string().nullable(),
  /** One screenshot per wizard step. */
  shots: z.array(z.string()).default([]),
  answers: z.array(z.object({ label: z.string(), value: z.string(), source: ValueSource.nullable() })),
  verified: z.boolean(),
  unknownQuestions: z.array(z.object({ label: z.string(), kind: FieldKind, options: z.array(z.string()) })),
  fieldLog: z.array(FieldLogEntrySchema).default([]),
  ats: AtsFamily.nullable().default(null),
  via: z.enum(['recipe', 'adapter', 'agent', 'generic']).nullable().default(null),
  recipeId: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
});
export type FillOutcome = z.infer<typeof FillOutcomeSchema>;

export interface FillOptions {
  /** False = rehearse: fill and verify, never submit. */
  submit: boolean;
  headful?: boolean;
  campaignId?: string;
  /** What to do with a required question nobody can answer truthfully. */
  onUnknown?: 'skip' | 'needs_you';
  signal?: AbortSignal;
}

export const VerifyResultSchema = z.object({
  verified: z.boolean(),
  problems: z.array(z.string()),
  fieldLog: z.array(FieldLogEntrySchema),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;
