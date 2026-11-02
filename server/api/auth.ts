import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors.ts';

/**
 * A07 — key auth for /api/v1 and /mcp. The UI session guard hands these paths
 * here. Fails closed until A07 implements keys, scopes, rate limits and audit.
 */
export async function authenticateExternal(req: FastifyRequest): Promise<void> {
  void req;
  throw new AppError(401, 'NO_KEY', 'API key required');
}
