import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { all, get, now, run } from '../db.ts';
import { AppError } from '../errors.ts';
import { API_SCOPES, ApiScope, type ApiKeyInfo } from '../contracts/api.ts';

/**
 * API keys for external agents. A key looks like `bur_<prefix>_<secret>`:
 * the prefix (8 lowercase base-36 characters) is public and identifies the
 * row; the secret (32 random bytes, base64url) is never stored, only an
 * scrypt hash of the whole key. The full key is shown to the owner once.
 */

export interface ApiKeyContext {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
}

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export const KEY_RE = /^bur_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;
const MAX_ACTIVE_KEYS = 50;

const scryptAsync = promisify(crypto.scrypt) as (pw: string | Buffer, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
/** ~16 MB and a few tens of ms per check; successful checks are cached (see `verified`). */
const SCRYPT = { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const B36 = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randomPrefix(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += B36[crypto.randomInt(B36.length)];
  return out;
}

async function hashKey(full: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(full, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function checkHash(full: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 17) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const want = Buffer.from(parts[5], 'base64');
  const got = await scryptAsync(full, salt, want.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function parseScopes(text: string): ApiScope[] {
  try {
    const arr = JSON.parse(text) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((s): s is ApiScope => ApiScope.safeParse(s).success);
  } catch {
    return [];
  }
}

const toInfo = (r: KeyRow): ApiKeyInfo => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  scopes: parseScopes(r.scopes),
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});

const toCtx = (r: KeyRow): ApiKeyContext => ({ id: r.id, name: r.name, prefix: r.prefix, scopes: parseScopes(r.scopes) });

/** Create a key. The returned `key` is the only time the secret exists outside the caller's hands. */
export async function createApiKey(input: { name: string; scopes: ApiScope[] }): Promise<{ key: string; info: ApiKeyInfo }> {
  const name = input.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
  if (!name) throw new AppError(400, 'INVALID', 'name: give the key a name');
  const scopes = [...new Set(input.scopes)].filter((s) => (API_SCOPES as readonly string[]).includes(s)).sort() as ApiScope[];
  if (!scopes.length) throw new AppError(400, 'INVALID', 'scopes: pick at least one scope');
  const active = get<{ n: number }>('SELECT COUNT(*) AS n FROM api_keys WHERE revoked_at IS NULL')?.n ?? 0;
  if (active >= MAX_ACTIVE_KEYS) throw new AppError(409, 'TOO_MANY_KEYS', `At most ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`);

  for (let attempt = 0; attempt < 5; attempt++) {
    const prefix = randomPrefix();
    if (get('SELECT 1 FROM api_keys WHERE prefix = ?', prefix)) continue;
    const key = `bur_${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
    const id = crypto.randomUUID();
    run(
      'INSERT INTO api_keys (id, name, prefix, hash, scopes, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)',
      id,
      name,
      prefix,
      await hashKey(key),
      JSON.stringify(scopes),
      now(),
    );
    return { key, info: toInfo(get<KeyRow>('SELECT * FROM api_keys WHERE id = ?', id)!) };
  }
  throw new AppError(500, 'KEY_PREFIX', 'Could not find a free key prefix; try again.');
}

export function listApiKeys(): ApiKeyInfo[] {
  return all<KeyRow>('SELECT * FROM api_keys ORDER BY revoked_at IS NOT NULL, created_at DESC').map(toInfo);
}

export function getApiKey(id: string): ApiKeyInfo | null {
  const r = get<KeyRow>('SELECT * FROM api_keys WHERE id = ?', id);
  return r ? toInfo(r) : null;
}

/** Revoke (the row stays for the audit log). Idempotent. */
export function revokeApiKey(id: string): ApiKeyInfo {
  const r = get<KeyRow>('SELECT * FROM api_keys WHERE id = ?', id);
  if (!r) throw new AppError(404, 'NOT_FOUND', 'No such key');
  if (!r.revoked_at) run('UPDATE api_keys SET revoked_at = ? WHERE id = ?', now(), id);
  verified.delete(r.prefix);
  return toInfo(get<KeyRow>('SELECT * FROM api_keys WHERE id = ?', id)!);
}

/** The key behind an id, if it is still active (re-checked on every call, so revocation is immediate). */
export function activeKey(id: string): ApiKeyContext | null {
  const r = get<KeyRow>('SELECT * FROM api_keys WHERE id = ? AND revoked_at IS NULL', id);
  return r ? toCtx(r) : null;
}

/**
 * Successful checks are remembered for a few minutes as a SHA-256 of the key
 * (never the key), so a busy agent does not pay scrypt on every request.
 */
const verified = new Map<string, { digest: Buffer; until: number }>();
const CACHE_MS = 5 * 60_000;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest();

export type VerifyResult = { ok: true; key: ApiKeyContext } | { ok: false; code: 'MALFORMED' | 'UNKNOWN' | 'REVOKED' | 'BAD_SECRET'; keyId?: string };

export async function verifyApiKey(full: string): Promise<VerifyResult> {
  const m = KEY_RE.exec(full);
  if (!m) return { ok: false, code: 'MALFORMED' };
  const prefix = m[1];
  const r = get<KeyRow>('SELECT * FROM api_keys WHERE prefix = ?', prefix);
  if (!r) return { ok: false, code: 'UNKNOWN' };
  if (r.revoked_at) return { ok: false, code: 'REVOKED', keyId: r.id };
  const digest = sha(full);
  const hit = verified.get(prefix);
  if (hit && hit.until > Date.now() && crypto.timingSafeEqual(hit.digest, digest)) return { ok: true, key: toCtx(r) };
  if (!(await checkHash(full, r.hash))) return { ok: false, code: 'BAD_SECRET', keyId: r.id };
  if (verified.size > 500) verified.clear();
  verified.set(prefix, { digest, until: Date.now() + CACHE_MS });
  return { ok: true, key: toCtx(r) };
}

/** Called after a successful, authenticated request. Throttled to one write per key per 10 s. */
const touched = new Map<string, number>();
export function touchKey(id: string) {
  const last = touched.get(id) ?? 0;
  if (Date.now() - last < 10_000) return;
  touched.set(id, Date.now());
  run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', now(), id);
}

/** Tests: forget cached verifications and last-used throttles. */
export function resetKeyCaches() {
  verified.clear();
  touched.clear();
}

export function hasScope(key: ApiKeyContext, scope: ApiScope): boolean {
  return key.scopes.includes(scope);
}

export function requireScope(key: ApiKeyContext, scope: ApiScope) {
  if (!hasScope(key, scope)) throw new AppError(403, 'MISSING_SCOPE', `This key lacks the ${scope} scope.`);
}

/** The claim holder name for a key. */
export const holderOf = (key: { id: string }) => `external:${key.id}`;
