import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ALLOWED_HOSTS, ALLOWED_ORIGINS, COOKIE_SECURE, IS_LOOPBACK } from '../config.ts';
import { getSetting, setSetting } from '../db.ts';
import { AppError } from '../errors.ts';

/**
 * Request guard for a single-user app that may one day leave localhost.
 *
 *  1. Host allow-list          → defeats DNS rebinding.
 *  2. Fail-closed routing      → every request is guarded on its *decoded* path and
 *                                its matched route, so `/%61pi/…` can't slip past.
 *  3. Origin allow-list        → state-changing requests must come from our own UI.
 *  4. Session cookie           → HttpOnly + SameSite=Strict, random 256-bit id.
 *  5. CSRF header              → every non-GET call carries a per-session token that
 *                                a cross-site page can neither read nor forge.
 *  6. Optional passphrase lock → async scrypt, per-IP and global back-off;
 *                                mandatory whenever Bureau is bound off-loopback.
 */

interface Session {
  csrf: string;
  authed: boolean;
  createdAt: number;
  lastSeen: number;
}

const SESSION_COOKIE = 'bureau_sid';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;
const sessions = new Map<string, Session>();

const PUBLIC_API = new Set(['/api/session', '/api/auth/login', '/api/health']);

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

type PassRecord = { salt: string; hash: string } | null;

export function passphraseSet(): boolean {
  return !!getSetting<PassRecord>('security.passphrase', null);
}

/** Changing or clearing an existing lock requires proving you know the current passphrase. */
export async function setPassphrase(next: string | null, current: string) {
  if (passphraseSet() && !(await verifyPassphrase(current))) {
    throw new AppError(403, 'BAD_PASSPHRASE', 'Your current passphrase is not right.');
  }
  if (!next) {
    if (!IS_LOOPBACK) throw new AppError(403, 'LOCK_REQUIRED', 'Bureau must stay locked while it listens beyond this computer.');
    setSetting('security.passphrase', null);
  } else {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(next, salt, 64, SCRYPT);
    setSetting('security.passphrase', { salt: salt.toString('base64'), hash: hash.toString('base64') });
  }
  // Changing the lock signs every other session out.
  sessions.clear();
}

async function verifyPassphrase(passphrase: string): Promise<boolean> {
  const rec = getSetting<PassRecord>('security.passphrase', null);
  if (!rec) return true;
  const hash = await scrypt(passphrase, Buffer.from(rec.salt, 'base64'), 64, SCRYPT);
  return crypto.timingSafeEqual(hash, Buffer.from(rec.hash, 'base64'));
}

/** Global back-off on failed logins, so rotating IPs doesn't buy unlimited guesses. */
const failures: number[] = [];
function loginDelayMs(): number {
  const cutoff = Date.now() - 15 * 60_000;
  while (failures.length && failures[0] < cutoff) failures.shift();
  return failures.length < 5 ? 0 : Math.min(30_000, 1000 * 2 ** (failures.length - 5));
}

function sweep() {
  const now = Date.now();
  for (const [sid, s] of sessions) if (now - s.lastSeen > SESSION_TTL_MS) sessions.delete(sid);
  // Still too many? Drop the least recently used.
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, sessions.size - MAX_SESSIONS + 1);
    for (const [sid] of oldest) sessions.delete(sid);
  }
}

function readSession(req: FastifyRequest): [string, Session] | null {
  const sid = req.cookies[SESSION_COOKIE];
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.lastSeen > SESSION_TTL_MS) {
    sessions.delete(sid);
    return null;
  }
  s.lastSeen = Date.now();
  return [sid, s];
}

function issueSession(reply: FastifyReply): Session {
  sweep();
  const sid = crypto.randomBytes(32).toString('base64url');
  const session: Session = {
    csrf: crypto.randomBytes(32).toString('base64url'),
    // Off-loopback, a session is never authenticated without the passphrase.
    authed: !passphraseSet() && IS_LOOPBACK,
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  sessions.set(sid, session);
  reply.setCookie(SESSION_COOKIE, sid, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: COOKIE_SECURE,
    maxAge: SESSION_TTL_MS / 1000,
  });
  return session;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** The path as the router will see it: decoded, with dot-segments and duplicate slashes collapsed. */
function canonicalPath(rawUrl: string): string {
  let path: string;
  try {
    path = decodeURIComponent(rawUrl.split('?')[0]);
  } catch {
    throw new AppError(400, 'BAD_PATH', 'Malformed path');
  }
  return new URL(path.replace(/\\/g, '/'), 'http://x').pathname.replace(/\/{2,}/g, '/').toLowerCase();
}

export function registerGuard(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) throw new AppError(421, 'BAD_HOST', 'Unrecognised host');

    // Fail closed: guard anything whose decoded path *or* matched route is under /api.
    const path = canonicalPath(req.url);
    const route = req.routeOptions?.url ?? '';
    const isApi = path === '/api' || path.startsWith('/api/') || route.startsWith('/api/');
    if (!isApi) return;
    if (req.url.split('?')[0] !== path && !route) {
      // Encoded or non-canonical spellings of API paths that matched nothing: refuse outright.
      throw new AppError(404, 'NOT_FOUND', 'No such endpoint');
    }

    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const origin = req.headers.origin;
    if (mutating && origin && !ALLOWED_ORIGINS.has(origin)) {
      throw new AppError(403, 'BAD_ORIGIN', 'Cross-origin request refused');
    }
    // Browsers tag every fetch; refuse anything that admits to being cross-site.
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      throw new AppError(403, 'BAD_ORIGIN', 'Cross-site request refused');
    }

    if (PUBLIC_API.has(route)) return;

    const found = readSession(req);
    if (!found) throw new AppError(401, 'NO_SESSION', 'Session expired');
    const [, session] = found;
    if (!session.authed) throw new AppError(401, 'LOCKED', 'Bureau is locked');
    if (mutating) {
      const token = req.headers['x-bureau-csrf'];
      if (typeof token !== 'string' || !safeEqual(token, session.csrf)) {
        throw new AppError(403, 'BAD_CSRF', 'Missing or invalid CSRF token');
      }
    }
  });

  app.get('/api/session', async (req, reply) => {
    const found = readSession(req);
    const session = found ? found[1] : issueSession(reply);
    return { csrf: session.csrf, locked: !session.authed, passphrase: passphraseSet() };
  });

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { passphrase?: unknown };
      const found = readSession(req);
      if (!found) throw new AppError(401, 'NO_SESSION', 'Session expired');
      const origin = req.headers.origin;
      if (!origin || !ALLOWED_ORIGINS.has(origin)) throw new AppError(403, 'BAD_ORIGIN', 'Cross-origin request refused');
      const csrf = req.headers['x-bureau-csrf'];
      if (typeof csrf !== 'string' || !safeEqual(csrf, found[1].csrf)) throw new AppError(403, 'BAD_CSRF', 'Missing or invalid CSRF token');
      if (!passphraseSet()) throw new AppError(409, 'NO_LOCK', 'Bureau has no passphrase set.');

      const wait = loginDelayMs();
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (typeof body.passphrase !== 'string' || body.passphrase.length > 200 || !(await verifyPassphrase(body.passphrase))) {
        failures.push(Date.now());
        throw new AppError(401, 'BAD_PASSPHRASE', 'That passphrase is not right');
      }
      // Rotate the session on privilege change.
      sessions.delete(found[0]);
      const fresh = issueSession(reply);
      fresh.authed = true;
      return { csrf: fresh.csrf, locked: false, passphrase: true };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const found = readSession(req);
    if (found) sessions.delete(found[0]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
