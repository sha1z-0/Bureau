import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.BUREAU_DATA_DIR ?? path.join(ROOT, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const WEB_DIST = path.join(ROOT, 'dist', 'web');

export const HOST = process.env.BUREAU_HOST ?? '127.0.0.1';
export const PORT = Number(process.env.BUREAU_PORT ?? 4317);
export const DEV_WEB_PORT = Number(process.env.BUREAU_DEV_WEB_PORT ?? 5317);

export const IS_LOOPBACK = ['127.0.0.1', '::1', 'localhost'].includes(HOST);
export const COOKIE_SECURE = process.env.BUREAU_COOKIE_SECURE === '1';

/**
 * Hosts and origins the server will answer to. Anything else is rejected, which
 * shuts the door on DNS-rebinding attacks against a localhost service. When the
 * app is deployed behind a domain, list it in BUREAU_ALLOWED_ORIGINS.
 */
const extraOrigins = (process.env.BUREAU_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** The Vite dev server's origin is trusted only while developing (npm run dev). */
export const IS_DEV = process.env.BUREAU_DEV === '1' || process.env.npm_lifecycle_event === 'dev:server';

export const ALLOWED_ORIGINS = new Set<string>([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  ...(IS_DEV ? [`http://127.0.0.1:${DEV_WEB_PORT}`, `http://localhost:${DEV_WEB_PORT}`] : []),
  ...extraOrigins,
]);

export const ALLOWED_HOSTS = new Set<string>([...ALLOWED_ORIGINS].map((o) => new URL(o).host));

// Owner-only on POSIX; on Windows the user profile ACLs already apply.
for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
