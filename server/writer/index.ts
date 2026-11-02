import type { Answered } from '../contracts/profile.ts';
import type { WriteResult } from '../contracts/writer.ts';
import { answerQuestionTraced, type AnswerOptions } from './answers.ts';
import { draftFollowUpWith } from './followup.ts';
import { writeApplicationRun, type WriteOptions } from './pipeline.ts';

/**
 * A04: truthful, tailored, human-sounding applications. This file is the
 * cross-module surface (02-CONTRACTS §4); the pieces live in the sibling files.
 */

/**
 * Decode → research → evidence map → CV → letters → critic → humanize → lint →
 * truth lock → packet. Moves the job selected → writing → written, or skipped
 * with the reason. Every saved letter has critic ≥ 8, a lint pass and a clean
 * truth lock (enforced in code).
 */
export async function writeApplication(jobId: string, campaignId: string, opts: WriteOptions = {}): Promise<WriteResult> {
  return (await writeApplicationRun(jobId, campaignId || null, opts)).result;
}

/** Answer a long-form form question from the same evidence map and voice (short lint + truth lock). */
export async function answerQuestion(
  jobId: string,
  question: string,
  opts: { maxChars?: number; options?: string[] } & Pick<AnswerOptions, 'ai' | 'context'> = {},
): Promise<Answered | null> {
  return (await answerQuestionTraced(jobId, question, opts)).answered;
}

/** One short, polite follow-up for an application (used by A09 after N days). */
export async function draftFollowUp(applicationId: string): Promise<{ subject: string; body: string } | null> {
  return draftFollowUpWith(applicationId);
}

// Wider surface for A05 (packets for forms), A07 (API), A08 (autopilot), A10 (UI) and the report.
export { loadPacket, packetForJob, loadVariants, PACKETS_DIR } from './packet.ts';
export { banditStats, EXPLORE_RATE, LENGTH_ARMS } from './bandit.ts';
export { lintLetter, lintShort } from './lint.ts';
export { codeTruth } from './truth.ts';
export { findTells, HUMANIZER_RULES } from './humanizer.ts';
export { writeApplicationRun, type WriteOptions, type WriteRun } from './pipeline.ts';
export { CRITIC_BAR } from './critic.ts';
