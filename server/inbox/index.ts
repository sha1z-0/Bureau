import { NotImplemented } from '../contracts/stub.ts';

/** A09 — the job-search mailbox. */

/** Fetch, classify, link and act on new mail. Returns how many new messages were handled. */
export async function pollInbox(): Promise<number> {
  throw new NotImplemented('A09', 'pollInbox');
}

/** Resolve with a verification code (or link) for `domain` when one arrives, or null on timeout. */
export async function waitForCode(domain: string, timeoutMs: number): Promise<string | null> {
  void domain;
  void timeoutMs;
  throw new NotImplemented('A09', 'waitForCode');
}
