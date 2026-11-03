import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { FactKind } from '../contracts/profile.ts';
import { AppError } from '../errors.ts';
import { AI_LIMIT, body } from '../routes/util.ts';
import { deleteSecret, secretHint, setSecret } from '../security/vault.ts';
import { loadProfile } from '../services/profileStore.ts';
import { defaultAi } from './ai.ts';
import { AnswerInput, AnswerPatch, answerFor, deleteAnswer, listAnswers, updateAnswer, upsertAnswer } from './answers.ts';
import { addManualFact, deleteFact, FactPatch, listFacts, ManualFactInput, updateFact } from './facts.ts';
import { GITHUB_TOKEN_SECRET, storedGithub } from './github.ts';
import { addLearning, deleteLearning, LearningInput, LearningPatch, listLearning, updateLearning } from './learning.ts';
import { importLinkedInExport, importLinkedInText } from './linkedin.ts';
import { getLinks, LinksInput, setLinks, storedLinks } from './links.ts';
import { loadMasterProfile } from './master.ts';
import { detectIntent, normalizeQuestion } from './questions.ts';
import { lastSync, SYNC_PARTS, syncProfile, syncRunning } from './sync.ts';
import { AnswerUnknownInput, answerUnknown, ignoreUnknown, listUnknown } from './unknown.ts';
import { addVoice, deleteVoice, listVoice, storedStyle, SUGGESTED_PROMPTS, updateVoice, VOICE_GUIDANCE, VoiceInput } from './voice.ts';
import { refilterAfterProfileChange } from '../campaign/refilter.ts';

/**
 * UI-facing routes for the master profile (A10 builds the screens on these).
 * Everything lives under /api/master so it never collides with the v1
 * /api/profile routes in server/routes/profile.ts.
 */

const MAX_EXPORT = 25 * 1024 * 1024;
const id = (req: { params: unknown }) => (req.params as { id: string }).id;

