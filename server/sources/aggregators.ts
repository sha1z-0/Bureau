import { XMLParser } from 'fast-xml-parser';
import { getJson, getText } from './http.ts';
import { cleanHtml } from '../security/sanitize.ts';
import type { Category, Connector, RawJob } from './types.ts';
import { htmlToText, isRemote, num, pool, toIso } from './util.ts';

/** Remote-job aggregators with free, keyless public APIs. Each asks for a link back; we always keep the source URL. */

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

export const remotive: Connector = {
  id: 'remotive',
  label: 'Remotive',
  kind: 'aggregator',
  homepage: 'https://remotive.com',
  description: 'Curated remote jobs. The free feed is small and 24h delayed; Remotive allows ~4 reads a day.',
  defaultEnabled: true,
  async run() {
    const data = await getJson<{ jobs: RemotiveJob[] }>('https://remotive.com/api/remote-jobs?category=software-development');
    return (data.jobs ?? [])
      .map<RawJob>((j) => {
        const html = cleanHtml(j.description ?? '');
        return {
          source: 'remotive',
          externalId: String(j.id),
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location || 'Remote',
          remote: true,
          url: j.url,
          descriptionHtml: html,
          descriptionText: htmlToText(html),
          postedAt: toIso(j.publication_date),
          tags: j.tags ?? [],
          ...parseSalaryText(j.salary),
        };
      });
  },
};

interface RemoteOkJob {
  id?: string;
  slug?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
  apply_url?: string;
  legal?: string;
}

export const remoteok: Connector = {
  id: 'remoteok',
  label: 'Remote OK',
  kind: 'aggregator',
  homepage: 'https://remoteok.com',
  description: 'Large remote job board. Their terms require a visible link back to Remote OK, which Bureau keeps.',
  defaultEnabled: true,
  async run() {
    const data = await getJson<RemoteOkJob[]>('https://remoteok.com/api');
    return data
      .filter((j) => j.position && j.company && !j.legal)
      .map<RawJob>((j) => {
        const html = cleanHtml(j.description ?? '');
        return {
          source: 'remoteok',
          externalId: String(j.id ?? j.slug),
          title: j.position!,
          company: j.company!,
          location: j.location || 'Remote',
          remote: true,
          url: j.url ?? `https://remoteok.com/remote-jobs/${j.slug}`,
          descriptionHtml: html,
          descriptionText: htmlToText(html),
          postedAt: toIso(j.date ?? j.epoch),
          salaryMin: num(j.salary_min),
          salaryMax: num(j.salary_max),
          salaryCurrency: j.salary_min ? 'USD' : null,
          tags: j.tags ?? [],
          applyUrl: j.apply_url && /^https?:/.test(j.apply_url) ? j.apply_url : null,
        };
      });
  },
};

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags?: string[];
  location?: string;
  created_at?: number;
}

export const arbeitnow: Connector = {
  id: 'arbeitnow',
  label: 'Arbeitnow',
  kind: 'aggregator',
  homepage: 'https://www.arbeitnow.com',
  description: 'European tech jobs (many visa-sponsoring) from ATS feeds.',
  defaultEnabled: true,
  async run() {
    const pages = await pool([1, 2, 3], 3, (page) =>
      getJson<{ data: ArbeitnowJob[] }>(`https://www.arbeitnow.com/api/job-board-api?page=${page}`),
    );
    return pages
      .flatMap((p) => p?.data ?? [])
      .map<RawJob>((j) => {
        const html = cleanHtml(j.description ?? '');
        return {
          source: 'arbeitnow',
          externalId: j.slug,
          title: j.title,
          company: j.company_name,
          location: j.location ?? '',
          remote: j.remote || isRemote(j.location),
          url: j.url,
          descriptionHtml: html,
          descriptionText: htmlToText(html),
          postedAt: toIso(j.created_at),
          tags: j.tags ?? [],
        };
      });
  },
};

interface HimalayasJob {
  title: string;
  excerpt?: string;
  companyName: string;
  minSalary?: number;
  maxSalary?: number;
  currency?: string;
  salaryCurrency?: string;
  locationRestrictions?: string[];
  categories?: string[];
  description?: string;
  pubDate?: number | string;
  applicationLink?: string;
  guid?: string;
}

