import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { AppError } from '../errors.ts';
import { fingerprintOf, loadMasterProfile } from '../profile/index.ts';
import { AI_LIMIT, body } from '../routes/util.ts';
import { answerQuestionTraced } from './answers.ts';
import { banditStats, EXPLORE_RATE, LENGTH_ARMS } from './bandit.ts';
import { chooseVariant } from './choose.ts';
import { CRITIC_BAR } from './critic.ts';
import { draftFollowUpWith } from './followup.ts';
import { HUMANIZER_RULES } from './humanizer.ts';
import { lintLetter, lintShort } from './lint.ts';
import { loadVariants, packetForJob, PACKETS_DIR } from './packet.ts';
import { writeApplicationRun } from './pipeline.ts';
import { applicationQuality, qualityTotals, recentRuns } from './quality.ts';

/**
 * UI-facing writer routes, all under /api/writer/*:
 *   GET  /api/writer/applications                 recent runs (written and skipped) with critic, lint and truth results, plus totals
 *   GET  /api/writer/applications/:id             one application's quality detail: gates, variants, evidence map, steps, issues
 *   GET  /api/writer/applications/:id/variants    the three letter variants with critic, lint, passages used and style tags
 *   POST /api/writer/applications/:id/choose      switch to another variant ({variantId}); the gates re-run (spends one audit call)
 *   POST /api/writer/applications/:id/follow-up   the follow-up email draft (stored one, or written now)
 *   GET  /api/writer/applications/:id/cv.pdf      the rendered CV PDF
 *   GET  /api/writer/applications/:id/letter.pdf  the rendered cover-letter PDF
 *   GET  /api/writer/jobs/:jobId/packet           the newest written packet for a job (404 if none)
 *   POST /api/writer/jobs/:jobId/regenerate       write (or rewrite) the application now ({campaignId?, instructions?}); spends AI budget
 *   POST /api/writer/jobs/:jobId/answer           answer a form question ({question, maxChars?, options?})
 *   GET  /api/writer/bandit                       Thompson-sampling arm stats by strategy and length, from outcomes
 *   POST /api/writer/lint                         lint any text against the voice fingerprint ({text, kind?, company?, role?})
 *   GET  /api/writer/meta                         gate thresholds, length bands and the humanizer rule set (for the UI)
 */

const Id = z.string().min(1).max(64);

function pdfPath(id: string, which: 'cv' | 'letter'): string {
  const q = applicationQuality(id);
  if (!q) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  const p = which === 'cv' ? q.writer.cvPdfPath : q.writer.letterPdfPath;
  // Only files the writer rendered into its own folder are served.
  if (!p || !path.resolve(p).startsWith(path.resolve(PACKETS_DIR) + path.sep) || !fs.existsSync(p)) throw new AppError(404, 'NO_PDF', 'This application has no rendered PDF.');
  return p;
}

