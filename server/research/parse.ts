import { z } from 'zod/v4';
import type { ResearchBrief } from '../contracts/research.ts';

/**
 * Turning Claude's research write-up into a ResearchBrief we can trust: find
 * the JSON, validate it leniently (a bad item is dropped, not the whole
 * brief), and keep only claims whose source URL we know was actually read —
 * a web-search result, one of the company pages we fetched, the company's own
 * domain, or the job posting. Old news is dropped.
 */

const Sourced = z.object({ text: z.string(), sourceUrl: z.string() });

/** What we ask Claude for (also the structured fallback's schema). */
export const ResearchDraftSchema = z.object({
  whatTheyBuild: z.string(),
  products: z.array(Sourced),
  recent: z.array(Sourced.extend({ date: z.string().nullable() })),
  techSignals: z.array(Sourced),
  values: z.array(Sourced),
  stage: z.string(),
  teamSize: z.string(),
  hiringContact: z.object({ name: z.string(), role: z.string(), sourceUrl: z.string() }).nullable(),
});
export type ResearchDraft = z.infer<typeof ResearchDraftSchema>;

/** The last ```json block, else the last balanced top-level {...} in the text. */
export function extractJson(text: string): unknown | null {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]).reverse();
  for (const block of fenced) {
    try {
      return JSON.parse(block);
    } catch {
      /* try the next */
    }
  }
  // Scan for balanced objects, string-aware, and keep the last one that parses.
  let found: unknown = null;
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1));
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            found = v;
            start = i;
          }
        } catch {
          /* not JSON */
        }
        break;
      }
    }
  }
  return found;
}

export function normUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|ref_src$|fbclid$|gclid$|mc_)/i.test(k)) u.searchParams.delete(k);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const p = u.pathname.replace(/\/+$/, '');
    return `${host}${p}${u.search}`;
  } catch {
    return null;
  }
}

export function onDomain(url: string, domain: string | null): boolean {
  if (!domain) return false;
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const d = domain.toLowerCase().replace(/^www\./, '');
    return h === d || h.endsWith(`.${d}`);
  } catch {
    return false;
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "2026-09-14", "2026-09", "September 2026", "Sep 14, 2026" → a Date (start of the period), else null. */
export function parseLooseDate(s: string | null): Date | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  let m = t.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1)));
  m = t.match(/\b([a-z]{3})[a-z]*\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})\b/);
  if (m && MONTHS.includes(m[1])) return new Date(Date.UTC(Number(m[3]), MONTHS.indexOf(m[1]), Number(m[2] ?? 1)));
  m = t.match(/\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[2])) return new Date(Date.UTC(Number(m[3]), MONTHS.indexOf(m[2]), Number(m[1])));
  m = t.match(/^(\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), 0, 1));
  return null;
}

export interface ParseContext {
  company: string;
  domain: string | null;
  /** Every URL that was really read: web-search results and fetched company pages. */
  readUrls: string[];
  postingUrl?: string | null;
  now: Date;
}

const SIX_MONTHS_MS = 183 * 86_400_000;
const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Validate a draft (from JSON or the structured fallback) into a brief whose every claim has a source we saw. */
export function finalizeBrief(raw: unknown, ctx: ParseContext): { brief: ResearchBrief; dropped: number } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const read = new Set(ctx.readUrls.map(normUrl).filter((u): u is string => !!u));
  const posting = ctx.postingUrl ? normUrl(ctx.postingUrl) : null;
  let dropped = 0;
  const known = (url: string) => {
    const n = normUrl(url);
    return !!n && (read.has(n) || n === posting || onDomain(url, ctx.domain));
  };
  const seen = new Set<string>();
  const sourced = (v: unknown, max: number) => {
    const out: { text: string; sourceUrl: string }[] = [];
    for (const item of Array.isArray(v) ? v : []) {
      const text = str((item as Record<string, unknown>)?.text);
      const sourceUrl = str((item as Record<string, unknown>)?.sourceUrl, 2000);
      if (!text) continue;
      if (!sourceUrl || !known(sourceUrl)) {
        dropped++;
        continue;
      }
      const key = text.toLowerCase().replace(/\W+/g, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key);
      if (out.length < max) out.push({ text, sourceUrl });
    }
    return out;
  };
  const recent: ResearchBrief['recent'] = [];
  for (const item of Array.isArray(obj.recent) ? obj.recent : []) {
    const [s] = sourced([item], 1);
    if (!s) continue;
    const date = str((item as Record<string, unknown>)?.date, 40) || null;
    const d = parseLooseDate(date);
    if (d && (ctx.now.getTime() - d.getTime() > SIX_MONTHS_MS || d.getTime() - ctx.now.getTime() > 31 * 86_400_000)) {
      dropped++;
      continue;
    }
    if (recent.length < 8) recent.push({ ...s, date });
  }
  let hiringContact: ResearchBrief['hiringContact'] = null;
  const hc = obj.hiringContact as Record<string, unknown> | null | undefined;
  if (hc && str(hc.name)) {
    const url = str(hc.sourceUrl, 2000);
    // Only someone named in the posting itself or on the company's own pages.
    if (url && (normUrl(url) === posting || onDomain(url, ctx.domain))) hiringContact = { name: str(hc.name, 120), role: str(hc.role, 160), sourceUrl: url };
    else dropped++;
  }
  const brief: ResearchBrief = {
    company: ctx.company,
    domain: ctx.domain,
    whatTheyBuild: str(obj.whatTheyBuild, 1200),
    products: sourced(obj.products, 8),
    recent,
    techSignals: sourced(obj.techSignals, 12),
    values: sourced(obj.values, 6),
    stage: str(obj.stage, 200) || 'unknown',
    teamSize: str(obj.teamSize, 200) || 'unknown',
    hiringContact,
    fetchedAt: ctx.now.toISOString(),
  };
  return { brief, dropped };
}

/** Parse a recorded or live research() response. Null when it holds no JSON at all (the caller falls back). */
export function parseResearch(text: string, ctx: ParseContext): { brief: ResearchBrief; dropped: number } | null {
  const raw = extractJson(text);
  return raw ? finalizeBrief(raw, ctx) : null;
}