const HIMALAYAS_QUERIES: Record<Category, string> = {
  security: 'security engineer',
  web: 'frontend',
  mobile: 'mobile developer',
  game: 'game developer',
  data_ai: 'machine learning',
  devops_cloud: 'devops',
  software: 'software engineer',
};

export const himalayas: Connector = {
  id: 'himalayas',
  label: 'Himalayas',
  kind: 'aggregator',
  homepage: 'https://himalayas.app',
  description: 'Remote jobs with salary data and timezone restrictions. Apply links are kept exactly as Himalayas gives them.',
  defaultEnabled: true,
  async run(ctx) {
    const jobs: HimalayasJob[] = [];
    // Newest listings first, following the cursor…
    let cursor = '';
    for (let page = 0; page < 4; page++) {
      const res = await getJson<{ jobs: HimalayasJob[]; nextCursor?: string }>(
        `https://himalayas.app/jobs/api?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ).catch(() => null);
      if (!res) break;
      jobs.push(...(res.jobs ?? []));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    // …then a targeted search per discipline the candidate hunts in.
    const queries = [...new Set(ctx.categories.map((c) => HIMALAYAS_QUERIES[c]))].slice(0, 4);
    for (const q of queries) {
      for (const page of [1, 2]) {
        const res = await getJson<{ jobs: HimalayasJob[] }>(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&page=${page}`).catch(() => null);
        jobs.push(...(res?.jobs ?? []));
      }
    }
    return jobs.map<RawJob>((j) => {
      const html = cleanHtml(j.description ?? j.excerpt ?? '');
      const location = j.locationRestrictions?.length ? j.locationRestrictions.join(', ') : 'Remote · Worldwide';
      return {
        source: 'himalayas',
        externalId: j.guid ?? j.applicationLink ?? `${j.companyName}:${j.title}`,
        title: j.title,
        company: j.companyName,
        location,
        remote: true,
        url: j.applicationLink ?? j.guid ?? 'https://himalayas.app/jobs',
        descriptionHtml: html,
        descriptionText: htmlToText(html),
        postedAt: toIso(j.pubDate),
        salaryMin: num(j.minSalary),
        salaryMax: num(j.maxSalary),
        salaryCurrency: j.currency ?? j.salaryCurrency ?? null,
        tags: j.categories ?? [],
        applyUrl: j.applicationLink ?? null,
      };
    });
  },
};

const JOBICY_TAGS: Record<Category, string[]> = {
  security: ['security', 'cybersecurity'],
  web: ['react', 'javascript', 'python', 'php'],
  mobile: ['ios', 'android', 'flutter'],
  game: ['unity', 'game'],
  data_ai: ['machine-learning', 'data'],
  devops_cloud: ['devops', 'aws', 'kubernetes'],
  software: ['developer'],
};

interface JobicyJob {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobIndustry?: string[];
  jobType?: string[];
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  annualSalaryMin?: number | string;
  annualSalaryMax?: number | string;
  salaryCurrency?: string;
}

export const jobicy: Connector = {
  id: 'jobicy',
  label: 'Jobicy',
  kind: 'aggregator',
  homepage: 'https://jobicy.com',
  description: 'Remote jobs by tag. Free API; please link back to Jobicy.',
  defaultEnabled: true,
  async run(ctx) {
    const tags = [...new Set(ctx.categories.flatMap((c) => JOBICY_TAGS[c] ?? []))].slice(0, 8);
    const urls = (tags.length ? tags : ['developer']).map((tag) => `https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`);
    if (ctx.categories.includes('security')) urls.push('https://jobicy.com/api/v2/remote-jobs?count=50&industry=cybersecurity');
    const pages = await pool(urls, 2, (url) => getJson<{ jobs?: JobicyJob[] }>(url));
    return pages
      .flatMap((p) => p?.jobs ?? [])
      .map<RawJob>((j) => {
        const html = cleanHtml(j.jobDescription ?? j.jobExcerpt ?? '');
        return {
          source: 'jobicy',
          externalId: String(j.id),
          title: decode(j.jobTitle),
          company: decode(j.companyName),
          location: j.jobGeo ?? 'Remote',
          remote: true,
          url: j.url,
          descriptionHtml: html,
          descriptionText: htmlToText(html),
          postedAt: toIso(j.pubDate),
          salaryMin: num(j.annualSalaryMin),
          salaryMax: num(j.annualSalaryMax),
          salaryCurrency: j.salaryCurrency ?? null,
          tags: [...(j.jobIndustry ?? []), ...(j.jobType ?? []), j.jobLevel ?? ''].filter(Boolean).map(decode),
        };
      });
  },
};

