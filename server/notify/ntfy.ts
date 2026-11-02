import { fetch as undiciFetch } from 'undici';
import { AppError } from '../errors.ts';
import { offline } from './telegram.ts';

/** ntfy.sh (or a self-hosted ntfy) as an alternative push channel. */

export interface NtfyMessage {
  title: string;
  body: string;
  priority: 'default' | 'high';
  tags?: string[];
  click?: string;
}

export type NtfyHttp = (url: string, msg: NtfyMessage) => Promise<void>;

const realHttp: NtfyHttp = async (url, msg) => {
  if (offline()) throw new AppError(503, 'OFFLINE', 'ntfy is disabled in offline mode.');
  // Header values must be single-line Latin-1; titles are plain words anyway.
  const header = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, '').slice(0, 200);
  const res = await undiciFetch(url, {
    method: 'POST',
    body: msg.body.slice(0, 3500),
    headers: {
      Title: header(msg.title),
      Priority: msg.priority === 'high' ? '4' : '3',
      ...(msg.tags?.length ? { Tags: header(msg.tags.join(',')) } : {}),
      ...(msg.click && /^https?:\/\//.test(msg.click) ? { Click: header(msg.click) } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new AppError(502, 'NTFY', `ntfy answered HTTP ${res.status}`);
};

let http: NtfyHttp = realHttp;

export function setNtfyHttp(fake: NtfyHttp | null): () => void {
  const prev = http;
  http = fake ?? realHttp;
  return () => {
    http = prev;
  };
}

export async function sendNtfy(server: string, topic: string, msg: NtfyMessage): Promise<void> {
  const base = server.replace(/\/+$/, '') || 'https://ntfy.sh';
  if (!/^https:\/\//i.test(base)) throw new AppError(400, 'BAD_NTFY', 'The ntfy server must be https.');
  await http(`${base}/${encodeURIComponent(topic)}`, msg);
}
