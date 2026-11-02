import { NotImplemented } from '../contracts/stub.ts';

/** A08 — Telegram, email digest and ntfy. */

export interface NotifyPayload {
  title: string;
  body: string;
  campaignId?: string | null;
  applicationId?: string | null;
  /** Deep link into the UI. */
  url?: string;
}

export async function notify(kind: 'alert' | 'digest' | 'info', payload: NotifyPayload): Promise<void> {
  void kind;
  void payload;
  throw new NotImplemented('A08', 'notify');
}
