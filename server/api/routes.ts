import fs from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors.ts';
import { body } from '../routes/util.ts';
import { AnswerRequest, ClaimRequest, FailedRequest, ListJobsQuery, RecipeQuery, SubmittedRequest } from '../contracts/api.ts';
import { keyOf } from './auth.ts';
import { writeAudit } from './audit.ts';
import { publicBase, resolveGrantFile, verifyFileToken } from './files.ts';
import { requireScope } from './keys.ts';
import { mcpHttpRoutes } from './mcp/http.ts';
import * as svc from './service.ts';

/**
 * The external agent surface: REST /api/v1 and MCP /mcp. Key auth already ran
 * in the guard (server/api/auth.ts). Every request gets one api_audit row,
 * written here when the response finishes, failures included.
 *
 *   GET    /api/v1/health                 key check; the key's scopes
 *   GET    /api/v1/jobs?state=&limit=     jobs in a pipeline state (default: selected)    jobs:read
 *   GET    /api/v1/jobs/:id               job detail                                       jobs:read
 *   POST   /api/v1/jobs/:id/claim         take a lease ({ ttlMinutes? }, default 20)       applications:write
 *   DELETE /api/v1/jobs/:id/claim         give it back                                     applications:write
 *   POST   /api/v1/jobs/:id/packet        make sure the packet exists; text + signed URLs  packets:read (claim)
 *   GET    /api/v1/files/<token>          a packet PDF (token-only auth works)             packets:read
 *   POST   /api/v1/answers                answer one form question                         answers:read
 *   GET    /api/v1/recipes?url=           the active recipe for a form URL                 recipes:read
 *   POST   /api/v1/traces                 report what the agent did on a form              traces:write
 *   POST   /api/v1/jobs/:id/submitted     record a submission with proof                   applications:write
 *   POST   /api/v1/jobs/:id/failed        give up on a job with a reason                   applications:write (claim)
 *   POST   /mcp                           MCP streamable HTTP (stateless, JSON responses)
 */

const ctxOf = (req: FastifyRequest): svc.CallCtx => ({ key: keyOf(req), baseUrl: publicBase(req), via: 'rest' });
const jobIdOf = (req: FastifyRequest) => {
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !id || id.length > 200) throw new AppError(400, 'INVALID', 'Bad job id');
  return id;
};

const CORS_HEADERS = 'authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id';

export async function externalRoutes(app: FastifyInstance) {
  app.addHook('onError', async (req, _reply, err) => {
    if (req.apiAudit && !req.apiAudit.detail.error) req.apiAudit.detail.error = (err as AppError).code ?? 'ERROR';
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    const a = req.apiAudit;
    if (a?.retryAfterSec) reply.header('retry-after', String(a.retryAfterSec));
    if (a?.corsOrigin) reply.header('access-control-allow-origin', a.corsOrigin).header('vary', 'Origin');
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    const a = req.apiAudit;
    if (a?.done || a?.preflight) return;
    const params = (req.params ?? {}) as { id?: unknown };
    const detail: Record<string, unknown> = { ...(a?.detail ?? {}) };
    if (typeof params.id === 'string') detail.jobId = params.id.slice(0, 100);
    if (!a) detail.error ??= 'REFUSED';
    writeAudit({
      keyId: a?.keyId ?? req.apiKey?.id ?? null,
      route: `${req.method} ${req.routeOptions?.url ?? req.url.split('?')[0].slice(0, 120)}`,
      status: reply.statusCode,
      detail,
    });
  });

  for (const url of ['/api/v1/*', '/mcp']) {
    app.options(url, async (req, reply) => {
      // Only reached for an allow-listed origin (auth refuses the rest).
      reply
        .header('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
        .header('access-control-allow-headers', CORS_HEADERS)
        .header('access-control-max-age', '600');
      return reply.status(204).send();
    });
  }

  app.get('/api/v1/health', async (req) => svc.health(ctxOf(req)));

  app.get('/api/v1/jobs', async (req) => svc.listJobs(ctxOf(req), body(ListJobsQuery, req.query)));

  app.get('/api/v1/jobs/:id', async (req) => svc.getJob(ctxOf(req), jobIdOf(req)));

  app.post('/api/v1/jobs/:id/claim', async (req) => {
    const { ttlMinutes } = body(ClaimRequest, req.body ?? {});
    return svc.claim(ctxOf(req), jobIdOf(req), ttlMinutes);
  });

  app.delete('/api/v1/jobs/:id/claim', async (req) => svc.release(ctxOf(req), jobIdOf(req)));

  app.post('/api/v1/jobs/:id/packet', async (req) => svc.packet(ctxOf(req), jobIdOf(req)));

  // A wildcard, not `:token`: tokens are longer than the router's 100-character parameter limit.
  app.get('/api/v1/files/*', async (req, reply) => {
    const key = keyOf(req);
    requireScope(key, 'packets:read');
    const grant = verifyFileToken(String((req.params as { '*': string })['*'] ?? ''));
    if (grant.keyId !== key.id) throw new AppError(403, 'WRONG_KEY', 'This link was issued to another key.');
    const f = resolveGrantFile(grant);
    if (req.apiAudit) Object.assign(req.apiAudit.detail, { jobId: grant.jobId, file: grant.kind });
    reply
      .header('content-type', 'application/pdf')
      .header('content-length', String(f.size))
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .header('x-content-type-options', 'nosniff');
    return reply.send(fs.createReadStream(f.file));
  });

  app.post('/api/v1/answers', async (req) => {
    const q = body(AnswerRequest, req.body);
    if (req.apiAudit) Object.assign(req.apiAudit.detail, { jobId: q.jobId.slice(0, 100), fieldKind: q.fieldKind });
    const res = await svc.answer(ctxOf(req), q);
    if (req.apiAudit) req.apiAudit.detail.source = res.source;
    return res;
  });

  app.get('/api/v1/recipes', async (req) => {
    const { url } = body(RecipeQuery, req.query);
    return svc.recipe(ctxOf(req), url);
  });

  app.post('/api/v1/traces', async (req) => {
    const t = body(svc.ExternalTraceSchema, req.body);
    const res = await svc.trace(ctxOf(req), t);
    if (req.apiAudit) Object.assign(req.apiAudit.detail, { traceId: res.traceId, queued: res.queued, steps: t.steps.length });
    return res;
  });

  // Proof screenshots are up to ~4 MB decoded (~5.5 MB of base64), above the server's default body limit.
  app.post('/api/v1/jobs/:id/submitted', { bodyLimit: 7 * 1024 * 1024 }, async (req) =>
    svc.submitted(ctxOf(req), jobIdOf(req), body(SubmittedRequest, req.body)),
  );

  app.post('/api/v1/jobs/:id/failed', async (req) => svc.failed(ctxOf(req), jobIdOf(req), body(FailedRequest, req.body)));

  await app.register(mcpHttpRoutes);

  // Anything else under /api/v1 is a 404 that still gets audited.
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/api/v1/*',
    handler: async () => {
      throw new AppError(404, 'NOT_FOUND', 'No such endpoint');
    },
  });
}
