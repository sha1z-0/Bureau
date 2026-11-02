import fs from 'node:fs';
import path from 'node:path';
import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { AppError, redact } from '../errors.ts';
import { imapPassword, inboxSettings, type InboxSettings, type MailCursor } from './settings.ts';

/**
 * The mailbox, behind an injectable seam. Production reads a dedicated
 * job-search mailbox over IMAP (read-only: Bureau never moves, flags or
 * deletes mail). Tests and local development feed .eml files instead, so no
 * real mailbox is ever touched during development.
 */

export interface RawMessage {
  uid: number;
  source: Buffer;
  internalDate: Date | null;
}

export interface FetchResult {
  uidValidity: string;
  messages: RawMessage[];
}

export interface MailSource {
  /** Messages after the cursor (or from the last `sinceDays` without one), oldest first, at most `limit`. */
  fetchNew(cursor: MailCursor | null, opts: { sinceDays: number; limit: number }): Promise<FetchResult>;
  close(): Promise<void>;
}

/** Biggest message we read. Larger ones are truncated (attachments are never needed). */
const MAX_SOURCE = 3 * 1024 * 1024;

function clientOptions(s: Pick<InboxSettings, 'host' | 'port' | 'secure' | 'user'>, pass: string): ImapFlowOptions {
  return {
    host: s.host,
    port: s.port,
    secure: s.secure,
    // Without implicit TLS the password must still never cross in clear text.
    doSTARTTLS: s.secure ? undefined : true,
    auth: { user: s.user, pass },
    logger: false,
    disableAutoIdle: true,
    clientInfo: { name: 'Bureau' },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 90_000,
  };
}

/** imapflow errors can echo server responses; keep them short and credential-free. */
export function imapError(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
  if (e?.authenticationFailed) return 'The mail server rejected the username or app password.';
  if (e?.code === 'ENOTFOUND') return 'Could not find that mail server. Check the host name.';
  if (e?.code === 'ECONNREFUSED') return 'The mail server refused the connection. Check the port.';
  if (e?.code === 'ETIMEDOUT' || /timeout/i.test(e?.message ?? '')) return 'The mail server did not answer in time.';
  return redact(String(e?.responseText || e?.message || 'IMAP error')).slice(0, 200);
}

export class ImapSource implements MailSource {
  private constructor(
    private client: ImapFlow,
    private mailbox: string,
  ) {}

  static async open(s: InboxSettings, pass: string): Promise<ImapSource> {
    const client = new ImapFlow(clientOptions(s, pass));
    client.on('error', () => {
      /* surfaced by the awaiting call; never crash the process */
    });
    await client.connect();
    return new ImapSource(client, s.mailbox);
  }

  async fetchNew(cursor: MailCursor | null, opts: { sinceDays: number; limit: number }): Promise<FetchResult> {
    const lock = await this.client.getMailboxLock(this.mailbox, { readOnly: true });
    try {
      const mb = this.client.mailbox;
      const uidValidity = mb ? String(mb.uidValidity) : '0';
      let uids: number[];
      if (cursor && cursor.uidValidity === uidValidity) {
        uids = ((await this.client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > cursor.lastUid);
      } else {
        uids = (await this.client.search({ since: new Date(Date.now() - opts.sinceDays * 86_400_000) }, { uid: true })) || [];
      }
      uids = [...uids].sort((a, b) => a - b).slice(0, opts.limit);
      const messages: RawMessage[] = [];
      if (uids.length) {
        for await (const msg of this.client.fetch(uids.join(','), { uid: true, internalDate: true, source: { maxLength: MAX_SOURCE } }, { uid: true })) {
          if (!msg.source) continue;
          const d = msg.internalDate ? new Date(msg.internalDate) : null;
          messages.push({ uid: msg.uid, source: msg.source, internalDate: d && !Number.isNaN(d.getTime()) ? d : null });
        }
      }
      messages.sort((a, b) => a.uid - b.uid);
      return { uidValidity, messages };
    } finally {
      lock.release();
    }
  }

  /** Wait for new mail with IMAP IDLE (when the server supports it); resolves true on new mail, false after `ms`. */
  async idleOnce(ms: number): Promise<boolean> {
    const lock = await this.client.getMailboxLock(this.mailbox, { readOnly: true });
    try {
      return await new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (v: boolean) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this.client.off('exists', onExists);
          resolve(v);
          // Any command ends IDLE.
          void this.client.noop().catch(() => {});
        };
        const onExists = () => finish(true);
        const timer = setTimeout(() => finish(false), ms);
        this.client.on('exists', onExists);
        this.client.idle().catch(() => finish(false));
      });
    } finally {
      lock.release();
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
  }
}

