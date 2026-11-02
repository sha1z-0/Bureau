import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { z } from 'zod/v4';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { TailoredCvSchema } from '../ai/tailor.ts';
import { DATA_DIR } from '../config.ts';
import { runFill } from '../forms/engine.ts';
import { fillField as fillWithHandler } from '../forms/handlers/index.ts';
import { labelNorm } from '../forms/normalize.ts';
import { PAGE_LIB, type RawField } from '../forms/page.ts';
import type { ApplicationRow } from './applications.ts';
import { cvFilename, renderCvPdf, renderLetterPdf } from './cvPdf.ts';

/**
 * v1 compatibility layer. The form engine is server/forms/** (A05): this file
 * keeps the old names working for v1 callers (services/hunt.ts "finish in
 * browser", routes/system.ts, scripts/checks/00-core.ts) on top of it.
 */

export { SHOT_DIR } from '../forms/artifacts.ts';
export { applyUrlFor } from '../forms/engine.ts';

interface JobLite {
  id: string;
  source: string;
  external_id: string | null;
  url: string;
  title: string;
  company: string;
  description_text: string | null;
}

export interface FormField {
  id: string;
  kind: 'text' | 'textarea' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'file' | 'phone' | 'location' | 'richtext' | 'consent';
  label: string;
  required: boolean;
  options?: string[];
}

export interface FormOutcome {
  status: 'submitted' | 'rehearsed' | 'needs_you' | 'failed';
  reason: string;
  shot: string | null;
  answers: { label: string; value: string }[];
}

/** v1 structured-output schema (kept: the v1 checks validate it). */
export const Answers = z.object({
  answers: z.array(z.object({ id: z.string(), value: z.string() })),
  blockers: z.array(z.object({ id: z.string(), reason: z.string() })),
});

/** In-page expression: every fillable control, tagged with data-bureau-id (the v2 extractor). */
export const EXTRACT_FIELDS = `(${PAGE_LIB})('extract', { prefix: 'f' }).fields`;
export const VISIBLE_CHALLENGE = `(${PAGE_LIB})('challenge', {}).found`;
export const CONFIRMED = `(${PAGE_LIB})('confirm', {}).confirmed`;

/** v1 fill: one field, buffers for the files. Delegates to the v2 widget handlers. */
export async function fillField(page: Page, field: FormField & { meta?: RawField['meta'] }, value: string, files: { cv: Buffer; cvName: string; letter: Buffer; letterName: string }) {
  if (field.kind === 'file' && (value === 'SKIP' || value === '')) return;
  const wantsLetter = field.kind === 'file' && (value === 'COVER_LETTER' || /cover/i.test(field.label));
  const v2 = { ...field, labelNorm: labelNorm(field.label), step: 0, signature: '', meta: field.meta ?? {} };
  await fillWithHandler(page, v2 as never, { value, key: field.kind === 'file' ? (wantsLetter ? 'letter' : 'cv') : '' } as never, {
    cv: { name: files.cvName, mimeType: 'application/pdf', buffer: files.cv },
    letter: { name: files.letterName, mimeType: 'application/pdf', buffer: files.letter },
  });
}

async function packetFor(app: ApplicationRow, job: JobLite): Promise<ApplicationPacket> {
  try {
    const w = await import('../writer/packet.ts');
    const p = w.loadPacket(app.id);
    if (p) return p;
  } catch {
    /* writer not available */
  }
  const cv = TailoredCvSchema.parse(JSON.parse(app.cv));
  const dir = path.join(DATA_DIR, 'forms', 'v1', app.id.replace(/[^\w-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cvPdfPath = path.join(dir, cvFilename(cv.name));
  const letterPdfPath = path.join(dir, cvFilename(cv.name).replace(/-CV\.pdf$/, '-Cover-Letter.pdf'));
  fs.writeFileSync(cvPdfPath, await renderCvPdf(cv));
  fs.writeFileSync(letterPdfPath, await renderLetterPdf(cv.name, app.cover_letter));
  return {
    applicationId: app.id,
    jobId: job.id,
    cvPdfPath,
    letterPdfPath,
    subject: app.subject,
    coverLetter: app.cover_letter,
    shortAnswers: {},
    outreach: '',
    followUp: '',
    quality: { critic: { score: 0, scores: { specificity: 0, evidence: 0, voice: 0, clarity: 0, ask: 0, aiTells: 0 }, demands: [] }, lint: { pass: true, checks: [] }, truth: { pass: true, issues: [] } },
  };
}

/** v1 entry point: fill (and with `submit`, send) the form for a job through the v2 engine. */
export async function applyViaForm(app: ApplicationRow, job: JobLite, opts: { submit: boolean; headful?: boolean; browser?: Browser }): Promise<FormOutcome> {
  const packet = await packetFor(app, job);
  const browser = opts.browser;
  const out = await runFill(packet, { submit: opts.submit, headful: opts.headful }, browser && !opts.headful ? { browser: async () => ({ browser, release: () => {} }) } : {});
  const status = out.status === 'skipped' ? 'needs_you' : out.status;
  return { status, reason: out.reason, shot: out.shotPath, answers: out.answers.map((a) => ({ label: a.label, value: a.value })) };
}
