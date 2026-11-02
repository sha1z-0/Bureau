import { all, get, now, run } from '../db.ts';
import '../campaign/schema.ts';
import { escapeHtml, sendTelegram } from './telegram.ts';

/**
 * Unknown form questions pushed to the owner on Telegram. Each gets a short id
 * (6 characters) they can type, and the message id is kept so a plain reply to
 * the message answers it.
 */

export interface OpenQuestion {
  id: string;
  questionRaw: string;
  jobId: string | null;
  fieldKind: string;
  options: string[];
  company: string | null;
  title: string | null;
}

export function shortIdFor(questionId: string): string {
  const existing = get<{ short_id: string }>('SELECT short_id FROM campaign_question_notices WHERE question_id = ?', questionId);
  if (existing) return existing.short_id;
  const base = questionId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  for (let len = 6; len <= base.length; len++) {
    const cand = base.slice(0, len);
    if (!get('SELECT 1 FROM campaign_question_notices WHERE short_id = ?', cand)) return cand;
  }
  return base;
}

/** Resolve a typed reference (short id, full id) to a question id. */
export function resolveQuestionRef(ref: string): string | null {
  const r = ref.trim().toLowerCase();
  if (!r) return null;
  const byShort = get<{ question_id: string }>('SELECT question_id FROM campaign_question_notices WHERE short_id = ?', r);
  if (byShort) return byShort.question_id;
  const direct = get<{ id: string }>('SELECT id FROM unknown_questions WHERE id = ?', ref.trim());
  if (direct) return direct.id;
  if (r.length >= 4) {
    const pref = all<{ id: string }>("SELECT id FROM unknown_questions WHERE status = 'open' AND lower(replace(id, '-', '')) LIKE ? LIMIT 2", `${r}%`);
    if (pref.length === 1) return pref[0].id;
  }
  return null;
}

export function questionForMessage(messageId: number): string | null {
  return get<{ question_id: string }>('SELECT question_id FROM campaign_question_notices WHERE message_id = ?', messageId)?.question_id ?? null;
}

/** Open questions that have not been sent to the owner yet. */
export function unsentQuestions(limit = 10): OpenQuestion[] {
  return all<{ id: string; question_raw: string; job_id: string | null; field_kind: string; options: string; company: string | null; title: string | null }>(
    `SELECT q.id, q.question_raw, q.job_id, q.field_kind, q.options, j.company, j.title
       FROM unknown_questions q LEFT JOIN jobs j ON j.id = q.job_id
      WHERE q.status = 'open' AND NOT EXISTS (SELECT 1 FROM campaign_question_notices n WHERE n.question_id = q.id)
      ORDER BY q.created_at ASC LIMIT ?`,
    limit,
  ).map((r) => ({
    id: r.id,
    questionRaw: r.question_raw,
    jobId: r.job_id,
    fieldKind: r.field_kind,
    options: safeArray(r.options),
    company: r.company,
    title: r.title,
  }));
}

const safeArray = (s: string): string[] => {
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export function renderQuestion(q: OpenQuestion, shortId: string): string {
  const where = q.company ? ` from ${escapeHtml(q.company)}${q.title ? ` (${escapeHtml(q.title)})` : ''}` : '';
  const lines = [`<b>Question ${shortId}</b>${where}`, escapeHtml(q.questionRaw.slice(0, 600))];
  if (q.options.length) lines.push(`Options: ${q.options.slice(0, 12).map(escapeHtml).join(' / ')}`);
  lines.push(`Reply to this message, or send /answer ${shortId} &lt;your answer&gt;.`);
  return lines.join('\n');
}

/** Record that a question went out (or was handled another way). */
export function markQuestionSent(questionId: string, shortId: string, messageId: number | null) {
  run(
    `INSERT INTO campaign_question_notices (question_id, short_id, message_id, sent_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(question_id) DO UPDATE SET message_id = excluded.message_id, sent_at = excluded.sent_at`,
    questionId,
    shortId,
    messageId,
    now(),
  );
}

/** Push every new open question to Telegram. Returns how many went out. */
export async function pushQuestions(limit = 5): Promise<number> {
  let sent = 0;
  for (const q of unsentQuestions(limit)) {
    const sid = shortIdFor(q.id);
    const messageId = await sendTelegram(renderQuestion(q, sid));
    markQuestionSent(q.id, sid, messageId);
    sent++;
  }
  return sent;
}
