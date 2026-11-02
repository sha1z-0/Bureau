import type { FastifyInstance } from 'fastify';
import { agentKeyRoutes } from './manage.ts';
import { externalRoutes } from './routes.ts';

/**
 * A07 — the external agent API (/api/v1), the MCP streamable-HTTP endpoint
 * (/mcp) and the UI's key management (/api/agent-keys). The two halves are
 * separate child plugins: the external one carries the audit hooks; the key
 * management routes are ordinary UI-session routes.
 */
export async function apiV1Routes(app: FastifyInstance) {
  await app.register(externalRoutes);
  await app.register(agentKeyRoutes);
}

export { agentKeyRoutes } from './manage.ts';
export { externalRoutes } from './routes.ts';
export { authenticateExternal } from './auth.ts';
export { createApiKey, listApiKeys, revokeApiKey, verifyApiKey } from './keys.ts';
export { listAudit } from './audit.ts';
export { buildMcpServer, MCP_TOOLS } from './mcp/tools.ts';
