import { z } from 'zod/v4';
import { AppError } from '../errors.ts';
import { TailoredCvSchema } from '../writer/cvSchema.ts';
import { writeApplicationRun } from '../writer/pipeline.ts';

/**
 * v1 surface, now backed by the v2 writer (server/writer). The schemas keep
 * their v1 shapes for the studio, the v1 routes, the form filler and the hunt;
 * `draftApplication` runs the full writer pipeline (evidence map, three
 * voice-bank letters, critic, humanizer, lint, truth lock) and returns the
 * application id. A job the gates reject is saved with status `skipped` and a
 * high-severity "Quality gate" issue, so v1 callers that check the fact lock
 * hold it back.
 */

export { TailoredCvSchema, type TailoredCv } from '../writer/cvSchema.ts';

export const DraftSchema = z.object({
  subject: z.string(),
  coverLetter: z.string(),
  outreachMessage: z.string(),
  cv: TailoredCvSchema,
  emphasis: z.array(z.string()),
  keywordsUsed: z.array(z.string()),
});

export const AuditSchema = z.object({
  issues: z.array(z.object({ claim: z.string(), reason: z.string(), severity: z.enum(['high', 'medium', 'low']) })),
});

export interface AuditIssue {
  claim: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
  origin: 'code' | 'auditor';
}

export async function draftApplication(jobId: string, instructions = ''): Promise<string> {
  const { applicationId } = await writeApplicationRun(jobId, null, { manual: true, instructions });
  if (!applicationId) throw new AppError(500, 'WRITER', 'The writer could not start on this job.');
  return applicationId;
}
