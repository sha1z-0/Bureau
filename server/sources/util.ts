import { htmlToText } from '../security/sanitize.ts';

export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isRemote(...hints: (string | undefined | null | boolean)[]): boolean {
  return hints.some((h) => h === true || (typeof h === 'string' && /remote|anywhere|worldwide|distributed/i.test(h)));
}

export function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.]/g, '')) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function firstEmail(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

export function withinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() <= days * 86_400_000;
}

/** Run tasks with a small concurrency cap; failures are reported, never thrown. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = text.toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

export { htmlToText };
