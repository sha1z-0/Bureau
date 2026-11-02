import { XMLParser } from 'fast-xml-parser';
import { cleanHtml, decodeEntities } from '../security/sanitize.ts';
import { parseSalaryText, annualise } from '../scout/normalize.ts';
import { getJson, getText } from './http.ts';
import type { Connector, RawJob } from './types.ts';
import { htmlToText, isRemote, pool, toIso, withinDays } from './util.ts';

/**
 * Niche, high-signal public feeds added in v2 (verified 2026-11-02, see
 * docs/SOURCES.md §18): 4dayweek.io, Python.org jobs, and Y Combinator startup
 * jobs (HN job stories + Work at a Startup's public listing pages).
 */

// ── 4dayweek.io ─────────────────────────────────────────────────────────────

export interface FourDayJob {
  id_str: string;
  title: string;
  url: string;
  description?: string;
  category?: string;
  role?: string;
  level?: string;
  is_remote?: boolean;
  location_original?: string;
  location_country?: string;
  posted?: number;
  company_name?: string;
  filters?: { label?: string }[];
}

export function parseFourDayWeek(data: { jobs?: FourDayJob[] }): RawJob[] {
  return (data.jobs ?? []).map<RawJob>((j) => ({
    source: 'fourdayweek',
    externalId: j.id_str,
    title: j.title,
    company: j.company_name || 'Unknown',
    location: j.location_original ?? j.location_country ?? (j.is_remote ? 'Remote' : ''),
    remote: !!j.is_remote,
    url: j.url,
    // Markdown already reads as plain text; keep it as the description.
    descriptionText: j.description ?? '',
    descriptionHtml: '',
    postedAt: toIso(j.posted),
    tags: ['4-day-week', j.category, j.role, j.level].filter((t): t is string => !!t),
  }));
}

export const fourdayweek: Connector = {
  id: 'fourdayweek',
  label: '4 Day Week',
  kind: 'aggregator',
  homepage: 'https://4dayweek.io',
  description: 'Jobs with a 4-day or reduced-hours week, from the public 4dayweek.io API (they ask for a link back).',
  defaultEnabled: true,
  async run(ctx) {
    const out: RawJob[] = [];
    for (let page = 1; page <= 8; page++) {
      const data = await getJson<{ jobs?: FourDayJob[]; has_more?: boolean }>(`https://4dayweek.io/api/v1?page=${page}`, { timeoutMs: 45_000, minIntervalMs: 800 });
      const jobs = parseFourDayWeek(data);
      out.push(...jobs);
      const last = jobs[jobs.length - 1];
      if (!data.has_more || !jobs.length || (last && !withinDays(last.postedAt, ctx.maxAgeDays))) break;
    }
    return out;
  },
};

// ── Python.org jobs (RSS) ───────────────────────────────────────────────────

const rss = new XMLParser({ ignoreAttributes: true, processEntities: true, parseTagValue: false });

export function parsePythonJobs(doc: string): RawJob[] {
  const items = [rss.parse(doc)?.rss?.channel?.item ?? []].flat() as Record<string, string>[];
  return items.map<RawJob>((it) => {
    const title = String(it.title ?? '');
    const cut = title.lastIndexOf(', ');
    const [location, ...rest] = String(it.description ?? '').split('\n');
    const html = cleanHtml(decodeEntities(rest.join('\n')));
    return {
      source: 'pythonjobs',
      externalId: String(it.guid ?? it.link),
      title: cut > 0 ? title.slice(0, cut) : title,
      company: cut > 0 ? title.slice(cut + 2) : 'Unknown',
      location: location.trim(),
      remote: isRemote(location, title),
      url: String(it.link),
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      postedAt: toIso(it.pubDate),
      tags: ['python'],
    };
  });
}

export const pythonjobs: Connector = {
  id: 'pythonjobs',
  label: 'Python.org jobs',
  kind: 'feed',
  homepage: 'https://www.python.org/jobs/',
  description: 'The Python Software Foundation job board RSS (about 20 fresh Python roles).',
  defaultEnabled: true,
  async run() {
    return parsePythonJobs(await getText('https://www.python.org/jobs/feed/rss/', { accept: 'application/rss+xml, text/xml' }));
  },
};

// ── Y Combinator startups ───────────────────────────────────────────────────

export interface HnItem {
  id: number;
  title?: string;
  url?: string;
  text?: string;
  time?: number;
  type?: string;
}

export interface WaasJob {
  id: number;
  title: string;
  jobType?: string;
  location?: string;
  roleType?: string;
  salary?: string;
  companyName: string;
  companySlug?: string;
  companyBatch?: string;
  companyOneLiner?: string;
}

