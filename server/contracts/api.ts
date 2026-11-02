import { z } from 'zod/v4';
import { AtsFamily } from './job.ts';
import { PipelineState } from './campaign.ts';
import { FieldKind, RecipeSchema } from './forms.ts';
import { TraceSchema } from './agent.ts';

/** Request and response shapes for the external agent API (`/api/v1`) and its MCP mirror. */

export const API_SCOPES = ['jobs:read', 'packets:read', 'answers:read', 'recipes:read', 'traces:write', 'applications:write'] as const;
export const ApiScope = z.enum(API_SCOPES);
export type ApiScope = z.infer<typeof ApiScope>;

export const ApiKeyInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(ApiScope),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiKeyInfo = z.infer<typeof ApiKeyInfoSchema>;

export const CreateKeyRequest = z.object({ name: z.string().min(1).max(80), scopes: z.array(ApiScope).min(1) });
/** The full key is returned exactly once. */
export const CreateKeyResponse = z.object({ key: z.string(), info: ApiKeyInfoSchema });

export const ListJobsQuery = z.object({
  state: PipelineState.default('selected'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const JobSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote: z.boolean(),
  score: z.number().nullable(),
  state: PipelineState,
  applyUrl: z.string().nullable(),
  ats: AtsFamily.nullable(),
  summary: z.string(),
  claimedBy: z.string().nullable(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;
export const ListJobsResponse = z.object({ jobs: z.array(JobSummarySchema) });

export const JobDetailResponse = JobSummarySchema.extend({
  description: z.string(),
  requirements: z.array(z.object({ text: z.string(), importance: z.string(), match: z.string() })),
});

export const ClaimRequest = z.object({ ttlMinutes: z.number().int().min(1).max(60).default(20) });
export const ClaimResponse = z.object({ jobId: z.string(), holder: z.string(), expiresAt: z.string() });

export const PacketResponse = z.object({
  applicationId: z.string(),
  jobId: z.string(),
  subject: z.string(),
  coverLetter: z.string(),
  shortAnswers: z.record(z.string(), z.string()),
  outreach: z.string(),
  /** Short-lived signed URLs: GET /api/v1/files/:token. */
  files: z.object({ cv: z.string(), letter: z.string(), expiresAt: z.string() }),
});

export const AnswerRequest = z.object({
  jobId: z.string(),
  question: z.string().min(1).max(2000),
  fieldKind: FieldKind.default('text'),
  options: z.array(z.string().max(300)).max(200).optional(),
});
export const AnswerResponse = z.object({
  value: z.string().nullable(),
  source: z.enum(['profile', 'answer_bank', 'writer', 'file', 'generated', 'unknown']),
  confidence: z.number(),
  /** Set when the question was recorded as unknown for the owner to answer. */
  unknownId: z.string().nullable(),
});

export const RecipeQuery = z.object({ url: z.string().url() });
export const RecipeResponse = z.object({ recipe: RecipeSchema.nullable() });

/** The server stamps `origin` from the key; agents may leave it out. */
export const TraceSubmitRequest = TraceSchema.extend({ origin: z.string().optional() });
export const TraceSubmitResponse = z.object({ traceId: z.string(), queued: z.boolean() });

export const SubmittedRequest = z.object({
  /** Base64 PNG or JPEG, at most ~4 MB decoded. */
  proofScreenshot: z.string().max(6_000_000),
  confirmationText: z.string().max(4000).optional(),
  url: z.string().url(),
});
export const FailedRequest = z.object({ reason: z.string().min(1).max(2000) });
export const OkResponse = z.object({ ok: z.literal(true) });

export const HealthResponse = z.object({ ok: z.boolean(), version: z.string(), scopes: z.array(ApiScope) });
