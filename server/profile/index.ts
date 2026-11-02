import type { Answered, MasterProfile, StyleFingerprint } from '../contracts/profile.ts';
import { answerFor as answerFromBank, type AnswerContext } from './answers.ts';
import { learningSkills as learningNow } from './learning.ts';
import { loadMasterProfile as loadMaster } from './master.ts';
import { syncProfile as runSync, type SyncOptions, type SyncReport } from './sync.ts';
import { recordUnknown as saveUnknown } from './unknown.ts';
import { storedStyle } from './voice.ts';

/**
 * A03 — the living master profile, voice bank, answer bank and learning list.
 * This file is the cross-module surface (02-CONTRACTS §4); the pieces live in
 * the sibling files and are re-exported below for callers that need more.
 */

/**
 * Refresh from CV, GitHub and portfolio. Adds new facts, deactivates removed
 * ones, never touches manual facts or facts the owner hid. Returns the full
 * sync report (`added` is the contract field).
 */
export async function syncProfile(opts: SyncOptions = {}): Promise<SyncReport> {
  return runSync(opts);
}

/** The master profile, or null before a CV has been uploaded. Cached: safe to call per job. */
export function loadMasterProfile(): MasterProfile | null {
  return loadMaster();
}

/**
 * Resolve a form question from the answer bank or the profile. Null when
 * nothing answers it with confidence (the caller then records it as unknown).
 * With `options`, the value is always one of them.
 */
export async function answerFor(question: string, ctx: { jobId?: string; fieldKind?: string; options?: string[] } = {}): Promise<Answered | null> {
  const c: AnswerContext = ctx;
  return answerFromBank(question, c);
}

/** Save a question nobody could answer truthfully, for the owner. Returns its id (the same id for a repeat). */
export function recordUnknown(q: { question: string; jobId: string | null; fieldKind: string; options?: string[] }): string {
  return saveUnknown(q);
}

/** The candidate's style fingerprint from the voice bank (null until they write a passage). */
export function styleFingerprint(): StyleFingerprint | null {
  return storedStyle();
}

/** Skills with status `learning` — the only ones a CV may list under "Currently learning". */
export function learningSkills(): string[] {
  return learningNow();
}

// Wider surface for A04 (writer), A05 (forms), A07 (API), A08 (Telegram /answer, scheduler), A10 (UI).
export { answerUnknown, ignoreUnknown, listUnknown, requeueJob } from './unknown.ts';
export { fingerprintOf, listVoice, SUGGESTED_PROMPTS } from './voice.ts';
export { factsForPrompt, listFacts } from './facts.ts';
export { matchOption, listAnswers, upsertAnswer } from './answers.ts';
export { normalizeQuestion, detectIntent } from './questions.ts';
export { lastSync, SYNC_PARTS, type SyncOptions, type SyncReport } from './sync.ts';
export { invalidateMasterProfile } from './master.ts';
