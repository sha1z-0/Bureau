import { fetch as undiciFetch } from 'undici';
import { getSetting, setSetting } from '../db.ts';
import { AppError, redact } from '../errors.ts';
import { telegramCredentials } from './settings.ts';

/**
 * A minimal Telegram Bot API client: sendMessage and long-polled getUpdates
 * against api.telegram.org (a fixed public host, so no SSRF surface). The HTTP
 * layer is swappable so tests never reach the real API, and it refuses to touch
 * the network at all in offline/replay mode.
 */

export interface TgResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export type TelegramHttp = (token: string, method: string, body: Record<string, unknown>, opts: { timeoutMs: number; signal?: AbortSignal }) => Promise<TgResponse>;

export const offline = () => process.env.BUREAU_REPLAY === '1' || process.env.BUREAU_NOTIFY_OFFLINE === '1';

const realHttp: TelegramHttp = async (token, method, body, { timeoutMs, signal }) => {
  if (offline()) throw new AppError(503, 'OFFLINE', 'Telegram is disabled in offline mode.');
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const res = await undiciFetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as TgResponse;
    } catch {
      return { ok: false, error_code: res.status, description: `HTTP ${res.status}` };
    }
  } catch (err) {
    // Never echo the URL: it carries the token.
    if ((err as Error).name === 'AbortError' && signal?.aborted) throw err;
    throw new AppError(502, 'TELEGRAM_UNREACHABLE', (err as Error).name === 'TimeoutError' ? 'Telegram took too long to answer' : 'Could not reach Telegram');
  }
};

let http: TelegramHttp = realHttp;

/** Tests only: route every Telegram call through a fake. Returns a restore function. */
export function setTelegramHttp(fake: TelegramHttp | null): () => void {
  const prev = http;
  http = fake ?? realHttp;
  return () => {
    http = prev;
  };
}

export async function callTelegram<T>(token: string, method: string, body: Record<string, unknown>, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const res = await http(token, method, body, { timeoutMs: opts.timeoutMs ?? 15_000, signal: opts.signal });
  if (!res.ok) {
    const desc = redact(res.description ?? 'unknown error').replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[redacted]');
    throw new AppError(res.error_code === 401 ? 401 : 502, 'TELEGRAM', `Telegram said: ${desc}`);
  }
  return res.result as T;
}

// ── Messages ─────────────────────────────────────────────────────────────────

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Split on line boundaries into chunks Telegram accepts (4096 chars max). */
export function chunk(text: string, max = 3800): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    const piece = line.length > max ? line.slice(0, max - 1) + '…' : line;
    if ((cur ? cur.length + 1 : 0) + piece.length > max) {
      out.push(cur);
      cur = piece;
    } else cur = cur ? `${cur}\n${piece}` : piece;
  }
  if (cur) out.push(cur);
  return out;
}

export interface SentMessage {
  message_id: number;
}

/** Send HTML text to the configured chat. Returns the id of the last message sent. */
export async function sendTelegram(html: string, opts: { replyTo?: number; token?: string; chatId?: string } = {}): Promise<number> {
  const creds = opts.token && opts.chatId ? { token: opts.token, chatId: opts.chatId } : telegramCredentials();
  if (!creds) throw new AppError(412, 'NO_TELEGRAM', 'Add a Telegram bot token and chat id in Settings first.');
  let last = 0;
  for (const part of chunk(html)) {
    const msg = await callTelegram<SentMessage>(creds.token, 'sendMessage', {
      chat_id: creds.chatId,
      text: part,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
    });
    last = msg?.message_id ?? last;
  }
  return last;
}

// ── Updates ──────────────────────────────────────────────────────────────────

export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: { id: number; type: string; title?: string; username?: string; first_name?: string };
    from?: { id: number; is_bot: boolean; username?: string; first_name?: string };
    reply_to_message?: { message_id: number; text?: string };
  };
}

export function updateOffset(): number {
  return getSetting<number>('telegram.offset', 0);
}

export function saveUpdateOffset(n: number) {
  setSetting('telegram.offset', n);
}

export async function getUpdates(token: string, offset: number, timeoutSec: number, signal?: AbortSignal): Promise<TgUpdate[]> {
  return callTelegram<TgUpdate[]>(token, 'getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message'] }, { timeoutMs: (timeoutSec + 10) * 1000, signal });
}

/** Chats that recently messaged the bot, so the owner can pick theirs in Settings. Does not consume updates. */
export async function recentChats(token: string): Promise<{ id: string; title: string; type: string }[]> {
  const updates = await callTelegram<TgUpdate[]>(token, 'getUpdates', { offset: -20, timeout: 0, allowed_updates: ['message'] });
  const seen = new Map<string, { id: string; title: string; type: string }>();
  for (const u of updates ?? []) {
    const c = u.message?.chat;
    if (!c) continue;
    seen.set(String(c.id), { id: String(c.id), title: c.title ?? c.username ?? c.first_name ?? String(c.id), type: c.type });
  }
  return [...seen.values()];
}

export async function botIdentity(token: string): Promise<{ username: string; id: number }> {
  const me = await callTelegram<{ id: number; username: string }>(token, 'getMe', {});
  return { username: me.username, id: me.id };
}
