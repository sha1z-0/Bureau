import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { TailoredCvSchema } from '../ai/tailor.ts';
import { all, get, logEvent, now, run } from '../db.ts';
import { AppError } from '../errors.ts';
import { cvPdfFor, highIssues, loadApplication, sendByEmail, type ApplicationRow } from '../services/applications.ts';
import { emit } from '../services/bus.ts';
import { canTransition, pipelineState, transition } from '../campaign/pipeline.ts';
import { body, json } from './util.ts';

function present(a: ApplicationRow & { title?: string; company?: string; url?: string; ai_score?: number | null; ai_grade?: string | null }) {
  const notes = json<{ emphasis?: string[]; issues?: unknown[] }>(a.notes, {});
  return {
    id: a.id,
    jobId: a.job_id,
    job: a.title ? { title: a.title, company: a.company, url: a.url, score: a.ai_score, grade: a.ai_grade } : undefined,
    subject: a.subject,
    coverLetter: a.cover_letter,
    message: a.message,
    cv: json(a.cv, {}),
    emphasis: notes.emphasis ?? [],
    issues: notes.issues ?? [],
    keywords: json<string[]>(a.keywords, []),
    status: a.status,
    channel: a.channel,
    toEmail: a.to_email,
    sentAt: a.sent_at,
    error: a.error,
    reason: a.reason,
    auto: !!a.auto,
    hasShot: !!a.shot,
    answers: json<{ label: string; value: string }[]>(a.answers, []),
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

const JOINED = `SELECT a.*, j.title, j.company, j.url, j.ai_score, j.ai_grade FROM applications a JOIN jobs j ON j.id = a.job_id`;

export async function applicationRoutes(app: FastifyInstance) {
  app.get('/api/applications', async (req) => {
    const { status } = body(z.object({ status: z.enum(['draft', 'approved', 'sent', 'needs_you', 'rehearsed', 'failed', 'skipped']).optional() }), req.query);
    const rows = status
      ? all<ApplicationRow>(`${JOINED} WHERE a.status = ? ORDER BY a.updated_at DESC`, status)
      : all<ApplicationRow>(`${JOINED} ORDER BY a.updated_at DESC LIMIT 300`);
    return { applications: rows.map(present) };
  });

  app.get('/api/applications/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = get<ApplicationRow>(`${JOINED} WHERE a.id = ?`, id);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found');
    return present(row);
  });

  const Update = z.object({
    subject: z.string().max(300).optional(),
    coverLetter: z.string().max(20_000).optional(),
    message: z.string().max(5_000).optional(),
    cv: TailoredCvSchema.optional(),
    toEmail: z.union([z.email().max(254), z.literal('')]).optional(),
    channel: z.enum(['email', 'ats', 'dm', 'manual']).optional(),
  });

  app.put('/api/applications/:id', async (req) => {
    const { id } = req.params as { id: string };
    const patch = body(Update, req.body);
    const current = loadApplication(id);
    if (current.status === 'sent') throw new AppError(409, 'SENT', 'This application was already sent.');
    run(
      `UPDATE applications SET subject = ?, cover_letter = ?, message = ?, cv = ?, to_email = ?, channel = ?,
         status = 'draft', updated_at = ? WHERE id = ?`,
      patch.subject ?? current.subject,
      patch.coverLetter ?? current.cover_letter,
      patch.message ?? current.message,
      patch.cv ? JSON.stringify(patch.cv) : current.cv,
      patch.toEmail === undefined ? current.to_email : patch.toEmail || null,
      patch.channel ?? current.channel,
      now(),
      id,
    );
    return present(get<ApplicationRow>(`${JOINED} WHERE a.id = ?`, id)!);
  });

  app.post('/api/applications/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    const { acknowledgeIssues } = body(z.object({ acknowledgeIssues: z.boolean().default(false) }), req.body);
    const current = loadApplication(id);
    if (current.status === 'sent') throw new AppError(409, 'SENT', 'Already sent.');
    if (highIssues(current) > 0 && !acknowledgeIssues) {
      throw new AppError(409, 'FACT_LOCK', 'The fact lock flagged claims your CV does not support. Fix them, or confirm you have checked them.');
    }
    run("UPDATE applications SET status = 'approved', updated_at = ? WHERE id = ?", now(), id);
    emit({ type: 'application', id, status: 'approved' });
    return { ok: true };
  });

  app.post('/api/applications/:id/send', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = req.params as { id: string };
    await sendByEmail(id, 'user');
    return { ok: true };
  });

  /** For ATS forms and DMs: the human submits on the employer's site, then marks it here. */
  app.post('/api/applications/:id/mark-applied', async (req) => {
    const { id } = req.params as { id: string };
    const a = loadApplication(id);
    run("UPDATE applications SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?", now(), now(), id);
    run("UPDATE jobs SET stage = 'applied', updated_at = ? WHERE id = ?", now(), a.job_id);
    // A campaign job the owner finished by hand (a CAPTCHA, an emailed code) leaves "needs you" for good.
    const st = pipelineState(a.job_id);
    if (st && st.state !== 'submitted' && canTransition(st.state, 'submitted')) transition(a.job_id, 'submitted', { reason: 'Finished and sent by you' });
    const job = get<{ title: string; company: string }>('SELECT title, company FROM jobs WHERE id = ?', a.job_id);
    logEvent('applied', `Applied to ${job?.title} at ${job?.company} (${a.channel})`, a.job_id);
    emit({ type: 'jobs-changed' });
    return { ok: true };
  });

  app.delete('/api/applications/:id', async (req) => {
    const { id } = req.params as { id: string };
    const a = loadApplication(id);
    run('DELETE FROM applications WHERE id = ?', id);
    run("UPDATE jobs SET stage = 'found' WHERE id = ? AND stage = 'drafted'", a.job_id);
    emit({ type: 'jobs-changed' });
    return { ok: true };
  });

  app.get('/api/applications/:id/cv.pdf', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { filename, content } = await cvPdfFor(loadApplication(id));
    const { download } = req.query as { download?: string };
    reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`)
      .header('cache-control', 'no-store');
    return reply.send(content);
  });
}
