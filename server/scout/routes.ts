import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { AppError } from '../errors.ts';
import { body } from '../routes/util.ts';
import { CONNECTORS } from '../sources/index.ts';
import { canonicalApplyUrl, detectAts } from './detect.ts';
import { lastScoutRun, scoutPipeline, scoutRunning, sourceHealth } from './index.ts';
import { jobspyStatus } from './jobspy.ts';
import { addCareersUrl, getCompany, listCompanies, registryStats, seedRegistry, setCompanyStatus } from './registry.ts';
import { saveScoutSettings, scoutSettings } from './settings.ts';
import { freshSignals } from './signals.ts';

/**
 * UI-facing scout routes, all under /api/scout (no collision with the v1
 * /api/sources and /api/scans routes in server/routes/**):
 *
 *   GET   /api/scout/health              per-source health + JobSpy sidecar status + last run summary
 *   GET   /api/scout/stats               last run report (dedupe stats, per-connector outcomes) + registry stats
 *   POST  /api/scout/run                 start a scout run { sources?, campaignId? } (joins a running one)
 *   GET   /api/scout/companies           registry list/search ?q=&ats=&status=&signals=1&limit=&offset=
 *   GET   /api/scout/companies/:id       one company
 *   POST  /api/scout/companies           add by careers URL or domain { url, name? } with ATS auto-detection
 *   PATCH /api/scout/companies/:id       { status: 'active' | 'paused' }
 *   POST  /api/scout/detect              { url } → detected ATS, token, job id, canonical apply URL (no network)
 *   GET   /api/scout/signals             companies with fresh hiring signals
 *   GET   /api/scout/settings            scout tuning
 *   PUT   /api/scout/settings            partial update of scout tuning
 *   POST  /api/scout/registry/seed       re-run the registry seed { force? }
 */
export async function scoutRoutes(app: FastifyInstance) {
  app.get('/api/scout/health', async () => {
    const last = lastScoutRun();
    return {
      running: scoutRunning(),
      sources: sourceHealth(),
      jobspy: await jobspyStatus(),
      lastRun: last
        ? { id: last.id, startedAt: last.startedAt, finishedAt: last.finishedAt, ms: last.ms, found: last.found, added: last.added.length, uniqueLast24h: last.uniqueLast24h, stats: last.stats }
        : null,
    };
  });

  app.get('/api/scout/stats', async () => {
    const last = lastScoutRun();
    return { lastRun: last ? { ...last, added: last.added.length } : null, registry: registryStats(), running: scoutRunning() };
  });

  app.post('/api/scout/run', { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } }, async (req) => {
    const opts = body(
      z.object({
        sources: z.array(z.string().max(40)).max(60).optional(),
        campaignId: z.string().max(80).optional(),
      }),
      req.body,
    );
    const known = new Set([...CONNECTORS.map((c) => c.id), 'deepscan']);
    const unknown = (opts.sources ?? []).filter((s) => !known.has(s));
    if (unknown.length) throw new AppError(400, 'UNKNOWN_SOURCE', `Unknown source(s): ${unknown.join(', ')}`);
    const wasRunning = scoutRunning();
    // Fire and forget: progress arrives over the event stream and /api/scout/health.
    scoutPipeline({ sources: opts.sources, campaignId: opts.campaignId }).catch(() => {});
    return { started: !wasRunning, joined: wasRunning };
  });

  app.get('/api/scout/companies', async (req) => {
    const q = body(
      z.object({
        q: z.string().max(120).optional(),
        ats: z.string().max(40).optional(),
        status: z.enum(['active', 'employer', 'unsupported', 'dead', 'paused']).optional(),
        signals: z.enum(['0', '1', 'true', 'false']).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
      req.query,
    );
    return listCompanies({ ...q, signals: q.signals === '1' || q.signals === 'true' });
  });

  app.get('/api/scout/companies/:id', async (req) => {
    const c = getCompany((req.params as { id: string }).id);
    if (!c) throw new AppError(404, 'NOT_FOUND', 'No such company');
    return c;
  });

  app.post('/api/scout/companies', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const input = body(z.object({ url: z.string().min(3).max(500), name: z.string().max(200).optional() }), req.body);
    const r = await addCareersUrl({ url: input.url, name: input.name });
    return { company: r.company, created: r.created, detectedVia: r.via, detected: r.detected };
  });

  app.patch('/api/scout/companies/:id', async (req) => {
    const input = body(z.object({ status: z.enum(['active', 'paused']) }), req.body);
    const id = (req.params as { id: string }).id;
    const c = getCompany(id);
    if (!c) throw new AppError(404, 'NOT_FOUND', 'No such company');
    if (input.status === 'active' && (!c.ats || !c.atsToken)) throw new AppError(409, 'NO_ATS', 'This company has no supported ATS board to poll yet.');
    return setCompanyStatus(id, input.status);
  });

  app.post('/api/scout/detect', async (req) => {
    const { url } = body(z.object({ url: z.string().min(3).max(2000) }), req.body);
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return { url: full, detected: detectAts(full), canonical: canonicalApplyUrl(full) };
  });

  app.get('/api/scout/signals', async () => ({ signals: freshSignals() }));

  app.get('/api/scout/settings', async () => scoutSettings());

  app.put('/api/scout/settings', async (req) => {
    try {
      return saveScoutSettings(req.body ?? {});
    } catch (err) {
      throw new AppError(400, 'INVALID', (err as Error).message.slice(0, 300));
    }
  });

  app.post('/api/scout/registry/seed', async (req) => {
    const { force } = body(z.object({ force: z.boolean().optional() }), req.body);
    return seedRegistry(!!force);
  });
}
