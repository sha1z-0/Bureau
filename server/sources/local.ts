import { cleanHtml, decodeEntities } from '../security/sanitize.ts';
import { relativePosted } from '../scout/normalize.ts';
import { getText } from './http.ts';
import type { Category, Connector, RawJob, SourceContext } from './types.ts';
import { htmlToText, isRemote, pool, toIso } from './util.ts';

/**
 * Local and Gulf boards, read from their public listing pages. robots.txt is
 * checked before every page (http.ts), requests are spaced ≥1.5 s per host,
 * and the User-Agent says Bureau. Verified 2026-11-02 (docs/SOURCES.md §19):
 *   - Rozee.pk: search pages embed the results as JSON (allowed by robots.txt).
 *   - Mustakbil: server-rendered category pages (allowed by robots.txt).
 *   - GulfTalent: search is behind a Cloudflare bot challenge → not used.
 *   - NaukriGulf: refused connections from this network → not used.
 *   - Bayt: through the JobSpy sidecar.
 */

const DEFAULT_TERMS: Record<Category, string> = {
  security: 'cyber security',
  web: 'web developer',
  mobile: 'mobile developer',
  game: 'game developer',
  data_ai: 'machine learning',
  devops_cloud: 'devops',
  software: 'software engineer',
};

export function searchTerms(ctx: SourceContext, max: number): string[] {
  const roles = (ctx.roles ?? []).map((r) => r.trim()).filter(Boolean);
  const fromCats = ctx.categories.map((c) => DEFAULT_TERMS[c]);
  return [...new Set([...roles, ...fromCats, 'software engineer'].map((t) => t.toLowerCase()))].slice(0, max);
}

// ── Rozee.pk ────────────────────────────────────────────────────────────────

export interface RozeeJob {
  jid: string;
  title: string;
  company_name?: string;
  company?: string;
  city?: string;
  city_exact?: string[];
  country?: string;
  description_raw?: string;
  description?: string;
  created_at?: string;
  applyBy?: string;
  permaLink?: string;
  rozeePermaLink?: string;
  type?: string;
  experience_text?: string;
  skills?: string[];
  whereFrom?: string;
  jobSource?: string;
  hideCompany?: string;
}

export function parseRozeePage(html: string, now = Date.now()): RawJob[] {
  const start = html.indexOf('var apResp = ');
  if (start < 0) return [];
  const end = html.indexOf(';\n', start);
  let data: { response?: { jobs?: { basic?: RozeeJob[]; sponsored?: RozeeJob[] } } };
  try {
    data = JSON.parse(html.slice(start + 'var apResp = '.length, end > 0 ? end : undefined));
  } catch {
    return [];
  }
  const jobs = [...(data.response?.jobs?.sponsored ?? []), ...(data.response?.jobs?.basic ?? [])];
  return jobs
    .filter((j) => !j.applyBy || Date.parse(j.applyBy) + 86_400_000 >= now)
    .map<RawJob>((j) => {
      const html = cleanHtml(j.description_raw ?? j.description ?? '');
      const city = j.city ?? j.city_exact?.join(', ') ?? '';
      const location = [city, j.country].filter(Boolean).join(', ');
      const company = j.hideCompany === 'Y' ? 'Confidential' : decodeEntities(j.company_name ?? j.company ?? 'Unknown');
      return {
        source: 'rozee',
        externalId: j.jid,
        title: decodeEntities(j.title),
        company,
        location,
        remote: isRemote(location, j.title, j.type),
        url: `https://www.rozee.pk/${j.rozeePermaLink ?? j.permaLink}`,
        descriptionHtml: html,
        descriptionText: htmlToText(html),
        postedAt: toIso(j.created_at),
        // Rozee hides salaries from public search results (salary*Hide fields); the normaliser mines the text instead.
        tags: [j.type, j.experience_text, ...(j.skills ?? []).slice(0, 6), j.whereFrom ? `via:${j.whereFrom}` : undefined].filter((t): t is string => !!t),
      };
    });
}

export const rozee: Connector = {
  id: 'rozee',
  label: 'Rozee.pk',
  kind: 'aggregator',
  homepage: 'https://www.rozee.pk',
  description: 'Pakistan’s largest job board, read from its public search pages (robots.txt checked, ~1 page per 1.5 s).',
  defaultEnabled: true,
  async run(ctx) {
    const urls = searchTerms(ctx, 4).flatMap((t) => [0, 20].map((fpn) => `https://www.rozee.pk/job/jsearch/q/${encodeURIComponent(t)}${fpn ? `/fpn/${fpn}` : ''}`));
    const pages = await pool(urls, 1, (u) => getText(u, { robots: true, accept: 'text/html', maxBytes: 4 * 1024 * 1024, timeoutMs: 45_000 }));
    if (pages.every((p) => p === null)) throw new Error('Rozee: every search page failed');
    return pages.flatMap((p) => (p ? parseRozeePage(p) : []));
  },
};

// ── Mustakbil ───────────────────────────────────────────────────────────────

const strip = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ').replace(/<!---->/g, '')).replace(/\s+/g, ' ').trim();

export function parseMustakbilPage(html: string, now = Date.now()): RawJob[] {
  const out: RawJob[] = [];
  const cards = html.split(/class="[^"]*\bjc-card\b[^"]*"/).slice(1);
  for (const card of cards) {
    const link = card.match(/class="jc-title__link"[^>]*href="(\/jobs\/job\/(\d+))"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const company = card.match(/class="jc-byline__name"[^>]*>([\s\S]*?)<\/span>/)?.[1];
    const place = card.match(/class="jc-byline__place"[^>]*>([\s\S]*?)<\/span><\/span>/)?.[1];
    const facts = [...card.matchAll(/class="jc-fact(?: [^"]*)?"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => strip(m[1])).filter(Boolean);
    const when = card.match(/jc-fact--time"[^>]*>([\s\S]*?)<\/span>/)?.[1];
    const desc = card.match(/class="jc-desc"[^>]*>([\s\S]*?)<\/p>/)?.[1];
    const location = place ? strip(place) : '';
    out.push({
      source: 'mustakbil',
      externalId: link[2],
      title: strip(link[3]),
      company: company ? strip(company) : 'Unknown',
      location,
      remote: isRemote(location, strip(link[3])),
      url: `https://www.mustakbil.com${link[1]}`,
      descriptionText: desc ? strip(desc) : '',
      descriptionHtml: '',
      postedAt: when ? relativePosted(strip(when), now) : null,
      tags: facts.filter((f) => !/ago$/.test(f)).slice(0, 5),
    });
  }
  return out;
}

const MUSTAKBIL_CATEGORIES = ['computer-software', 'information-technology', 'web-e-commerce'];

export const mustakbil: Connector = {
  id: 'mustakbil',
  label: 'Mustakbil',
  kind: 'aggregator',
  homepage: 'https://www.mustakbil.com',
  description: 'Pakistani job board: software, IT and web category pages (robots.txt checked, polite pacing).',
  defaultEnabled: true,
  async run() {
    const pages = await pool(MUSTAKBIL_CATEGORIES, 1, (c) =>
      getText(`https://www.mustakbil.com/jobs/pakistan/${c}`, { robots: true, accept: 'text/html', maxBytes: 4 * 1024 * 1024, timeoutMs: 45_000 }),
    );
    if (pages.every((p) => p === null)) throw new Error('Mustakbil: every category page failed');
    return pages.flatMap((p) => (p ? parseMustakbilPage(p) : []));
  },
};
