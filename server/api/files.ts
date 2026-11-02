import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';
import { ALLOWED_ORIGINS, DATA_DIR, PORT } from '../config.ts';
import { AppError } from '../errors.ts';
import { getSecret, setSecret } from '../security/vault.ts';
import { loadPacket } from '../campaign/journal.ts';

/**
 * Short-lived signed download URLs for a packet's PDFs.
 *
 * A token is `<payload>.<mac>`, both base64url; the payload names the job, the
 * application, which file (cv | letter), the key it was issued to and the
 * expiry. It never contains a path: the file is resolved at download time from
 * the job's saved packet, and only a regular `.pdf` file inside DATA_DIR is
 * ever served. The HMAC key lives in the vault so every Bureau process (the
 * server and `npm run mcp`) signs and checks with the same one.
 */

export type FileKind = 'cv' | 'letter';
export interface FileGrant {
  jobId: string;
  applicationId: string;
  kind: FileKind;
  keyId: string;
  /** Expiry, epoch seconds. */
  exp: number;
}

const SECRET_NAME = 'api_file_signing_key';
export const FILE_TTL_SEC = 15 * 60;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,1200}\.[A-Za-z0-9_-]{43}$/;

let signing: Buffer | null = null;
function signingKey(reload = false): Buffer {
  if (signing && !reload) return signing;
  let s = getSecret(SECRET_NAME);
  if (!s) {
    setSecret(SECRET_NAME, crypto.randomBytes(32).toString('base64'), { hint: false });
    // Re-read: if another process raced us, both now use whichever row won.
    s = getSecret(SECRET_NAME)!;
  }
  return (signing = Buffer.from(s, 'base64'));
}

const mac = (k: Buffer, body: string) => crypto.createHmac('sha256', k).update(`bureau-file:${body}`).digest('base64url');

export function signFileToken(g: Omit<FileGrant, 'exp'>, ttlSec = FILE_TTL_SEC): { token: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = Buffer.from(
    JSON.stringify({ v: 1, j: g.jobId, a: g.applicationId, f: g.kind, k: g.keyId, e: exp, n: crypto.randomBytes(6).toString('base64url') }),
  ).toString('base64url');
  return { token: `${body}.${mac(signingKey(), body)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Check a token's MAC and expiry. Throws 401 for anything wrong. */
export function verifyFileToken(token: string): FileGrant {
  if (!TOKEN_RE.test(token)) throw new AppError(401, 'BAD_TOKEN', 'Invalid file link');
  const [body, sig] = token.split('.');
  const ok = (k: Buffer) => {
    const want = Buffer.from(mac(k, body));
    const got = Buffer.from(sig);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  };
  // A second process may have created the signing key after we cached ours.
  if (!ok(signingKey()) && !ok(signingKey(true))) throw new AppError(401, 'BAD_TOKEN', 'Invalid file link');
  let p: { v?: unknown; j?: unknown; a?: unknown; f?: unknown; k?: unknown; e?: unknown };
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as typeof p;
  } catch {
    throw new AppError(401, 'BAD_TOKEN', 'Invalid file link');
  }
  if (p.v !== 1 || typeof p.j !== 'string' || typeof p.a !== 'string' || (p.f !== 'cv' && p.f !== 'letter') || typeof p.k !== 'string' || typeof p.e !== 'number') {
    throw new AppError(401, 'BAD_TOKEN', 'Invalid file link');
  }
  if (p.e * 1000 < Date.now()) throw new AppError(401, 'TOKEN_EXPIRED', 'This file link has expired; fetch the packet again for a fresh one.');
  return { jobId: p.j, applicationId: p.a, kind: p.f, keyId: p.k, exp: p.e };
}

/** The PDF a grant points at, or 404. Only regular .pdf files under DATA_DIR that start with %PDF-. */
export function resolveGrantFile(g: FileGrant): { file: string; filename: string; size: number } {
  const packet = loadPacket(g.jobId);
  if (!packet || packet.applicationId !== g.applicationId) throw new AppError(404, 'GONE', 'That packet no longer exists; fetch the packet again.');
  const raw = g.kind === 'cv' ? packet.cvPdfPath : packet.letterPdfPath;
  const file = safePdf(raw);
  if (!file) throw new AppError(404, 'NO_FILE', `The ${g.kind === 'cv' ? 'CV' : 'cover letter'} PDF is not available.`);
  return { ...file, filename: g.kind === 'cv' ? 'CV.pdf' : 'Cover-letter.pdf' };
}

export function safePdf(raw: string | null | undefined): { file: string; size: number } | null {
  if (!raw || typeof raw !== 'string' || raw.includes('\0') || !path.isAbsolute(raw)) return null;
  if (path.extname(raw).toLowerCase() !== '.pdf') return null;
  let real: string;
  let root: string;
  try {
    real = fs.realpathSync(raw);
    root = fs.realpathSync(DATA_DIR);
  } catch {
    return null;
  }
  const inside = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase().startsWith(b.toLowerCase() + path.sep) : a.startsWith(b + path.sep));
  if (!inside(real, root)) return null;
  if (path.extname(real).toLowerCase() !== '.pdf') return null;
  const st = fs.statSync(real);
  if (!st.isFile() || st.size < 5 || st.size > MAX_PDF_BYTES) return null;
  const fd = fs.openSync(real, 'r');
  try {
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, 0);
    if (head.toString('latin1') !== '%PDF-') return null;
  } finally {
    fs.closeSync(fd);
  }
  return { file: real, size: st.size };
}

/**
 * The origin external agents should use for links. BUREAU_PUBLIC_URL wins;
 * otherwise the (already allow-listed) Host of the request; otherwise loopback.
 */
export function publicBase(req?: FastifyRequest): string {
  const env = process.env.BUREAU_PUBLIC_URL;
  if (env) {
    try {
      const u = new URL(env);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
    } catch {
      /* fall through */
    }
  }
  const host = req?.headers.host;
  if (host && /^[a-z0-9.\-[\]:]+$/i.test(host)) return ALLOWED_ORIGINS.has(`https://${host}`) && !ALLOWED_ORIGINS.has(`http://${host}`) ? `https://${host}` : `http://${host}`;
  return `http://127.0.0.1:${PORT}`;
}

export function fileUrl(base: string, token: string) {
  return `${base}/api/v1/files/${token}`;
}
