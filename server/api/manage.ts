import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { DATA_DIR, ROOT } from '../config.ts';
import { AppError } from '../errors.ts';
import { body } from '../routes/util.ts';
import { API_SCOPES, CreateKeyRequest, CreateKeyResponse } from '../contracts/api.ts';
import { auditCount, listAudit } from './audit.ts';
import { publicBase } from './files.ts';
import { createApiKey, getApiKey, listApiKeys, revokeApiKey } from './keys.ts';
import { rateLimitSettings, saveRateLimitSettings } from './ratelimit.ts';

/**
 * UI routes for managing agent keys (A10's "Agents & API" screen). These are
 * ordinary UI-session routes: the guard's session + CSRF rules apply, never
 * key auth.
 *
 *   GET    /api/agent-keys            every key (no secrets), the scope list and the rate limits
 *   POST   /api/agent-keys            create ({ name, scopes }) → { key, info }; the full key is shown once
 *   DELETE /api/agent-keys/:id        revoke (kept for the audit log)
 *   GET    /api/agent-keys/audit      audit log (?keyId=&status=ok|error&before=<id>&limit=)
 *   GET    /api/agent-keys/limits     rate limits
 *   PUT    /api/agent-keys/limits     change them ({ perMinute?, aiPerHour?, perKey? })
 *   GET    /api/agent-keys/connect    REST base, MCP URL and ready-to-paste MCP client config snippets
 */

const AuditQuery = z.object({
  keyId: z.string().max(64).optional(),
  status: z.enum(['ok', 'error']).optional(),
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function agentKeyRoutes(app: FastifyInstance) {
  app.get('/api/agent-keys', async () => ({ keys: listApiKeys(), scopes: API_SCOPES, limits: rateLimitSettings() }));

  app.post('/api/agent-keys', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) =>
    CreateKeyResponse.parse(await createApiKey(body(CreateKeyRequest, req.body))),
  );

  app.delete('/api/agent-keys/:id', async (req) => {
    const { id } = req.params as { id: string };
    return { ok: true, key: revokeApiKey(id) };
  });

  app.get('/api/agent-keys/audit', async (req) => {
    const q = body(AuditQuery, req.query);
    const entries = listAudit({ keyId: q.keyId ?? null, status: q.status ?? null, before: q.before ?? null, limit: q.limit });
    return { entries, total: auditCount(q.keyId), key: q.keyId ? getApiKey(q.keyId) : null };
  });

  app.get('/api/agent-keys/limits', async () => rateLimitSettings());

  app.put('/api/agent-keys/limits', async (req) => {
    try {
      return saveRateLimitSettings(req.body ?? {});
    } catch (err) {
      if (err instanceof z.ZodError) {
        const first = err.issues[0];
        throw new AppError(400, 'INVALID', `${first.path.join('.') || 'body'}: ${first.message}`);
      }
      throw err;
    }
  });

  app.get('/api/agent-keys/connect', async (req) => connectionInfo(publicBase(req)));
}

/** What an owner pastes into an MCP client. `<YOUR_KEY>` stands for the key shown once at creation. */
export function connectionInfo(base: string) {
  const KEY = '<YOUR_KEY>';
  const node = process.execPath;
  const tsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const stdio = path.join(ROOT, 'server', 'api', 'mcp', 'stdio.ts');
  const env = { BUREAU_API_KEY: KEY, BUREAU_DATA_DIR: DATA_DIR };
  const q = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  return {
    restBase: `${base}/api/v1`,
    mcpUrl: `${base}/mcp`,
    docs: 'docs/AGENT_API.md',
    snippets: {
      claudeDesktop: { mcpServers: { bureau: { command: node, args: [tsx, stdio], env } } },
      claudeCodeStdio: `claude mcp add bureau --env BUREAU_API_KEY=${KEY} --env BUREAU_DATA_DIR=${q(DATA_DIR)} -- ${q(node)} ${q(tsx)} ${q(stdio)}`,
      claudeCodeHttp: `claude mcp add --transport http bureau ${base}/mcp --header "Authorization: Bearer ${KEY}"`,
      genericHttp: { type: 'streamable-http', url: `${base}/mcp`, headers: { Authorization: `Bearer ${KEY}` } },
      genericStdio: { command: node, args: [tsx, stdio], env },
    },
  };
}
