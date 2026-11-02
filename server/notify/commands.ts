import { logEvent } from '../db.ts';
import { redact } from '../errors.ts';
import { emit } from '../services/bus.ts';
import { questionForMessage } from './questions.ts';
import { telegramCredentials } from './settings.ts';
import { escapeHtml, getUpdates, saveUpdateOffset, sendTelegram, updateOffset, type TgUpdate } from './telegram.ts';

/**
 * Telegram commands. Only messages from the configured chat id are acted on;
 * everything else is dropped without a reply (a reply would confirm the bot
 * is live to a stranger).
 */

export const COMMANDS = ['start', 'help', 'status', 'stop', 'pause', 'resume', 'today', 'answer', 'learning'] as const;
export type CommandName = (typeof COMMANDS)[number];

export interface ParsedCommand {
  cmd: CommandName | 'unknown';
  args: string;
  raw: string;
}

/** "/pause@BureauBot  Spring push" → { cmd: 'pause', args: 'Spring push' }. Null when it is not a command. */
export function parseCommand(text: string, botUsername?: string | null): ParsedCommand | null {
  const t = text.trim();
  const m = /^\/([A-Za-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(t);
  if (!m) return null;
  const [, name, at, rest] = m;
  if (at && botUsername && at.toLowerCase() !== botUsername.toLowerCase()) return null; // meant for another bot
  const lower = name.toLowerCase();
  const cmd = (COMMANDS as readonly string[]).includes(lower) ? (lower as CommandName) : 'unknown';
  return { cmd, args: (rest ?? '').trim(), raw: t };
}

/** "/answer q3f9a2 Two weeks" → { ref: 'q3f9a2', text: 'Two weeks' }. */
export function splitAnswer(args: string): { ref: string; text: string } | null {
  const m = /^(\S+)\s+([\s\S]+)$/.exec(args.trim());
  if (!m) return null;
  return { ref: m[1].replace(/^#/, ''), text: m[2].trim() };
}

export interface CommandHandlers {
  status(): Promise<string>;
  today(): Promise<string>;
  stop(): Promise<string>;
  pause(ref: string): Promise<string>;
  resume(ref: string): Promise<string>;
  /** `ref` is a question short id or full id. Returns the reply text. */
  answer(ref: string, text: string): Promise<string>;
  /** `/learning` lists the learning list; `/learning <skill>` starts learning it (A09). Optional for older callers. */
  learning?(args: string): Promise<string>;
}

export const HELP = [
  '<b>Bureau commands</b>',
  '/status: what is running',
  '/today: today so far',
  '/pause &lt;campaign&gt; and /resume &lt;campaign&gt;',
  '/answer &lt;id&gt; &lt;text&gt;: answer a question (or just reply to it)',
  '/learning [skill]: show the learning list, or start learning a skill',
  '/stop: kill switch, stops everything',
].join('\n');

export interface HandleResult {
  handled: boolean;
  reason?: 'other_chat' | 'no_text' | 'not_command' | 'no_config';
  reply?: string;
}

/** Act on one update. Sends the reply to the configured chat. */
export async function handleUpdate(update: TgUpdate, handlers: CommandHandlers, opts: { botUsername?: string | null } = {}): Promise<HandleResult> {
  const creds = telegramCredentials();
  if (!creds) return { handled: false, reason: 'no_config' };
  const msg = update.message;
  if (!msg) return { handled: false, reason: 'no_text' };
  if (String(msg.chat.id) !== creds.chatId) {
    logEvent('notify', `Ignored a Telegram message from an unknown chat (${String(msg.chat.id).slice(-3).padStart(6, '•')})`);
    return { handled: false, reason: 'other_chat' };
  }
  const text = (msg.text ?? '').trim();
  if (!text) return { handled: false, reason: 'no_text' };

  let reply: string;
  const parsed = parseCommand(text, opts.botUsername);
  try {
    if (!parsed) {
      // A plain reply to a question message answers that question.
      const qid = msg.reply_to_message ? questionForMessage(msg.reply_to_message.message_id) : null;
      if (!qid) return { handled: false, reason: 'not_command' };
      reply = await handlers.answer(qid, text);
    } else {
      switch (parsed.cmd) {
        case 'start':
        case 'help':
        case 'unknown':
          reply = HELP;
          break;
        case 'status':
          reply = await handlers.status();
          break;
        case 'today':
          reply = await handlers.today();
          break;
        case 'stop':
          reply = await handlers.stop();
          break;
        case 'pause':
          reply = await handlers.pause(parsed.args);
          break;
        case 'resume':
          reply = await handlers.resume(parsed.args);
          break;
        case 'learning': {
          const run = handlers.learning ?? (async (args: string) => (await import('../learning/index.ts')).learningCommand(args));
          // Plain text from the learning list; escape it for Telegram HTML.
          reply = escapeHtml(await run(parsed.args));
          break;
        }
        case 'answer': {
          const a = splitAnswer(parsed.args);
          reply = a ? await handlers.answer(a.ref, a.text) : 'Use /answer &lt;id&gt; &lt;your answer&gt;, or reply to the question message.';
          break;
        }
      }
    }
  } catch (err) {
    reply = `Could not do that: ${escapeHtml(redact((err as Error).message))}`;
  }
  emit({ type: 'activity', message: `Telegram: ${parsed ? `/${parsed.cmd}` : 'answer'} handled` });
  try {
    await sendTelegram(reply, { replyTo: msg.message_id });
  } catch {
    /* the action happened; a failed confirmation is not worth retrying */
  }
  return { handled: true, reply };
}

/**
 * Long-poll loop. Survives network errors with backoff, persists the update
 * offset so a restart never replays a /stop, and idles while no bot is set up.
 */
export function startTelegramPoller(handlers: CommandHandlers, opts: { signal: AbortSignal; botUsername?: () => string | null }): Promise<void> {
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref?.();
      opts.signal.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  return (async () => {
    let backoff = 2000;
    while (!opts.signal.aborted) {
      const creds = telegramCredentials();
      if (!creds) {
        await sleep(30_000);
        continue;
      }
      try {
        const updates = await getUpdates(creds.token, updateOffset(), 25, opts.signal);
        backoff = 2000;
        for (const u of updates ?? []) {
          // Move the offset first: a crash while handling /stop must not replay it forever.
          saveUpdateOffset(u.update_id + 1);
          await handleUpdate(u, handlers, { botUsername: opts.botUsername?.() ?? null }).catch(() => undefined);
        }
      } catch (err) {
        if (opts.signal.aborted) break;
        const code = (err as { code?: string }).code;
        if (code === 'OFFLINE') {
          await sleep(60_000);
          continue;
        }
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 5 * 60_000);
      }
    }
  })();
}
