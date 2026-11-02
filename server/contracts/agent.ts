import { z } from 'zod/v4';
import { AtsFamily } from './job.ts';
import { ValueSource } from './forms.ts';

/** Browser agent actions and the traces that teach Bureau new form recipes. */

/**
 * One turn of the agent: Claude picks exactly one action. Values are never
 * free-typed facts — the agent names a value key and Bureau's mapper resolves it.
 */
export const AgentActionSchema = z.object({
  action: z.enum(['fill', 'select', 'check', 'upload', 'click', 'next', 'wait', 'ask_value', 'done', 'give_up']),
  /** Field signature from the extractor, or an accessibility ref from the snapshot. */
  target: z.string().default(''),
  valueKey: z.string().default(''),
  /** For upload: which file. */
  file: z.enum(['cv', 'letter', '']).default(''),
  /** For ask_value: the question to route through the answer chain. */
  question: z.string().default(''),
  reason: z.string().default(''),
});
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const TraceStepSchema = z.object({
  i: z.number().int(),
  action: AgentActionSchema.shape.action,
  fieldSignature: z.string().optional(),
  labelNorm: z.string().optional(),
  widget: z.string().optional(),
  selectors: z.array(z.string()).default([]),
  valueSource: ValueSource.optional(),
  valueKey: z.string().optional(),
  step: z.number().int().default(0),
  url: z.string(),
  beforeShot: z.string().optional(),
  afterShot: z.string().optional(),
  ok: z.boolean(),
  note: z.string().optional(),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const TraceSchema = z.object({
  id: z.string().optional(),
  jobId: z.string().nullable(),
  applicationId: z.string().nullable(),
  /** `internal` or `external:<apiKeyId>`. */
  origin: z.string(),
  url: z.string(),
  ats: AtsFamily.nullable(),
  steps: z.array(TraceStepSchema).max(500),
  outcome: z.enum(['verified', 'submitted', 'failed', 'gave_up']),
  startedAt: z.string(),
  finishedAt: z.string(),
});
export type Trace = z.infer<typeof TraceSchema>;

export const AgentRunResultSchema = z.object({
  status: z.enum(['done', 'gave_up', 'budget', 'blocked', 'error']),
  reason: z.string(),
  traceId: z.string().nullable(),
  steps: z.number().int(),
  costUsd: z.number().default(0),
  injectionAttempts: z.number().int().default(0),
});
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;
