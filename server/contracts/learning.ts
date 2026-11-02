import { z } from 'zod/v4';

/** Crash learning plans (on interview interest) and the weekly skill-gap report. */

const Resource = z.object({ title: z.string(), url: z.string(), free: z.boolean() });

export const LearningPlanSchema = z.object({
  applicationId: z.string(),
  company: z.string(),
  role: z.string(),
  interviewDate: z.string().nullable(),
  gaps: z.array(z.string()),
  days: z.array(
    z.object({
      day: z.number().int(),
      focus: z.string(),
      tasks: z.array(z.string()),
      resources: z.array(Resource),
      miniProject: z.string().nullable(),
    }),
  ),
  likelyQuestions: z.array(z.string()),
  /** Real experience mapped to the role's needs. */
  talkingPoints: z.array(z.string()),
});
export type LearningPlan = z.infer<typeof LearningPlanSchema>;

export const GapReportSchema = z.object({
  period: z.string(),
  generatedAt: z.string(),
  jobsConsidered: z.number().int(),
  skills: z.array(
    z.object({
      skill: z.string(),
      count: z.number().int(),
      weighted: z.number(),
      typicalDepth: z.string(),
      suggestedProject: z.string(),
    }),
  ),
});
export type GapReport = z.infer<typeof GapReportSchema>;
