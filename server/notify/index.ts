import { logEvent } from '../db.ts';
import { redact } from '../errors.ts';
import { emit } from '../services/bus.ts';
import { ownerAddress, sendDigestMail } from './email.ts';
import { sendNtfy } from './ntfy.ts';
import { notifySettings, ntfyTopic, telegramCredentials, type NotifySettings } from './settings.ts';
import { escapeHtml, sendTelegram } from './telegram.ts';

/** A08: Telegram, email digest and ntfy. */

export interface NotifyPayload {
  title: string;
  body: string;
  campaignId?: string | null;
  applicationId?: string | null;
  /** Deep link into the UI. */
  url?: string;
  /** Pre-rendered Telegram HTML (the digest renders its own). Falls back to title + body, escaped. */
  html?: string;
  /** Pre-rendered email HTML for the digest. */
  emailHtml?: string;
}

export type NotifyKind = 'alert' | 'digest' | 'info';

export interface Delivery {
  via: string[];
  errors: { channel: string; message: string }[];
}

function telegramHtml(kind: NotifyKind, p: NotifyPayload): string {
  if (p.html) return p.html;
  const head = kind === 'alert' ? `<b>Alert: ${escapeHtml(p.title)}</b>` : `<b>${escapeHtml(p.title)}</b>`;
  const link = p.url && /^https?:\/\//.test(p.url) ? `\n${escapeHtml(p.url)}` : '';
  return `${head}\n${escapeHtml(p.body)}${link}`;
}

/**
 * Send to every channel switched on for this kind. Never throws: a dead
 * channel is logged and reported in the result, the others still go out.
 */
export async function deliver(kind: NotifyKind, payload: NotifyPayload, override?: NotifySettings): Promise<Delivery> {
  const s = override ?? notifySettings();
  const out: Delivery = { via: [], errors: [] };
  const attempt = async (channel: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      out.via.push(channel);
    } catch (err) {
      out.errors.push({ channel, message: redact((err as Error).message) });
    }
  };

  const tgWanted = s.telegram.enabled && (kind === 'alert' ? s.telegram.alerts : kind === 'digest' ? s.telegram.digest : s.telegram.info);
  if (tgWanted && telegramCredentials()) await attempt('telegram', () => sendTelegram(telegramHtml(kind, payload)));

  const topic = ntfyTopic();
  const ntfyWanted = s.ntfy.enabled && !!topic && (kind === 'alert' ? s.ntfy.alerts : kind === 'digest' ? s.ntfy.digest : false);
  if (ntfyWanted && topic) {
    await attempt('ntfy', () =>
      sendNtfy(s.ntfy.server, topic, { title: payload.title, body: payload.body, priority: kind === 'alert' ? 'high' : 'default', tags: [kind], click: payload.url }),
    );
  }

  if (kind === 'digest' && s.email.digest) {
    const to = ownerAddress(s.email.to);
    if (to) await attempt('email', () => sendDigestMail({ to, subject: payload.title, text: payload.body, html: payload.emailHtml }));
    else out.errors.push({ channel: 'email', message: 'No digest address and no SMTP account.' });
  }

  for (const e of out.errors) logEvent('notify', `${kind} via ${e.channel} failed: ${e.message}`);
  if (kind === 'alert') emit({ type: 'activity', level: 'warn', message: `Alert: ${payload.title}` });
  return out;
}

/** Contract entry point (02-CONTRACTS §4). Resolves once every channel has been tried. */
export async function notify(kind: NotifyKind, payload: NotifyPayload): Promise<void> {
  await deliver(kind, payload);
}

export { notifySettings, saveNotifySettings, publicNotifyState, setTelegramCredentials, clearTelegram, setNtfyTopic } from './settings.ts';
export { sendTelegram, setTelegramHttp, escapeHtml } from './telegram.ts';
export { parseCommand, handleUpdate, startTelegramPoller, type CommandHandlers } from './commands.ts';
export { pushQuestions, resolveQuestionRef } from './questions.ts';
export { setMailSender } from './email.ts';
export { setNtfyHttp } from './ntfy.ts';
