import { TailoredCvSchema } from '../ai/tailor.ts';
import { get, logEvent, now, run } from '../db.ts';
import { AppError, redact } from '../errors.ts';
import { emit } from './bus.ts';
import { cvFilename, renderCvPdf } from './cvPdf.ts';
import { sendApplicationEmail } from './mailer.ts';
import { loadProfile } from './profileStore.ts';

export interface ApplicationRow {
  id: string;
  job_id: string;
  subject: string;
  cover_letter: string;
  message: string;
  cv: string;
  notes: string;
  keywords: string;
  status: string;
  channel: string;
  to_email: string | null;
  sent_at: string | null;
  error: string | null;
  reason: string | null;
  auto: number;
  shot: string | null;
  answers: string;
  created_at: string;
  updated_at: string;
}

export function loadApplication(id: string): ApplicationRow {
  const row = get<ApplicationRow>('SELECT * FROM applications WHERE id = ?', id);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  return row;
}

export async function cvPdfFor(app: ApplicationRow) {
  const cv = TailoredCvSchema.parse(JSON.parse(app.cv));
  const paper = loadProfile()?.location.match(/\b(US|USA|United States|Canada)\b/i) ? 'LETTER' : 'A4';
  return { filename: cvFilename(cv.name), content: await renderCvPdf(cv, paper) };
}

export function highIssues(app: ApplicationRow): number {
  const notes = JSON.parse(app.notes) as { issues?: { severity: string }[] };
  return (notes.issues ?? []).filter((i) => i.severity === 'high').length;
}

/** Sending is only ever reached from an explicit approval — by the user, or by autopilot rules they switched on. */
export async function sendByEmail(id: string, via: 'user' | 'autopilot') {
  const app = loadApplication(id);
  if (app.status !== 'approved') throw new AppError(409, 'NOT_APPROVED', 'Approve the application before sending it.');
  if (!app.to_email) throw new AppError(400, 'NO_RECIPIENT', 'This application has no recipient email.');
  const job = get<{ title: string; company: string }>('SELECT title, company FROM jobs WHERE id = ?', app.job_id);
  try {
    const attachment = await cvPdfFor(app);
    await sendApplicationEmail({ to: app.to_email, subject: app.subject, text: app.cover_letter, attachment });
    run("UPDATE applications SET status = 'sent', sent_at = ?, error = NULL, updated_at = ? WHERE id = ?", now(), now(), id);
    run("UPDATE jobs SET stage = 'applied', updated_at = ? WHERE id = ?", now(), app.job_id);
    logEvent('sent', `${via === 'autopilot' ? 'Autopilot sent' : 'Sent'} application to ${app.to_email} for ${job?.title} at ${job?.company}`, app.job_id);
    emit({ type: 'application', id, status: 'sent' });
  } catch (err) {
    const message = redact((err as Error).message);
    run("UPDATE applications SET error = ?, updated_at = ? WHERE id = ?", message, now(), id);
    throw err instanceof AppError ? err : new AppError(502, 'SEND_FAILED', `Email failed: ${message}`);
  }
}