interface MuseJob {
  id: number;
  name: string;
  contents?: string;
  publication_date?: string;
  locations?: { name: string }[];
  levels?: { name: string }[];
  company?: { name: string };
  refs?: { landing_page?: string };
}

export const themuse: Connector = {
  id: 'themuse',
  label: 'The Muse',
  kind: 'aggregator',
  homepage: 'https://www.themuse.com',
  description: 'Mid-to-large company listings across software, data and IT.',
  defaultEnabled: true,
  async run() {
    const queries = ['Software%20Engineering', 'Data%20and%20Analytics', 'IT'];
    const pages = await pool(
      queries.flatMap((q) => [1, 2].map((p) => `https://www.themuse.com/api/public/jobs?category=${q}&page=${p}`)),
      3,
      (url) => getJson<{ results: MuseJob[] }>(url),
    );
    return pages
      .flatMap((p) => p?.results ?? [])
      .map<RawJob>((j) => {
        const html = cleanHtml(j.contents ?? '');
        const location = (j.locations ?? []).map((l) => l.name).join(' · ');
        return {
          source: 'themuse',
          externalId: String(j.id),
          title: j.name,
          company: j.company?.name ?? 'Unknown',
          location,
          remote: isRemote(location),
          url: j.refs?.landing_page ?? `https://www.themuse.com/jobs/${j.id}`,
          descriptionHtml: html,
          descriptionText: htmlToText(html),
          postedAt: toIso(j.publication_date),
          tags: (j.levels ?? []).map((l) => l.name),
        };
      });
  },
};

const WWR_FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
];

interface RssItem {
  title?: string;
  link?: string;
  guid?: string | { '#text': string };
  pubDate?: string;
  description?: string;
  region?: string;
  category?: string;
}

export const weworkremotely: Connector = {
  id: 'weworkremotely',
  label: 'We Work Remotely',
  kind: 'feed',
  homepage: 'https://weworkremotely.com',
  description: 'Remote programming and DevOps listings via public RSS.',
  defaultEnabled: true,
  async run() {
    const parser = new XMLParser({ ignoreAttributes: true, processEntities: true });
    const feeds = await pool(WWR_FEEDS, 3, (url) => getText(url, { accept: 'application/rss+xml, text/xml' }));
    return feeds.flatMap((xml) => {
      if (!xml) return [];
      const items: RssItem[] = [parser.parse(xml)?.rss?.channel?.item ?? []].flat();
      return items.map<RawJob>((it) => {
        const [company, ...rest] = String(it.title ?? '').split(':');
        const html = cleanHtml(String(it.description ?? ''));
        const guid = typeof it.guid === 'object' ? it.guid['#text'] : it.guid;
        return {
          source: 'weworkremotely',
          externalId: String(guid ?? it.link),
          title: rest.join(':').trim() || company.trim(),
          company: rest.length ? company.trim() : 'Unknown',
          location: it.region ? String(it.region) : 'Remote',
          remote: true,
          url: String(it.link ?? guid),
          descriptionHtml: html,
          descriptionText: htmlToText(html),
          postedAt: toIso(it.pubDate),
          tags: it.category ? [String(it.category)] : [],
        };
      });
    });
  },
};

function decode(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&#8211;/g, '–').replace(/&#039;|&#39;/g, "'");
}

function parseSalaryText(text?: string): Pick<RawJob, 'salaryMin' | 'salaryMax' | 'salaryCurrency'> {
  if (!text) return {};
  const nums = [...text.matchAll(/(\d[\d,.]*)\s*(k)?/gi)]
    .map((m) => Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1))
    .filter((n) => n >= 1000);
  if (!nums.length) return {};
  const currency = /€|eur/i.test(text) ? 'EUR' : /£|gbp/i.test(text) ? 'GBP' : 'USD';
  return { salaryMin: Math.min(...nums), salaryMax: Math.max(...nums), salaryCurrency: currency };
}
