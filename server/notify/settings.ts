import { z } from 'zod/v4';
import { getSetting, setSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { deleteSecret, getSecret, secretHint, setSecret } from '../security/vault.ts';

/**
 * Where notifications go. Non-secret switches live in settings (`notify`);
 * the bot token, chat id and ntfy topic live in the vault.
 */

export const NotifySettingsSchema = z.object({
  telegram: z.object({
    enabled: z.boolean(),
    alerts: z.boolean(),
    digest: z.boolean(),
    questions: z.boolean(),
    info: z.boolean(),
  }),
  email: z.object({
    /** Email the daily digest over the existing SMTP account. */
    digest: z.boolean(),
    /** Recipient; empty = the SMTP account's own address. */
    to: z.string().max(200),
  }),
  ntfy: z.object({
    enabled: z.boolean(),
    server: z.string().max(200),
    alerts: z.boolean(),
    digest: z.boolean(),
  }),
});
export type NotifySettings = z.infer<typeof NotifySettingsSchema>;

export const DEFAULT_NOTIFY: NotifySettings = {
  telegram: { enabled: true, alerts: true, digest: true, questions: true, info: true },
  email: { digest: false, to: '' },
  ntfy: { enabled: false, server: 'https://ntfy.sh', alerts: true, digest: false },
};

export function notifySettings(): NotifySettings {
  const saved = getSetting<Partial<NotifySettings>>('notify', {});
  const merged = {
    telegram: { ...DEFAULT_NOTIFY.telegram, ...(saved.telegram ?? {}) },
    email: { ...DEFAULT_NOTIFY.email, ...(saved.email ?? {}) },
    ntfy: { ...DEFAULT_NOTIFY.ntfy, ...(saved.ntfy ?? {}) },
  };
  const parsed = NotifySettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_NOTIFY;
}

export function saveNotifySettings(next: NotifySettings) {
  const parsed = NotifySettingsSchema.parse(next);
  if (parsed.ntfy.server && !/^https:\/\/[^\s/]+/i.test(parsed.ntfy.server)) {
    throw new AppError(400, 'BAD_NTFY', 'The ntfy server must be an https:// address.');
  }
  if (parsed.email.to && !/^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i.test(parsed.email.to)) {
    throw new AppError(400, 'BAD_EMAIL', 'That digest address does not look valid.');
  }
  setSetting('notify', parsed);
}

// ── Secrets ──────────────────────────────────────────────────────────────────

export const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;
export const CHAT_RE = /^-?\d{1,20}$/;
export const NTFY_TOPIC_RE = /^[A-Za-z0-9_-]{6,64}$/;

export function setTelegramCredentials(token: string | undefined, chatId: string | undefined) {
  if (token !== undefined) {
    const t = token.trim();
    if (!TOKEN_RE.test(t)) throw new AppError(400, 'BAD_TOKEN', 'That does not look like a bot token from @BotFather (digits, a colon, then letters).');
    setSecret('telegram_bot_token', t);
  }
  if (chatId !== undefined) {
    const c = chatId.trim();
    if (!CHAT_RE.test(c)) throw new AppError(400, 'BAD_CHAT', 'The chat id is a number (it may start with a minus sign).');
    setSecret('telegram_chat_id', c, { hint: false });
  }
}

export function clearTelegram() {
  deleteSecret('telegram_bot_token');
  deleteSecret('telegram_chat_id');
}

export function telegramCredentials(): { token: string; chatId: string } | null {
  const token = getSecret('telegram_bot_token');
  const chatId = getSecret('telegram_chat_id');
  return token && chatId ? { token, chatId } : null;
}

export function telegramToken(): string | null {
  return getSecret('telegram_bot_token');
}

export function setNtfyTopic(topic: string | null) {
  if (topic === null || topic === '') return deleteSecret('ntfy_topic');
  if (!NTFY_TOPIC_RE.test(topic.trim())) throw new AppError(400, 'BAD_TOPIC', 'Use 6–64 letters, digits, - or _ for the ntfy topic (make it hard to guess).');
  setSecret('ntfy_topic', topic.trim(), { hint: false });
}

export function ntfyTopic(): string | null {
  return getSecret('ntfy_topic');
}

/** What the UI may see: switches and whether each secret is set, never the secrets. */
export function publicNotifyState() {
  const chat = getSecret('telegram_chat_id');
  return {
    settings: notifySettings(),
    telegram: {
      token: secretHint('telegram_bot_token'),
      chatIdSet: !!chat,
      /** The last 3 digits, so the owner can tell which chat is locked in. */
      chatIdHint: chat ? `…${chat.slice(-3)}` : null,
      configured: !!telegramCredentials(),
    },
    ntfy: { topicSet: !!ntfyTopic() },
  };
}
