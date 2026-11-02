import crypto from 'node:crypto';
import { z } from 'zod/v4';
import { AnswerScope, type AnswerEntry, type UnknownQuestion } from '../contracts/profile.ts';
import { canTransition, pipelineState, transition } from '../campaign/pipeline.ts';
import type { PipelineState } from '../contracts/campaign.ts';
import { all, get, logEvent, now, run } from '../db.ts';
import { AppError } from '../errors.ts';
import { emit } from '../services/bus.ts';
import { answerFor, upsertAnswer } from './answers.ts';
import { normalizeQuestion } from './questions.ts';
import { parseJson } from './text.ts';

/**
 * Questions nobody could answer truthfully. The form engine records them and
 * skips the job; the owner answers once (UI or Telegram); the answer goes to
 * the bank and every job that was waiting on that question goes back to
 * `selected`, so the campaign picks it up again.
 */

interface Row {
  id: string;
  question_raw: string;
  question_norm: string;
  job_id: string | null;
  field_kind: string;
  options: string;
  status: UnknownQuestion['status'];
  created_at: string;
}

const toQuestion = (r: Row): UnknownQuestion => ({
  id: r.id,
  questionRaw: r.question_raw,
  questionNorm: r.question_norm,
  jobId: r.job_id,
  fieldKind: r.field_kind,
  options: parseJson<string[]>(r.options, []),
  status: r.status,
  createdAt: r.created_at,
});

export function recordUnknown(q: { question: string; jobId: string | null; fieldKind: string; options?: string[] }): string {
  const question = q.question.trim().slice(0, 1000);
  if (!question) throw new AppError(400, 'INVALID', 'An unknown question needs its text');
  const norm = normalizeQuestion(question);
  const jobId = q.jobId ?? null;
  const existing = get<{ id: string }>(
    "SELECT id FROM unknown_questions WHERE question_norm = ? AND status = 'open' AND COALESCE(job_id, '') = COALESCE(?, '')",
    norm,
    jobId,
  );
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const options = (q.options ?? []).map((o) => String(o).slice(0, 300)).slice(0, 100);
  run(
    "INSERT INTO unknown_questions (id, question_raw, question_norm, job_id, field_kind, options, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
    id,
    question,
    norm,
    jobId,
    (q.fieldKind || 'text').slice(0, 40),
    JSON.stringify(options),
    now(),
  );
  logEvent('question', `New question for you: ${question.slice(0, 160)}`, jobId);
  emit({ type: 'activity', message: `A form asked something Bureau can't answer yet: "${question.slice(0, 120)}"`, level: 'info', ...(jobId ? { jobId } : {}) });
  return id;
}

export interface UnknownView extends UnknownQuestion {
  job: { title: string; company: string; url: string } | null;
  /** Other open questions with the same meaning (answered together). */
  duplicates: number;
}

export function listUnknown(status: UnknownQuestion['status'] | 'all' = 'open'): UnknownView[] {
  const rows = all<Row & { title: string | null; company: string | null; url: string | null }>(
    `SELECT q.*, j.title, j.company, j.url FROM unknown_questions q LEFT JOIN jobs j ON j.id = q.job_id
     ${status === 'all' ? '' : 'WHERE q.status = ?'} ORDER BY q.created_at DESC`,
    ...(status === 'all' ? [] : [status]),
  );
  const openByNorm = new Map<string, number>();
  for (const r of rows) if (r.status === 'open') openByNorm.set(r.question_norm, (openByNorm.get(r.question_norm) ?? 0) + 1);
  return rows.map((r) => ({
    ...toQuestion(r),
    job: r.title ? { title: r.title, company: r.company ?? '', url: r.url ?? '' } : null,
    duplicates: r.status === 'open' ? (openByNorm.get(r.question_norm) ?? 1) - 1 : 0,
  }));
}

export function getUnknown(id: string): UnknownQuestion | null {
  const r = get<Row>('SELECT * FROM unknown_questions WHERE id = ?', id);
  return r ? toQuestion(r) : null;
}

/** States a job waits in after an unknown question; only these are re-queued (never one that is mid-flight). */
const PARKED: PipelineState[] = ['skipped', 'needs_you', 'failed'];

/**
 * Put a job back to `selected` once nothing else is blocking it. Returns true
 * when it moved. A08 schedules it from there.
 */
export function requeueJob(jobId: string, reason = 'unknown question answered'): boolean {
  const st = pipelineState(jobId);
  if (!st || !PARKED.includes(st.state) || !canTransition(st.state, 'selected')) return false;
  const stillOpen = get("SELECT 1 FROM unknown_questions WHERE job_id = ? AND status = 'open' LIMIT 1", jobId);
  if (stillOpen) return false;
  transition(jobId, 'selected', { reason });
  return true;
}

export const AnswerUnknownInput = z.object({
  answer: z.string().trim().min(1).max(4000),
  scope: AnswerScope.optional(),
  /** Store the answer with the question exactly as asked (default) or under a cleaner wording the owner typed. */
  question: z.string().trim().min(2).max(1000).optional(),
});

export interface AnsweredUnknown {
  entry: AnswerEntry;
  answered: string[];
  requeued: string[];
}

/**
 * The owner answered: save to the bank, close this question and every open one
 * the new answer now resolves (same wording or, through the same matcher the
 * form engine uses, the same meaning), and re-queue their jobs.
 */
export async function answerUnknown(id: string, input: z.input<typeof AnswerUnknownInput>): Promise<AnsweredUnknown> {
  const v = AnswerUnknownInput.parse(input);
  const q = getUnknown(id);
  if (!q) throw new AppError(404, 'NOT_FOUND', 'No such question');
  const entry = upsertAnswer({ question: v.question ?? q.questionRaw, answer: v.answer, scope: v.scope }, 'owner');
  const siblings: Row[] = [get<Row>('SELECT * FROM unknown_questions WHERE id = ?', id)!];
  for (const other of all<Row>("SELECT * FROM unknown_questions WHERE status = 'open' AND id <> ?", id)) {
    if (other.question_norm === q.questionNorm) {
      siblings.push(other);
      continue;
    }
    const options = parseJson<string[]>(other.options, []);
    const a = await answerFor(other.question_raw, { jobId: other.job_id ?? undefined, options: options.length ? options : undefined });
    if (a?.key === entry.id) siblings.push(other);
  }
  const answeredAt = new Date().toISOString();
  for (const s of siblings) {
    run("UPDATE unknown_questions SET status = 'answered', answered_at = ?, answer_id = ? WHERE id = ?", answeredAt, entry.id, s.id);
  }
  const requeued: string[] = [];
  for (const s of siblings) {
    emit({ type: 'question.answered', questionId: s.id, jobId: s.job_id });
    if (s.job_id && !requeued.includes(s.job_id) && requeueJob(s.job_id)) requeued.push(s.job_id);
  }
  logEvent('question', `Answered: ${q.questionRaw.slice(0, 160)}${requeued.length ? ` (${requeued.length} job(s) re-queued)` : ''}`, q.jobId);
  return { entry, answered: siblings.map((s) => s.id), requeued };
}

export function ignoreUnknown(id: string) {
  const res = run("UPDATE unknown_questions SET status = 'ignored' WHERE id = ? AND status = 'open'", id);
  if (!res.changes && !getUnknown(id)) throw new AppError(404, 'NOT_FOUND', 'No such question');
}