export async function masterProfileRoutes(app: FastifyInstance) {
  // ── The whole profile and its sync ─────────────────────────────────────────
  app.get('/api/master', async () => ({
    profile: loadMasterProfile(),
    sync: { last: lastSync(), running: syncRunning() },
    githubToken: secretHint(GITHUB_TOKEN_SECRET),
  }));

  app.get('/api/master/sync', async () => ({ last: lastSync(), running: syncRunning(), parts: SYNC_PARTS }));

  app.post('/api/master/sync', AI_LIMIT, async (req) => {
    const b = body(z.object({ parts: z.array(z.enum(SYNC_PARTS)).max(3).optional() }), req.body);
    const report = await syncProfile({ parts: b.parts });
    // New or vanished facts change what the matcher sees: running campaigns sort their jobs again.
    if (report.added || report.deactivated || report.reactivated) refilterAfterProfileChange();
    return { report };
  });

  // ── Facts (every one with its source) ──────────────────────────────────────
  app.get('/api/master/facts', async (req) => {
    const q = body(
      z.object({
        source: z.enum(['cv', 'github', 'portfolio', 'manual', 'linkedin']).optional(),
        active: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    );
    return { facts: listFacts({ source: q.source, active: q.active === undefined ? undefined : q.active === 'true' }), kinds: FactKind.options };
  });

  app.post('/api/master/facts', async (req) => ({ fact: addManualFact(body(ManualFactInput, req.body)) }));
  app.patch('/api/master/facts/:id', async (req) => ({ fact: updateFact(id(req), body(FactPatch, req.body)) }));
  app.delete('/api/master/facts/:id', async (req) => deleteFact(id(req)));

  // ── Links and the GitHub token ─────────────────────────────────────────────
  app.get('/api/master/links', async () => ({ links: getLinks(loadProfile()), stored: storedLinks() }));
  app.put('/api/master/links', async (req) => {
    setLinks(body(LinksInput, req.body));
    return { links: getLinks(loadProfile()), stored: storedLinks() };
  });

  app.get('/api/master/github', async () => ({ github: storedGithub(), token: secretHint(GITHUB_TOKEN_SECRET) }));
  app.put('/api/master/github-token', async (req) => {
    const { token } = body(z.object({ token: z.string().trim().min(20).max(255).regex(/^[A-Za-z0-9_]+$/, 'not a GitHub token') }), req.body);
    setSecret(GITHUB_TOKEN_SECRET, token);
    return { token: secretHint(GITHUB_TOKEN_SECRET) };
  });
  app.delete('/api/master/github-token', async () => {
    deleteSecret(GITHUB_TOKEN_SECRET);
    return { token: secretHint(GITHUB_TOKEN_SECRET) };
  });

  // ── LinkedIn: official export or pasted text, never scraping ───────────────
  app.post('/api/master/linkedin', async (req) => {
    const file = await req.file({ limits: { fileSize: MAX_EXPORT, files: 1 } });
    if (!file) throw new AppError(400, 'NO_FILE', 'Choose your LinkedIn export (.zip) or one of its CSV files.');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw new AppError(413, 'TOO_LARGE', 'LinkedIn exports must be under 25 MB.');
    return { report: importLinkedInExport(buf, file.filename) };
  });
  app.post('/api/master/linkedin/text', AI_LIMIT, async (req) => {
    const { text } = body(z.object({ text: z.string().min(1).max(30_000) }), req.body);
    return { report: await importLinkedInText(text, defaultAi) };
  });

  // ── Voice bank ─────────────────────────────────────────────────────────────
  app.get('/api/master/voice', async () => ({ prompts: SUGGESTED_PROMPTS, guidance: VOICE_GUIDANCE, passages: listVoice(), style: storedStyle() }));
  app.post('/api/master/voice', async (req) => ({ passage: addVoice(body(VoiceInput, req.body)), style: storedStyle() }));
  app.put('/api/master/voice/:id', async (req) => ({ passage: updateVoice(id(req), body(VoiceInput.partial(), req.body)), style: storedStyle() }));
  app.delete('/api/master/voice/:id', async (req) => {
    deleteVoice(id(req));
    return { ok: true, style: storedStyle() };
  });
  app.get('/api/master/style', async () => ({ style: storedStyle() }));

  // ── Answer bank ────────────────────────────────────────────────────────────
  app.get('/api/master/answers', async () => ({ answers: listAnswers() }));
  app.post('/api/master/answers', async (req) => ({ answer: upsertAnswer(body(AnswerInput, req.body), 'owner') }));
  app.put('/api/master/answers/:id', async (req) => ({ answer: updateAnswer(id(req), body(AnswerPatch, req.body)) }));
  app.delete('/api/master/answers/:id', async (req) => {
    deleteAnswer(id(req));
    return { ok: true };
  });
  /** Try a question against the bank, as the form engine would. */
  app.post('/api/master/answers/test', async (req) => {
    const b = body(z.object({ question: z.string().trim().min(1).max(1000), jobId: z.string().max(100).optional(), options: z.array(z.string().max(300)).max(100).optional() }), req.body);
    return { answer: await answerFor(b.question, { jobId: b.jobId, options: b.options }), norm: normalizeQuestion(b.question), intent: detectIntent(b.question) };
  });

  // ── Unknown questions: answer → bank → job re-queued ───────────────────────
  app.get('/api/master/questions', async (req) => {
    const q = body(z.object({ status: z.enum(['open', 'answered', 'ignored', 'all']).default('open') }), req.query);
    return { questions: listUnknown(q.status) };
  });
  app.post('/api/master/questions/:id/answer', async (req) => answerUnknown(id(req), body(AnswerUnknownInput, req.body)));
  app.post('/api/master/questions/:id/ignore', async (req) => {
    ignoreUnknown(id(req));
    return { ok: true };
  });

  // ── Learning list ──────────────────────────────────────────────────────────
  app.get('/api/master/learning', async () => ({ items: listLearning() }));
  app.post('/api/master/learning', async (req) => ({ item: addLearning(body(LearningInput, req.body)) }));
  app.put('/api/master/learning/:id', async (req) => ({ item: updateLearning(id(req), body(LearningPatch, req.body)) }));
  app.delete('/api/master/learning/:id', async (req) => {
    deleteLearning(id(req));
    return { ok: true };
  });
}

