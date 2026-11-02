import { ALLOWED_ORIGINS, PORT } from '../config.ts';

/**
 * A deep link into the UI for alerts. BUREAU_PUBLIC_URL wins (for a phone
 * reaching Bureau through a tunnel); else the first extra allowed origin; else
 * the local address.
 */
export function publicUrl(path: string): string {
  const configured = process.env.BUREAU_PUBLIC_URL?.trim();
  const extra = [...ALLOWED_ORIGINS].find((o) => !/^http:\/\/(127\.0\.0\.1|localhost):/.test(o));
  const base = (configured || extra || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
