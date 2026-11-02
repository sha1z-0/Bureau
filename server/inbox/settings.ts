import { z } from 'zod/v4';
import { getSetting, setSetting } from '../db.ts';
import { deleteSecret, getSecret, secretHint, setSecret } from '../security/vault.ts';

/**
 * Mailbox settings. The password lives in the vault (`imap_password`), never in
 * settings, never in a response. Everything else is plain settings JSON.
 */

export const IMAP_SECRET = 'imap_password';

const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export const InboxSettingsSchema = z.object({
  /** Poll at all. Off until the owner connects and tests a mailbox. */
  enabled: z.boolean(),
  host: z.string().trim().max(253).refine((h) => h === '' || HOST_RE.test(h), 'not a valid host name'),
  port: z.number().int().min(1).max(65535),
  /** Implicit TLS (993). When false the connection must upgrade with STARTTLS or it fails. */
  secure: z.boolean(),
  user: z.string().trim().max(254),
  mailbox: z.string().trim().min(1).max(200),
  /** How far back the very first poll looks. */
  sinceDays: z.number().int().min(1).max(90),
  /** Keep an IMAP IDLE connection open while a verification code is awaited. */
  idle: z.boolean(),
  followUps: z.object({
    enabled: z.boolean(),
    /** Used when the application has no campaign (the campaign's followUpDays wins otherwise). 0 = never. */
    defaultDays: z.number().int().min(0).max(60),
    perDay: z.number().int().min(0).max(20),
  }),
  /** Draft (never send) replies to simple recruiter questions from the answer bank. */
  draftReplies: z.boolean(),
});
export type InboxSettings = z.infer<typeof InboxSettingsSchema>;

export const DEFAULT_INBOX: InboxSettings = {
  enabled: false,
  host: '',
  port: 993,
  secure: true,
  user: '',
  mailbox: 'INBOX',
  sinceDays: 14,
  idle: true,
  followUps: { enabled: true, defaultDays: 7, perDay: 3 },
  draftReplies: true,
};

export function inboxSettings(): InboxSettings {
  const raw = getSetting<Partial<InboxSettings>>('inbox', {});
  const merged = { ...DEFAULT_INBOX, ...raw, followUps: { ...DEFAULT_INBOX.followUps, ...(raw.followUps ?? {}) } };
  const parsed = InboxSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_INBOX;
}

export const InboxSettingsPatch = InboxSettingsSchema.extend({
  followUps: InboxSettingsSchema.shape.followUps.partial(),
})
  .partial()
  .extend({ password: z.string().min(1).max(500).optional() });

export function saveInboxSettings(patch: z.infer<typeof InboxSettingsPatch>): InboxSettings {
  const cur = inboxSettings();
  const { password, ...rest } = patch;
  const next = InboxSettingsSchema.parse({ ...cur, ...rest, followUps: { ...cur.followUps, ...(rest.followUps ?? {}) } });
  if (password !== undefined) setSecret(IMAP_SECRET, password, { hint: false });
  // A changed account or folder means the old UID cursor is meaningless.
  if (next.host !== cur.host || next.user !== cur.user || next.mailbox !== cur.mailbox) setSetting('inbox.cursor', null);
  setSetting('inbox', next);
  return next;
}

export function forgetMailbox() {
  deleteSecret(IMAP_SECRET);
  setSetting('inbox.cursor', null);
  setSetting('inbox', { ...inboxSettings(), enabled: false });
}

export function imapPassword(): string | null {
  return getSecret(IMAP_SECRET);
}

/** What the UI may see: never the password. */
export function publicInboxSettings() {
  const s = inboxSettings();
  return { ...s, password: { set: secretHint(IMAP_SECRET).set } };
}

/** UID cursor for idempotent incremental polls. */
export interface MailCursor {
  uidValidity: string;
  lastUid: number;
}

export function mailCursor(): MailCursor | null {
  return getSetting<MailCursor | null>('inbox.cursor', null);
}

export function saveMailCursor(c: MailCursor | null) {
  setSetting('inbox.cursor', c);
}
