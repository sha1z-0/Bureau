import type { Answered, MasterProfile, StyleFingerprint } from '../contracts/profile.ts';
import { NotImplemented } from '../contracts/stub.ts';

/** A03 — the living master profile, voice bank, answer bank and learning list. */

/** Refresh from CV, GitHub and portfolio. Adds new facts, deactivates removed ones, never overwrites manual facts. */
export async function syncProfile(): Promise<{ added: number }> {
  throw new NotImplemented('A03', 'syncProfile');
}

export function loadMasterProfile(): MasterProfile | null {
  throw new NotImplemented('A03', 'loadMasterProfile');
}

/** Resolve a form question from the profile or answer bank. Null when nothing answers it with confidence. */
export async function answerFor(question: string, ctx: { jobId?: string; fieldKind?: string; options?: string[] } = {}): Promise<Answered | null> {
  void question;
  void ctx;
  throw new NotImplemented('A03', 'answerFor');
}

/** Save a question nobody could answer truthfully, for the owner. Returns its id. */
export function recordUnknown(q: { question: string; jobId: string | null; fieldKind: string; options?: string[] }): string {
  void q;
  throw new NotImplemented('A03', 'recordUnknown');
}

export function styleFingerprint(): StyleFingerprint | null {
  throw new NotImplemented('A03', 'styleFingerprint');
}

/** Skills with status `learning` — the only ones a CV may list under "Currently learning". */
export function learningSkills(): string[] {
  throw new NotImplemented('A03', 'learningSkills');
}
