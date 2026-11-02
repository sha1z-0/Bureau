import { z } from 'zod/v4';

/** Mailbox classification. Email bodies are untrusted data. */

export const INBOX_CLASSES = [
  'verification_code',
  'confirmation_received',
  'rejection',
  'interview_invite',
  'assessment',
  'recruiter_question',
  'offer',
  'other',
] as const;
export const InboxClass = z.enum(INBOX_CLASSES);
export type InboxClass = z.infer<typeof InboxClass>;

export const ClassifiedMessageSchema = z.object({
  messageId: z.string(),
  from: z.string(),
  subject: z.string(),
  receivedAt: z.string(),
  class: InboxClass,
  confidence: z.number().min(0).max(1),
  company: z.string().nullable(),
  /** Verification code, when class = verification_code. Never logged in plain text. */
  code: z.string().nullable(),
  links: z.array(z.string()),
  schedulingLinks: z.array(z.string()),
  dates: z.array(z.string()),
  /** One line on what they asked for and by when. */
  summary: z.string(),
  deadline: z.string().nullable(),
  applicationId: z.string().nullable(),
});
export type ClassifiedMessage = z.infer<typeof ClassifiedMessageSchema>;

/** Stage an application moves through as replies arrive. */
export const ApplicationStage = z.enum(['applied', 'screening', 'interview', 'offer', 'rejected']);
export type ApplicationStage = z.infer<typeof ApplicationStage>;