export async function writerRoutes(app: FastifyInstance) {
  app.get('/api/writer/applications', async (req) => {
    const q = body(z.object({ limit: z.coerce.number().int().min(1).max(200).default(20), status: z.enum(['written', 'skipped']).optional(), campaignId: Id.optional() }), req.query);
    const runs = recentRuns(q.limit, { status: q.status, campaignId: q.campaignId });
    return { runs, totals: qualityTotals(runs) };
  });

  app.get('/api/writer/applications/:id', async (req) => {
    const { id } = body(z.object({ id: Id }), req.params);
    const q = applicationQuality(id);
    if (!q) throw new AppError(404, 'NOT_FOUND', 'No writer run for this application');
    return q;
  });

  app.get('/api/writer/applications/:id/variants', async (req) => {
    const { id } = body(z.object({ id: Id }), req.params);
    if (!applicationQuality(id)) throw new AppError(404, 'NOT_FOUND', 'No writer run for this application');
    return { variants: loadVariants(id) };
  });

  app.post('/api/writer/applications/:id/choose', AI_LIMIT, async (req) => {
    const { id } = body(z.object({ id: Id }), req.params);
    const { variantId } = body(z.object({ variantId: Id }), req.body);
    return chooseVariant(id, variantId);
  });

  app.post('/api/writer/applications/:id/follow-up', AI_LIMIT, async (req) => {
    const { id } = body(z.object({ id: Id }), req.params);
    const draft = await draftFollowUpWith(id);
    if (!draft) throw new AppError(404, 'NO_FOLLOW_UP', 'No follow-up passes the gates for this application.');
    return draft;
  });

  for (const which of ['cv', 'letter'] as const) {
    app.get(`/api/writer/applications/:id/${which}.pdf`, async (req, reply) => {
      const { id } = body(z.object({ id: Id }), req.params);
      const p = pdfPath(id, which);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `inline; filename="${path.basename(p).replace(/"/g, '')}"`);
      return reply.send(fs.readFileSync(p));
    });
  }

  app.get('/api/writer/jobs/:jobId/packet', async (req) => {
    const { jobId } = body(z.object({ jobId: Id }), req.params);
    const packet = packetForJob(jobId);
    if (!packet) throw new AppError(404, 'NO_PACKET', 'No written application for this job yet.');
    return { packet };
  });

  app.post('/api/writer/jobs/:jobId/regenerate', AI_LIMIT, async (req) => {
    const { jobId } = body(z.object({ jobId: Id }), req.params);
    const b = body(z.object({ campaignId: Id.optional(), instructions: z.string().max(2000).optional() }), req.body);
    const { result, applicationId } = await writeApplicationRun(jobId, b.campaignId ?? null, { manual: true, instructions: b.instructions });
    return { applicationId, ...('skipped' in result ? { skipped: result.skipped } : { packet: result }) };
  });

  app.post('/api/writer/jobs/:jobId/answer', AI_LIMIT, async (req) => {
    const { jobId } = body(z.object({ jobId: Id }), req.params);
    const b = body(z.object({ question: z.string().min(1).max(1000), maxChars: z.number().int().min(80).max(5000).optional(), options: z.array(z.string().max(300)).max(100).optional() }), req.body);
    const t = await answerQuestionTraced(jobId, b.question, { maxChars: b.maxChars, options: b.options });
    return { answer: t.answered, lint: t.lint, truth: t.truth, attempts: t.attempts };
  });

  app.get('/api/writer/bandit', async () => banditStats());

  app.post('/api/writer/lint', async (req) => {
    const b = body(
      z.object({ text: z.string().min(1).max(20_000), kind: z.enum(['letter', 'short']).default('letter'), company: z.string().max(200).default(''), role: z.string().max(200).default(''), maxChars: z.number().int().min(1).max(20_000).optional() }),
      req.body,
    );
    if (b.kind === 'short') return { lint: lintShort(b.text, { maxChars: b.maxChars, company: b.company || undefined, role: b.role || undefined }) };
    const m = loadMasterProfile();
    if (!m?.voiceBank.length) throw new AppError(412, 'NO_VOICE', 'Write at least one voice-bank passage first: the lint measures letters against your own writing.');
    const fp = m.style ?? fingerprintOf(m.voiceBank.map((v) => v.text));
    return { lint: lintLetter(b.text, { fingerprint: fp, voice: m.voiceBank.map((v) => ({ id: v.id, text: v.text })), company: b.company, role: b.role }), fingerprint: fp };
  });

  app.get('/api/writer/meta', async () => ({
    criticBar: CRITIC_BAR,
    exploreRate: EXPLORE_RATE,
    lengthArms: LENGTH_ARMS,
    rules: HUMANIZER_RULES.map((r) => ({ id: r.id, category: r.category, description: r.description, fix: r.fix })),
    attribution: 'Rule taxonomy paraphrased from Wikipedia: "Signs of AI writing" (CC BY-SA 4.0).',
  }));
}
