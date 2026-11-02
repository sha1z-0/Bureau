import { z } from 'zod/v4';
import { ProfileSchema } from '../services/profileStore.ts';

/** The master profile: the only source of truth the writer and form engine may draw on. */

export const FactSource = z.enum(['cv', 'github', 'portfolio', 'manual', 'linkedin']);
export const FactKind = z.enum(['skill', 'experience', 'project', 'education', 'certification', 'achievement', 'metric', 'link', 'other']);

export const ProfileFactSchema = z.object({
  id: z.string(),
  kind: FactKind,
  /** Verbatim or near-verbatim from the source. Never embellished. */
  text: z.string(),
  source: FactSource,
  /** URL, file name or document id the fact came from. */
  sourceRef: z.string(),
  addedAt: z.string(),
  active: z.boolean(),
});
export type ProfileFact = z.infer<typeof ProfileFactSchema>;

export const VoicePassageSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
});
export type VoicePassage = z.infer<typeof VoicePassageSchema>;

export const AnswerScope = z.object({
  countries: z.array(z.string()).optional(),
  jobTypes: z.array(z.string()).optional(),
  ats: z.array(z.string()).optional(),
});

export const AnswerEntrySchema = z.object({
  id: z.string(),
  questionNorm: z.string(),
  questionRaw: z.string(),
  answer: z.string(),
  scope: AnswerScope,
  source: z.enum(['owner', 'derived']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AnswerEntry = z.infer<typeof AnswerEntrySchema>;

export const LearningItemSchema = z.object({
  id: z.string(),
  skill: z.string(),
  /** Only `learning` items may appear on a CV under "Currently learning". */
  status: z.enum(['learning', 'queued', 'done']),
  startedAt: z.string().nullable(),
  notes: z.string(),
});
export type LearningItem = z.infer<typeof LearningItemSchema>;

export const LinksSchema = z.object({
  github: z.string(),
  portfolio: z.string(),
  linkedin: z.string(),
  socials: z.array(z.object({ label: z.string(), url: z.string() })),
});
export type Links = z.infer<typeof LinksSchema>;

export const GithubSummarySchema = z.object({
  login: z.string(),
  syncedAt: z.string(),
  profileUrl: z.string().optional(),
  repos: z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      description: z.string(),
      languages: z.array(z.string()),
      topics: z.array(z.string()),
      stars: z.number(),
      fork: z.boolean(),
      pushedAt: z.string().nullable(),
      /** The candidate's own commits in the last 90 days (capped at 100). */
      recentCommits: z.number().nullable().optional(),
      archived: z.boolean().optional(),
    }),
  ),
});
export type GithubSummary = z.infer<typeof GithubSummarySchema>;

/** Measured from the voice bank; the writer's stylometric lint compares letters against it. */
export const StyleFingerprintSchema = z.object({
  passages: z.number(),
  words: z.number(),
  sentenceLenMean: z.number(),
  sentenceLenStd: z.number(),
  typeTokenRatio: z.number(),
  contractionRate: z.number(),
  firstPersonRate: z.number(),
  connectives: z.array(z.string()),
});
export type StyleFingerprint = z.infer<typeof StyleFingerprintSchema>;

export const MasterProfileSchema = ProfileSchema.extend({
  facts: z.array(ProfileFactSchema),
  voiceBank: z.array(VoicePassageSchema),
  answerBank: z.array(AnswerEntrySchema),
  learning: z.array(LearningItemSchema),
  links: LinksSchema,
  github: GithubSummarySchema.nullable(),
  style: StyleFingerprintSchema.nullable(),
});
export type MasterProfile = z.infer<typeof MasterProfileSchema>;

/** A resolved value for a form question, from whichever source answered it. */
export const AnsweredSchema = z.object({
  value: z.string(),
  source: z.enum(['profile', 'answer_bank', 'writer', 'file', 'generated']),
  confidence: z.number().min(0).max(1),
  /** The answer-bank entry or profile key used. */
  key: z.string(),
});
export type Answered = z.infer<typeof AnsweredSchema>;

export const UnknownQuestionSchema = z.object({
  id: z.string(),
  questionRaw: z.string(),
  questionNorm: z.string(),
  jobId: z.string().nullable(),
  fieldKind: z.string(),
  options: z.array(z.string()),
  status: z.enum(['open', 'answered', 'ignored']),
  createdAt: z.string(),
});
export type UnknownQuestion = z.infer<typeof UnknownQuestionSchema>;