/**
 * A fake mailbox made of .eml files: each file is one message, UIDs follow the
 * order given. Used by the selfcheck and for local development
 * (BUREAU_INBOX_EML_DIR=fixtures/mail). Messages can be appended while running.
 */
export class EmlSource implements MailSource {
  private items: { uid: number; source: Buffer }[] = [];
  closed = 0;

  constructor(
    sources: (string | Buffer)[] = [],
    public uidValidity = '1',
  ) {
    for (const s of sources) this.add(s);
  }

  /** Append a message (a file path, or raw RFC 822). */
  add(src: string | Buffer): number {
    const source = Buffer.isBuffer(src) ? src : /\n/.test(src) || !fs.existsSync(src) ? Buffer.from(src) : fs.readFileSync(src);
    const uid = (this.items.at(-1)?.uid ?? 0) + 1;
    this.items.push({ uid, source });
    return uid;
  }

  static fromDir(dir: string, filter: (name: string) => boolean = () => true): EmlSource {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.eml') && filter(f))
      .sort();
    return new EmlSource(files.map((f) => path.join(dir, f)));
  }

  async fetchNew(cursor: MailCursor | null, opts: { sinceDays: number; limit: number }): Promise<FetchResult> {
    const after = cursor && cursor.uidValidity === this.uidValidity ? cursor.lastUid : 0;
    return {
      uidValidity: this.uidValidity,
      messages: this.items
        .filter((m) => m.uid > after)
        .slice(0, opts.limit)
        .map((m) => ({ ...m, internalDate: null })),
    };
  }

  async close(): Promise<void> {
    this.closed++;
  }
}

export type MailSourceFactory = () => Promise<MailSource | null>;

/** The configured mailbox, or null when none is set up (or polling is switched off). */
export const imapFactory: MailSourceFactory = async () => {
  const devDir = process.env.BUREAU_INBOX_EML_DIR;
  if (devDir) return EmlSource.fromDir(path.resolve(devDir));
  const s = inboxSettings();
  const pass = imapPassword();
  if (!s.enabled || !s.host || !s.user || !pass) return null;
  if (process.env.BUREAU_REPLAY === '1' || process.env.BUREAU_INBOX_OFFLINE === '1') return null;
  return ImapSource.open(s, pass);
};

let factory: MailSourceFactory = imapFactory;

export function mailSource(): Promise<MailSource | null> {
  return factory();
}

/** Swap the mailbox (tests). Returns a restore function. */
export function setMailSourceFactory(f: MailSourceFactory | null): () => void {
  const prev = factory;
  factory = f ?? imapFactory;
  return () => {
    factory = prev;
  };
}

export interface ConnectionReport {
  ok: boolean;
  message: string;
  mailbox?: string;
  messages?: number;
  folders?: string[];
}

/** Log in, open the folder read-only, count messages, log out. Never returns or logs the password. */
export async function testConnection(s: InboxSettings, pass: string | null, opener: (s: InboxSettings, pass: string) => Promise<ImapFlow> = defaultOpener): Promise<ConnectionReport> {
  if (!s.host || !s.user) return { ok: false, message: 'Enter the IMAP host and username first.' };
  if (!pass) return { ok: false, message: 'Enter the mailbox app password first.' };
  if (process.env.BUREAU_REPLAY === '1' || process.env.BUREAU_INBOX_OFFLINE === '1') {
    if (opener === defaultOpener) throw new AppError(503, 'OFFLINE', 'IMAP is disabled in offline mode.');
  }
  let client: ImapFlow | null = null;
  try {
    client = await opener(s, pass);
    const folders = (await client.list()).map((f) => f.path).slice(0, 50);
    const status = await client.status(s.mailbox, { messages: true });
    if (!status) return { ok: false, message: `Connected, but the folder "${s.mailbox}" does not exist.`, folders };
    return { ok: true, message: `Connected to ${s.host} as ${s.user}. "${s.mailbox}" has ${status.messages ?? 0} messages.`, mailbox: s.mailbox, messages: status.messages ?? 0, folders };
  } catch (err) {
    return { ok: false, message: imapError(err) };
  } finally {
    if (client) await client.logout().catch(() => client?.close());
  }
}

async function defaultOpener(s: InboxSettings, pass: string): Promise<ImapFlow> {
  const client = new ImapFlow(clientOptions(s, pass));
  client.on('error', () => {});
  await client.connect();
  return client;
}
