import type { FastifyRequest } from 'fastify';
import { ALLOWED_ORIGINS } from '../config.ts';
import { getSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { activeKey, touchKey, verifyApiKey, type ApiKeyContext } from './keys.ts';
import { authFailuresExceeded, recordAuthFailure, takeRequest } from './ratelimit.ts';
import { verifyFileToken, type FileGrant } from './files.ts';

/**
 * A07 — key auth for /api/v1 and /mcp. The UI session guard
 * (server/security/guard.ts) hands these paths here after its Host check and
 * before any route runs. In order:
 *
 *  1. Off-loopback callers are refused unless Bureau has a passphrase.
 *  2. CORS is off: a request that carries an Origin is refused unless that
 *     origin is listed in BUREAU_API_CORS_ORIGINS (or is Bureau's own UI).
 *  3. Too many failed attempts from one address → 429.
 *  4. `Authorization: Bearer bur_<prefix>_<secret>` (scrypt-checked), or, for
 *     GET /api/v1/files/:token only, the signed token itself.
 *  5. The key's per-minute rate limit.
 *
 * The key is attached as `req.apiKey`; `req.apiAudit` collects what the audit
 * row (written by the onResponse hook in server/api/routes.ts) records.
 */

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyContext;
    apiAudit?: ApiAuditState;
  }
}

export interface ApiAuditState {
  /** Key id to attribute the row to even when auth failed (a known prefix with a wrong secret). */
  keyId: string | null;
  detail: Record<string, unknown>;
  /** Already written (MCP writes its own rows per JSON-RPC message). */
  done?: boolean;
  retryAfterSec?: number;
  corsOrigin?: string;
  preflight?: boolean;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLoopbackAddress = (addr: string | undefined) => !!addr && (LOOPBACK.has(addr) || addr.startsWith('127.') || addr.startsWith('::ffff:127.'));

export function apiCorsOrigins(): Set<string> {
  return new Set(
    (process.env.BUREAU_API_CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\/[^/\s]+$/i.test(s)),
  );
}

/** Same rule as the guard's passphrase lock, read directly to keep this module free of an import cycle. */
const passphraseIsSet = () => !!getSetting<unknown>('security.passphrase', null);

function fail(req: FastifyRequest, status: number, code: string, message: string): never {
  if (req.apiAudit) req.apiAudit.detail.error = code;
  throw new AppError(status, code, message);
}

export async function authenticateExternal(req: FastifyRequest): Promise<void> {
  const audit: ApiAuditState = { keyId: null, detail: {} };
  req.apiAudit = audit;
  const addr = req.socket?.remoteAddress ?? req.ip ?? 'unknown';

  if (!passphraseIsSet() && !isLoopbackAddress(addr)) {
    fail(req, 403, 'LOOPBACK_ONLY', 'The agent API answers only on this computer until Bureau has a passphrase.');
  }

  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    const allowed = apiCorsOrigins().has(origin);
    if (!allowed && !ALLOWED_ORIGINS.has(origin)) fail(req, 403, 'BAD_ORIGIN', 'Cross-origin requests to the agent API are off.');
    if (allowed) audit.corsOrigin = origin;
  } else if (req.headers['sec-fetch-site'] === 'cross-site') {
    fail(req, 403, 'BAD_ORIGIN', 'Cross-site requests to the agent API are refused.');
  }
  if (req.method === 'OPTIONS') {
    if (!audit.corsOrigin) fail(req, 403, 'BAD_ORIGIN', 'Cross-origin requests to the agent API are off.');
    audit.preflight = true;
    return;
  }

  const wait = authFailuresExceeded(addr);
  if (wait) {
    audit.retryAfterSec = wait;
    fail(req, 429, 'TOO_MANY_FAILURES', 'Too many failed attempts. Wait and try again.');
  }

  const header = req.headers.authorization;
  let key: ApiKeyContext | null = null;
  if (typeof header === 'string' && header.length) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (!m || m[1].length > 200) {
      recordAuthFailure(addr);
      fail(req, 401, 'BAD_KEY', 'Use Authorization: Bearer bur_<prefix>_<secret>.');
    }
    const res = await verifyApiKey(m[1]);
    if (!res.ok) {
      audit.keyId = res.keyId ?? null;
      audit.detail.reason = res.code.toLowerCase();
      recordAuthFailure(addr);
      fail(req, 401, res.code === 'REVOKED' ? 'KEY_REVOKED' : 'BAD_KEY', res.code === 'REVOKED' ? 'This API key was revoked.' : 'Invalid API key.');
    }
    key = res.key;
  } else {
    const token = fileToken(req);
    if (!token) fail(req, 401, 'NO_KEY', 'API key required: Authorization: Bearer bur_<prefix>_<secret>.');
    let grant: FileGrant;
    try {
      grant = verifyFileToken(token);
    } catch (err) {
      recordAuthFailure(addr);
      const e = err as AppError;
      fail(req, e.status ?? 401, e.code ?? 'BAD_TOKEN', e.message);
    }
    audit.keyId = grant.keyId;
    key = activeKey(grant.keyId);
    if (!key) fail(req, 401, 'KEY_REVOKED', 'The key this link was issued to is no longer active.');
  }

  audit.keyId = key.id;
  req.apiKey = key;
  const rl = takeRequest(key.id);
  if (!rl.ok) {
    audit.retryAfterSec = rl.retryAfterSec;
    fail(req, 429, 'RATE_LIMITED', `Rate limit reached for this key. Retry in ${rl.retryAfterSec} s.`);
  }
  touchKey(key.id);
}

/** The token of GET /api/v1/files/:token, when that is what this request is. */
function fileToken(req: FastifyRequest): string | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const p = req.url.split('?')[0];
  const m = /^\/api\/v1\/files\/([A-Za-z0-9_.-]+)$/.exec(p);
  return m ? m[1] : null;
}

/** The authenticated key, for route handlers (the guard guarantees it for every non-preflight /api/v1 route). */
export function keyOf(req: FastifyRequest): ApiKeyContext {
  if (!req.apiKey) throw new AppError(401, 'NO_KEY', 'API key required');
  return req.apiKey;
}
