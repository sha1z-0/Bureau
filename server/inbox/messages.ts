import './schema.ts';
import { ClassifiedMessageSchema, InboxClass, type ClassifiedMessage } from '../contracts/inbox.ts';
import { all, get, run } from '../db.ts';

/**
 * Stored inbox messages. `data` holds the ClassifiedMessage contract plus the
 * working the UI and the digest use. Verification codes and links are never
 * stored: `code` is always null in the database and links are dropped for
 * verification mail.
 */

export interface DraftReply {
  to: string;
  subject: string;
  body: string;
  answers: { question: string; answer: string; source: string; confidence: number }[];
  status: 'queued' | 'done' | 'dismissed';
}

export interface StoredMessage extends ClassifiedMessage {
  id: string;
  role: string | null;
  /** First part of the body for the UI (null for verification mail). */
  preview: string | null;
  suspicious: boolean;
  needsReview: boolean;
  via: 'rules' | 'ai' | 'fallback' | 'owner';
  reason: string;
  link: { score: number; reasons: string[]; ambiguous: boolean; lookalike: boolean };
  questions: string[];
  draft: DraftReply | null;
  unanswered: string[];
  interviewDate: string | null;
  planId: string | null;
  alerted: boolean;
  stage: { from: string; to: string } | null;
  handled: boolean;
}

interface Row {
  id: string;
  message_id: string;
  from_addr: string;
  subject: string;
  received_at: string;
  class: string;
  application_id: string | null;
  data: string;
  handled: number;
}

const DEFAULTS = {
  role: null,
  preview: null,
  suspicious: false,
  needsReview: false,
  via: 'rules' as const,
  reason: '',
  link: { score: 0, reasons: [], ambiguous: false, lookalike: false },
  questions: [],
  draft: null,
  unanswered: [],
  interviewDate: null,
  planId: null,
  alerted: false,
  stage: null,
};

export function toStored(r: Row): StoredMessage {
  let data: Partial<StoredMessage> = {};
  try {
    data = JSON.parse(r.data) as Partial<StoredMessage>;
  } catch {
    /* keep defaults */
  }
  const cls = InboxClass.safeParse(r.class);
  return {
    ...DEFAULTS,
    company: null,
    links: [],
    schedulingLinks: [],
    dates: [],
    summary: '',
    deadline: null,
    confidence: 0,
    ...data,
    id: r.id,
    messageId: r.message_id,
    from: r.from_addr,
    subject: r.subject,
    receivedAt: r.received_at,
    class: cls.success ? cls.data : 'other',
    applicationId: r.application_id,
    code: null,
    handled: !!r.handled,
  };
}

/** The contract view (what crosses module boundaries). */
export function contractView(m: StoredMessage): ClassifiedMessage {
  return ClassifiedMessageSchema.parse(m);
}

export function getMessage(id: string): StoredMessage | null {
  const r = get<Row>('SELECT * FROM inbox_messages WHERE id = ?', id);
  return r ? toStored(r) : null;
}

export function getByMessageId(messageId: string): StoredMessage | null {
  const r = get<Row>('SELECT * FROM inbox_messages WHERE message_id = ?', messageId);
  return r ? toStored(r) : null;
}

/** Persist the row (data minus the columns it duplicates). */
export function saveMessage(m: StoredMessage) {
  const { id, messageId, from, subject, receivedAt, class: cls, applicationId, handled, ...rest } = m;
  const data = JSON.stringify({ ...rest, code: null });
  run(
    `INSERT INTO inbox_messages (id, message_id, from_addr, subject, received_at, class, application_id, data, handled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET class = excluded.class, application_id = excluded.application_id, data = excluded.data, handled = excluded.handled`,
    id,
    messageId,
    from,
    subject,
    receivedAt,
    cls,
    applicationId,
    data,
    handled ? 1 : 0,
  );
}

export interface MessageFilter {
  class?: InboxClass[];
  applicationId?: string;
  unlinked?: boolean;
  review?: boolean;
  q?: string;
  since?: string;
  limit?: number;
  offset?: number;
}

export function listMessages(f: MessageFilter = {}): { items: StoredMessage[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.class?.length) {
    where.push(`class IN (${f.class.map(() => '?').join(',')})`);
    params.push(...f.class);
  }
  if (f.applicationId) {
    where.push('application_id = ?');
    params.push(f.applicationId);
  }
  if (f.unlinked) where.push("application_id IS NULL AND class NOT IN ('verification_code', 'other')");
  if (f.review) where.push("json_extract(data, '$.needsReview') = 1");
  if (f.since) {
    where.push('received_at >= ?');
    params.push(f.since);
  }
  if (f.q) {
    where.push("(subject LIKE ? ESCAPE '\\' OR from_addr LIKE ? ESCAPE '\\' OR json_extract(data, '$.company') LIKE ? ESCAPE '\\')");
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM inbox_messages ${w}`, ...params)?.n ?? 0;
  const items = all<Row>(`SELECT * FROM inbox_messages ${w} ORDER BY received_at DESC LIMIT ? OFFSET ?`, ...params, Math.min(f.limit ?? 50, 200), f.offset ?? 0).map(toStored);
  return { items, total };
}

export function classCounts(sinceIso?: string): Record<string, number> {
  const rows = sinceIso
    ? all<{ class: string; n: number }>('SELECT class, COUNT(*) AS n FROM inbox_messages WHERE received_at >= ? GROUP BY class', sinceIso)
    : all<{ class: string; n: number }>('SELECT class, COUNT(*) AS n FROM inbox_messages GROUP BY class');
  return Object.fromEntries(rows.map((r) => [r.class, r.n]));
}

export function unhandled(limit = 20): StoredMessage[] {
  return all<Row>('SELECT * FROM inbox_messages WHERE handled = 0 ORDER BY received_at ASC LIMIT ?', limit).map(toStored);
}
