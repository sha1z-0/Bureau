import { z } from 'zod/v4';
import { get } from '../db.ts';
import { defaultWriterAi, type WriterAi } from './ai.ts';
import { jobBlock, loadContext } from './context.ts';
import { writerSystem } from './evidence.ts';
import { lintShort } from './lint.ts';
import { readNotes } from './packet.ts';
import { FOLLOWUP_SYSTEM } from './prompts.ts';
import { codeTruth, truthResult } from './truth.ts';

/**
 * Step 12 (follow-up), used by A09 after N days. The packet already carries a
 * follow-up that passed the short lint and the truth lock; for applications
 * without one (v1 drafts, or one that was dropped) it writes one now through
 * the same gates. Null when nothing passes, or the application doesn't exist.
 */

const FOLLOWUP_OPTS = { minChars: 250, maxChars: 900 };

export async function draftFollowUpWith(applicationId: string, ai: WriterAi = defaultWriterAi): Promise<{ subject: string; body: string } | null> {
  const row = get<{ id: string; job_id: string; subject: string; cover_letter: string; notes: string }>('SELECT id, job_id, subject, cover_letter, notes FROM applications WHERE id = ?', applicationId);
  if (!row) return null;
  const subject = row.subject.trim() ? (/^re:/i.test(row.subject.trim()) ? row.subject.trim() : `Re: ${row.subject.trim()}`) : '';
  const notes = readNotes(row.notes).writer;
  if (notes?.followUp && lintShort(notes.followUp, FOLLOWUP_OPTS).pass) {
    const job = get<{ title: string }>('SELECT title FROM jobs WHERE id = ?', row.job_id);
    return { subject: subject || `Following up: ${job?.title ?? 'my application'}`, body: notes.followUp };
  }
  const ctx = await loadContext(row.job_id, { brief: null });
  const out = await ai.ask({
    task: 'answer_q',
    label: 'follow_up',
    system: writerSystem(ctx, FOLLOWUP_SYSTEM),
    content: `${jobBlock(ctx)}\n\nThe letter that was sent:\n<sent_letter>\n${row.cover_letter}\n</sent_letter>\n\nWrite the follow-up.`,
    schema: z.object({ body: z.string() }),
    maxTokens: 1500,
  });
  const body = out.body.trim();
  if (!lintShort(body, FOLLOWUP_OPTS).pass) return null;
  if (!truthResult(codeTruth({ texts: [{ label: 'Follow-up', text: body }] }, ctx.source)).pass) return null;
  return { subject: subject || `Following up: ${ctx.job.title}`, body };
}
