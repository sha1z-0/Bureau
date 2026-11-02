import type { Answered } from '../contracts/profile.ts';
import type { WriteResult } from '../contracts/writer.ts';
import { NotImplemented } from '../contracts/stub.ts';

/** A04 — truthful, tailored, human-sounding applications. */

/** Decode → research → evidence map → CV → letters → critic → humanize → lint → truth lock → packet. */
export async function writeApplication(jobId: string, campaignId: string): Promise<WriteResult> {
  void jobId;
  void campaignId;
  throw new NotImplemented('A04', 'writeApplication');
}

/** Answer a long-form form question from the same evidence map and voice (short lint + truth lock). */
export async function answerQuestion(jobId: string, question: string, opts: { maxChars?: number; options?: string[] } = {}): Promise<Answered | null> {
  void jobId;
  void question;
  void opts;
  throw new NotImplemented('A04', 'answerQuestion');
}

/** One short, polite follow-up for an application (used by A09 after N days). */
export async function draftFollowUp(applicationId: string): Promise<{ subject: string; body: string } | null> {
  void applicationId;
  throw new NotImplemented('A04', 'draftFollowUp');
}
