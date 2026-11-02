import crypto from 'node:crypto';
import { get, now, run, tx } from '../db.ts';
import { AppError } from '../errors.ts';
import { emit } from '../services/bus.ts';
import { resolveQuestionRef } from '../notify/questions.ts';
import { isNotImplemented } from './deps.ts';

/**
 * The owner answered an unknown form question (Telegram /answer or a reply).
 *
 * A03 owns the answer bank. When it exports `answerUnknown(questionId, answer)`
 * (requested in docs/build/requests/A08.md) that is used. Until then a local
 * adapter does the same minimal thing: store the answer as an owner answer,
 * mark the question answered and emit `question.answered`, which re-queues the
 * job.
 */

type AnswerFn = (questionId: string, answer: string) => unknown;

let override: AnswerFn | null = null;

/** Tests only. */
export function setAnswerHandler(fn: AnswerFn | null) {
  override = fn;
}

export async function answerQuestion(ref: string, text: string): Promise<{ questionId: string; jobId: string | null; question: string }> {
  const answer = text.trim().slice(0, 2000);
  if (!answer) throw new AppError(400, 'EMPTY', 'The answer is empty.');
  const id = resolveQuestionRef(ref);
  if (!id) throw new AppError(404, 'NO_QUESTION', `No open question "${ref}".`);
  const q = get<{ id: string; question_raw: string; question_norm: string; job_id: string | null; status: string }>('SELECT * FROM unknown_questions WHERE id = ?', id);
  if (!q) throw new AppError(404, 'NO_QUESTION', `No question "${ref}".`);
  if (q.status !== 'open') throw new AppError(409, 'ANSWERED', 'That question is already answered.');

  if (override) {
    await override(id, answer);
    return { questionId: id, jobId: q.job_id, question: q.question_raw };
  }
  const mod = (await import('../profile/index.ts')) as Record<string, unknown>;
  const fn = mod.answerUnknown;
  if (typeof fn === 'function') {
    try {
      await (fn as AnswerFn)(id, answer);
      return { questionId: id, jobId: q.job_id, question: q.question_raw };
    } catch (err) {
      if (!isNotImplemented(err)) throw err;
    }
  }
  localAnswer(q, answer);
  return { questionId: id, jobId: q.job_id, question: q.question_raw };
}

function localAnswer(q: { id: string; question_raw: string; question_norm: string; job_id: string | null }, answer: string) {
  const ts = now();
  tx(() => {
    const existing = get<{ id: string }>("SELECT id FROM answer_bank WHERE question_norm = ? AND source = 'owner'", q.question_norm);
    if (existing) run('UPDATE answer_bank SET answer = ?, updated_at = ? WHERE id = ?', answer, ts, existing.id);
    else {
      run(
        "INSERT INTO answer_bank (id, question_norm, question_raw, answer, scope, source, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', 'owner', ?, ?)",
        crypto.randomUUID(),
        q.question_norm,
        q.question_raw,
        answer,
        ts,
        ts,
      );
    }
    run("UPDATE unknown_questions SET status = 'answered' WHERE id = ?", q.id);
  });
  emit({ type: 'question.answered', questionId: q.id, jobId: q.job_id });
}
