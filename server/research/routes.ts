import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { AppError } from '../errors.ts';
import { AI_LIMIT, body } from '../routes/util.ts';
import { cachedBrief, deleteBrief, listBriefs, researchCompany, researchForJob } from './index.ts';

/** UI-facing routes for company research. Paths live under /api/research. */
export async function researchRoutes(app: FastifyInstance) {
  /** All cached briefs (company, domain, fetchedAt, stale, claim count). */
  app.get('/api/research/briefs', async () => ({ briefs: listBriefs() }));

  /** The cached brief for a company, without spending anything. 404 when none. */
  app.get('/api/research', async (req) => {
    const q = body(z.object({ company: z.string().trim().min(1).max(200), domain: z.string().trim().max(300).optional() }), req.query);
    const brief = cachedBrief(q.company, q.domain);
    if (!brief) throw new AppError(404, 'NOT_FOUND', `No research on ${q.company} yet.`);
    return { brief };
  });

  /** Research a company now (cached for 14 days unless force). */
  app.post('/api/research', AI_LIMIT, async (req) => {
    const b = body(z.object({ company: z.string().trim().min(1).max(200), domain: z.string().trim().max(300).optional(), force: z.boolean().default(false) }), req.body);
    return { brief: await researchCompany(b.company, b.domain, { force: b.force }) };
  });

  /** Research the company behind a job (uses the registry domain and the posting). */
  app.post('/api/research/job/:jobId', AI_LIMIT, async (req) => {
    const { jobId } = req.params as { jobId: string };
    const b = body(z.object({ force: z.boolean().default(false) }), req.body);
    return { brief: await researchForJob(jobId, { force: b.force }) };
  });

  app.delete('/api/research/briefs/:key', async (req) => {
    deleteBrief(decodeURIComponent((req.params as { key: string }).key));
    return { ok: true };
  });
}
