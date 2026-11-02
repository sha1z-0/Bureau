import './schema.ts';
import { getSetting, logEvent, setSetting } from '../db.ts';
import { redact } from '../errors.ts';
import { addWaiter, takeCode, waitingCount } from './codes.ts';
import { inboxDeps } from './deps.ts';
import { runFollowUps } from './followup.ts';
import { ImapSource, imapError, mailSource } from './imap.ts';
import { unhandled } from './messages.ts';
import { act, processRaw } from './pipeline.ts';
import { imapPassword, inboxSettings, mailCursor, saveMailCursor, type InboxSettings } from './settings.ts';
import { recordSilence } from './stage.ts';

/** A09 — the job-search mailbox. */

const BATCH = 50;
const MAX_ROUNDS = 6;
const FOLLOWUP_EVERY_MS = 60 * 60_000;
const SILENCE_EVERY_MS = 24 * 60 * 60_000;

let inflight: Promise<number> | null = null;

/** Fetch, classify, link and act on new mail. Returns how many new messages were handled. Single-flight. */
export function pollInbox(): Promise<number> {
  inflight ??= doPoll().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doPoll(): Promise<number> {
  let handled = 0;
  let source = null;
  const stamp = () => new Date(inboxDeps().now()).toISOString();
  try {
    source = await mailSource();
  } catch (err) {
    logEvent('inbox', `Could not open the mailbox: ${imapError(err)}`);
    setSetting('inbox.lastError', { at: stamp(), message: imapError(err) });
  }
  if (source) {
    try {
      const s = inboxSettings();
      let cursor = mailCursor();
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const { uidValidity, messages } = await source.fetchNew(cursor, { sinceDays: s.sinceDays, limit: BATCH });
        // The folder was rebuilt (new UIDVALIDITY): start over; message ids keep this idempotent.
        if (cursor && cursor.uidValidity !== uidValidity) cursor = null;
        for (const m of messages) {
          try {
            if (await processRaw(m.source, { internalDate: m.internalDate })) handled++;
          } catch (err) {
            // One bad message must not block the mailbox: it is skipped and logged.
            logEvent('inbox', `Could not process a message (uid ${m.uid}): ${redact((err as Error).message).slice(0, 200)}`);
          }
          cursor = { uidValidity, lastUid: m.uid };
          saveMailCursor(cursor);
        }
        if (!cursor) saveMailCursor({ uidValidity, lastUid: 0 });
        if (messages.length < BATCH) break;
      }
      setSetting('inbox.lastPoll', { at: stamp(), handled });
      setSetting('inbox.lastError', null);
    } catch (err) {
      logEvent('inbox', `Mailbox poll failed: ${imapError(err)}`);
      setSetting('inbox.lastError', { at: stamp(), message: imapError(err) });
    } finally {
      await source.close().catch(() => {});
    }
  }
  // Effects that never finished (a crash mid-way) are re-run.
  for (const m of unhandled()) {
    try {
      await act(m, null);
    } catch (err) {
      logEvent('inbox', `Retrying a message's effects failed: ${redact((err as Error).message).slice(0, 160)}`);
    }
  }
  await housekeeping();
  return handled;
}

/** Follow-ups (hourly) and silence outcomes (daily) ride on the poll A08 already schedules. */
async function housekeeping() {
  const t = inboxDeps().now();
  const last = getSetting<{ followUps?: number; silence?: number }>('inbox.housekeeping', {});
  const next = { ...last };
  if (!last.followUps || t - last.followUps >= FOLLOWUP_EVERY_MS || t < last.followUps) {
    next.followUps = t;
    setSetting('inbox.housekeeping', next);
    try {
      await runFollowUps();
    } catch (err) {
      logEvent('inbox', `Follow-ups failed: ${redact((err as Error).message).slice(0, 160)}`);
    }
  }
  if (!last.silence || t - last.silence >= SILENCE_EVERY_MS || t < last.silence) {
    next.silence = t;
    setSetting('inbox.housekeeping', next);
    recordSilence(21, t);
  }
}

/**
 * Classify, link and act on one raw RFC 822 message: the same path pollInbox()
 * runs per fetched message. Idempotent by Message-ID. A verification code in it
 * resolves any matching waitForCode() waiter. Returns 1 if new, 0 if already seen.
 * Used by the e2e (fixture mail, the fixture server's Workday codes) and any
 * other mail bridge.
 */
export async function ingestRaw(raw: Buffer | string): Promise<number> {
  return (await processRaw(raw)) ? 1 : 0;
}

/** The mailbox settings without the password (which stays in the vault; `passwordSet` says whether one is stored). */
export function imapSettings(): InboxSettings & { passwordSet: boolean } {
  return { ...inboxSettings(), passwordSet: !!imapPassword() };
}

let codePollMs = Number(process.env.BUREAU_CODE_POLL_MS ?? 15_000);

/** Tests shorten the fast-poll interval used while a code is awaited. */
export function setCodePollInterval(ms: number | null) {
  codePollMs = ms ?? Number(process.env.BUREAU_CODE_POLL_MS ?? 15_000);
}

/**
 * Resolve with a verification code (or link) for `domain` when one arrives, or
 * null on timeout. While anyone is waiting the mailbox is watched closely: IMAP
 * IDLE when the server supports it, otherwise a poll every 15 s. The code is
 * handed out once and never logged.
 */
export async function waitForCode(domain: string, timeoutMs: number): Promise<string | null> {
  const since = inboxDeps().now();
  const ready = takeCode(domain, since);
  if (ready) return ready;
  const { promise, cancel } = addWaiter(domain, since);
  const timer = setTimeout(cancel, Math.max(0, timeoutMs));
  void promise.finally(() => clearTimeout(timer));
  // A new waiter means "look now": wake a watcher that is sleeping between polls.
  if (watching) kick?.();
  else void watch();
  return promise;
}

let watching = false;
/** Ends the watcher's current sleep early. */
let kick: (() => void) | null = null;

/** One watcher for all waiters; it stops when the last waiter resolves or times out. */
async function watch() {
  if (watching) return;
  watching = true;
  let idle: ImapSource | null = null;
  try {
    const s = inboxSettings();
    const pass = imapPassword();
    const canIdle = s.idle && s.enabled && !!pass && !process.env.BUREAU_INBOX_EML_DIR && process.env.BUREAU_REPLAY !== '1' && process.env.BUREAU_INBOX_OFFLINE !== '1';
    if (canIdle) idle = await ImapSource.open(s, pass!).catch(() => null);
    while (waitingCount() > 0) {
      await pollInbox().catch(() => 0);
      if (waitingCount() === 0) break;
      if (idle) {
        const woke = await idle.idleOnce(Math.min(Math.max(codePollMs, 5_000) * 2, 30_000)).catch(() => null);
        if (woke === null) {
          await idle.close().catch(() => {});
          idle = null;
        }
      } else {
        await new Promise<void>((r) => {
          const t = setTimeout(done, codePollMs);
          function done() {
            clearTimeout(t);
            kick = null;
            r();
          }
          kick = done;
        });
      }
    }
  } finally {
    if (idle) await idle.close().catch(() => {});
    watching = false;
  }
}

export { runFollowUps } from './followup.ts';
export { setInboxDeps } from './deps.ts';
export { setMailSourceFactory, EmlSource } from './imap.ts';
