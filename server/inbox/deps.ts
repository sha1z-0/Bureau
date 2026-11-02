import type { Answered } from '../contracts/profile.ts';
import type { NotifyKind, NotifyPayload } from '../notify/index.ts';

/**
 * Everything the inbox calls in other modules, behind one seam. Production
 * wires the real modules lazily (so a stub that throws NotImplemented only
 * matters when it is reached); tests pass fakes.
 */
export interface InboxDeps {
  now(): number;
  notify(kind: NotifyKind, payload: NotifyPayload): Promise<void>;
  buildPlan(applicationId: string, interviewDate: string | null, startAt: string): Promise<{ id: string; days: number; gaps: string[] }>;
  answerFor(question: string, jobId: string | null): Promise<Answered | null>;
  /** Put a question the answer bank cannot answer in front of the owner (A03's unknown-question queue). */
  recordUnknown(question: string): Promise<string | null>;
  /** A04's follow-up draft. NotImplemented (A04 not merged) means "no follow-up today". */
  draftFollowUp(applicationId: string): Promise<{ subject: string; body: string } | null>;
  sendMail(mail: { to: string; subject: string; text: string; inReplyTo?: string | null }): Promise<string>;
}

export const realDeps: InboxDeps = {
  now: () => Date.now(),
  notify: async (kind, payload) => (await import('../notify/index.ts')).notify(kind, payload),
  buildPlan: async (applicationId, interviewDate, startAt) => {
    const { buildLearningPlan } = await import('../learning/index.ts');
    const { id, plan } = await buildLearningPlan(applicationId, interviewDate, { startAt });
    return { id, days: plan.days.length, gaps: plan.gaps };
  },
  answerFor: async (question, jobId) => (await import('../profile/index.ts')).answerFor(question, jobId ? { jobId } : {}),
  recordUnknown: async (question) => (await import('../profile/index.ts')).recordUnknown({ question, jobId: null, fieldKind: 'textarea' }),
  draftFollowUp: async (applicationId) => (await import('../writer/index.ts')).draftFollowUp(applicationId),
  sendMail: async (mail) => (await import('../services/mailer.ts')).sendPlainEmail(mail),
};

let current: InboxDeps = realDeps;

export function inboxDeps(): InboxDeps {
  return current;
}

/** Override some or all deps (tests). Returns a restore function. */
export function setInboxDeps(patch: Partial<InboxDeps> | null): () => void {
  const prev = current;
  current = patch ? { ...current, ...patch } : realDeps;
  return () => {
    current = prev;
  };
}