/** "Wasmer (YC S19) Is Hiring OS/Hypervisor Experts in Europe" → company, role, place. */
export function parseHnJobTitle(title: string): { company: string; role: string; location: string } {
  const m = title.match(/^(.*?)\s*(\(YC [^)]+\))?\s+(?:is|are)\s+hiring\s+(?:an?\s+)?(.*)$/i);
  if (!m) return { company: title.split(/[–—:-]/)[0].trim(), role: title, location: '' };
  const tail = m[3].replace(/\.$/, '');
  const loc = tail.match(/\s+(?:in|–|-)\s+([A-Z][\w ,./-]+|remote.*)$/i);
  return { company: m[1].trim(), role: (loc ? tail.slice(0, loc.index) : tail).trim(), location: loc?.[1]?.trim() ?? '' };
}

export function hnItemToRaw(it: HnItem): RawJob | null {
  if (!it.title || it.type !== 'job') return null;
  const p = parseHnJobTitle(it.title);
  const html = cleanHtml(it.text ?? '');
  return {
    source: 'ycombinator',
    externalId: `hn:${it.id}`,
    title: p.role || it.title,
    company: p.company,
    location: p.location,
    remote: isRemote(it.title),
    url: it.url ?? `https://news.ycombinator.com/item?id=${it.id}`,
    descriptionHtml: html,
    descriptionText: htmlToText(html) || `${it.title}. A Y Combinator startup job posted on Hacker News.`,
    postedAt: toIso(it.time),
    tags: ['yc'],
  };
}

export function parseWaasPage(html: string): WaasJob[] {
  const m = html.match(/data-page="([^"]*)"/);
  if (!m) return [];
  try {
    const props = JSON.parse(decodeEntities(m[1])) as { props?: { jobs?: WaasJob[] } };
    return props.props?.jobs ?? [];
  } catch {
    return [];
  }
}

export function waasToRaw(j: WaasJob): RawJob {
  const salary = parseSalaryText(j.salary);
  return {
    source: 'ycombinator',
    externalId: `waas:${j.id}`,
    title: j.title,
    company: j.companyName,
    location: j.location ?? '',
    remote: isRemote(j.location),
    url: `https://www.workatastartup.com/jobs/${j.id}`,
    descriptionText: [
      `${j.title} at ${j.companyName}${j.companyBatch ? ` (YC ${j.companyBatch})` : ''}.`,
      j.companyOneLiner,
      [j.jobType, j.roleType, j.location, j.salary].filter(Boolean).join(' · '),
    ]
      .filter(Boolean)
      .join('\n'),
    descriptionHtml: '',
    postedAt: null,
    salaryMin: salary ? annualise(salary.min, salary.period) : null,
    salaryMax: salary ? annualise(salary.max, salary.period) : null,
    salaryCurrency: salary?.currency ?? null,
    tags: ['yc', j.companyBatch ? `yc-${j.companyBatch}` : '', j.roleType ?? ''].filter(Boolean),
  };
}

const WAAS_PAGES = ['software-engineer', 'software-engineer/full-stack', 'software-engineer/backend', 'software-engineer/frontend', 'software-engineer/machine-learning', 'software-engineer/devops', 'software-engineer/security'];

export const ycombinator: Connector = {
  id: 'ycombinator',
  label: 'Y Combinator startups',
  kind: 'community',
  homepage: 'https://www.workatastartup.com',
  description: 'YC startup roles: Hacker News job stories (official API) and Work at a Startup’s public listing pages. Applying on WAAS needs a YC account, so Bureau prefers each company’s own ATS when it can find it.',
  defaultEnabled: true,
  async run(ctx) {
    const ids = await getJson<number[]>('https://hacker-news.firebaseio.com/v0/jobstories.json');
    const items = await pool(ids.slice(0, 60), 4, (id) => getJson<HnItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`));
    const out = items.map((it) => (it ? hnItemToRaw(it) : null)).filter((j): j is RawJob => !!j);
    ctx.discover?.(out.map((j) => j.url), 'ycombinator');
    const pages = await pool(WAAS_PAGES, 1, (p) => getText(`https://www.workatastartup.com/jobs/l/${p}`, { robots: true, accept: 'text/html' }));
    const seen = new Set<number>();
    for (const html of pages) {
      for (const j of html ? parseWaasPage(html) : []) {
        if (seen.has(j.id)) continue;
        seen.add(j.id);
        out.push(waasToRaw(j));
      }
    }
    return out;
  },
};
