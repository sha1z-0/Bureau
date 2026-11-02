import { getJson } from './http.ts';
import { cleanHtml, maybeDecodeHtml } from '../security/sanitize.ts';
import type { CompanyTarget, Connector, RawJob } from './types.ts';
import { htmlToText, isRemote, num, pollBoards, prettyCompany, targetsFor, toIso } from './util.ts';

// Big companies publish hundreds of postings with full HTML in one response.
const ATS_FETCH = { maxBytes: 40 * 1024 * 1024, timeoutMs: 120_000 };

/**
 * Public ATS job-board APIs (Greenhouse, Lever, Ashby). These are the
 * endpoints the companies' own career pages are built on, published for
 * exactly this kind of read access, and they carry the freshest, most complete
 * listings on the internet. Boards come from Settings → Company boards plus the
 * company registry (which grows by itself through discovery).
 */

// ── Greenhouse ──────────────────────────────────────────────────────────────

export interface GreenhouseJob {
  id: number;
  title: string;
  updated_at?: string;
  first_published?: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  departments?: { name: string }[];
  offices?: { name: string }[];
  metadata?: { name: string; value: unknown }[] | null;
  pay_input_ranges?: { min_cents?: number; max_cents?: number; currency_type?: string }[];
  company_name?: string;
}

export function parseGreenhouse(data: { jobs?: GreenhouseJob[] }, target: CompanyTarget): RawJob[] {
  const eu = target.token.startsWith('eu:');
  const slug = eu ? target.token.slice(3) : target.token;
  return (data.jobs ?? []).map<RawJob>((j) => {
    const html = cleanHtml(maybeDecodeHtml(j.content ?? ''));
    const location = j.location?.name ?? '';
    const offices = (j.offices ?? []).map((o) => o.name);
    const locationType = (j.metadata ?? []).find((m) => /location type|workplace/i.test(m.name))?.value;
    const pay = j.pay_input_ranges?.[0];
    return {
      source: 'greenhouse',
      externalId: `${slug}:${j.id}`,
      title: j.title,
      company: j.company_name ?? target.name ?? prettyCompany(slug),
      location,
      remote: isRemote(location, ...offices, typeof locationType === 'string' ? locationType : ''),
      url: j.absolute_url,
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      postedAt: toIso(j.first_published ?? j.updated_at),
      salaryMin: pay?.min_cents ? pay.min_cents / 100 : null,
      salaryMax: pay?.max_cents ? pay.max_cents / 100 : null,
      salaryCurrency: pay?.currency_type ?? null,
      tags: (j.departments ?? []).map((d) => d.name),
      ats: 'greenhouse',
      applyUrl: `https://job-boards.${eu ? 'eu.' : ''}greenhouse.io/${slug}/jobs/${j.id}`,
      companyDomain: target.domain ?? null,
    };
  });
}

export const greenhouse: Connector = {
  id: 'greenhouse',
  label: 'Greenhouse boards',
  kind: 'ats',
  ats: 'greenhouse',
  homepage: 'https://boards.greenhouse.io',
  description: 'Direct company career boards hosted on Greenhouse (Anthropic, Stripe, Cloudflare, Discord…).',
  defaultEnabled: true,
  timeoutMs: 30 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'greenhouse', 'Greenhouse', targetsFor(ctx, 'greenhouse', ctx.boards.greenhouse), 5, async (t) => {
      const slug = t.token.replace(/^eu:/, '');
      const data = await getJson<{ jobs: GreenhouseJob[] }>(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true&pay_transparency=true`,
        ATS_FETCH,
      );
      const jobs = parseGreenhouse(data, t);
      return { jobs, count: data.jobs?.length ?? 0, name: data.jobs?.[0]?.company_name };
    });
  },
};

// ── Lever ───────────────────────────────────────────────────────────────────

export interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  description?: string;
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additional?: string;
  categories?: { location?: string; team?: string; commitment?: string; allLocations?: string[] };
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

export function parseLever(data: LeverJob[], target: CompanyTarget): RawJob[] {
  const slug = target.token.replace(/^eu:/, '');
  return (Array.isArray(data) ? data : []).map<RawJob>((j) => {
    const sections = (j.lists ?? []).map((l) => `<h4>${l.text}</h4><ul>${l.content}</ul>`).join('');
    const html = cleanHtml(`${j.description ?? ''}${sections}${j.additional ?? ''}`);
    const location = j.categories?.location ?? j.categories?.allLocations?.join(', ') ?? '';
    const hourly = /hour/i.test(j.salaryRange?.interval ?? '');
    return {
      source: 'lever',
      externalId: `${slug}:${j.id}`,
      title: j.text,
      company: target.name ?? prettyCompany(slug),
      location,
      remote: j.workplaceType === 'remote' || isRemote(location),
      url: j.hostedUrl,
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      postedAt: toIso(j.createdAt),
      salaryMin: j.salaryRange?.min ? j.salaryRange.min * (hourly ? 2080 : 1) : null,
      salaryMax: j.salaryRange?.max ? j.salaryRange.max * (hourly ? 2080 : 1) : null,
      salaryCurrency: j.salaryRange?.currency ?? null,
      tags: [j.categories?.team, j.categories?.commitment, j.workplaceType ? `mode:${j.workplaceType}` : undefined].filter((t): t is string => !!t),
      ats: 'lever',
      applyUrl: j.hostedUrl,
      companyDomain: target.domain ?? null,
    };
  });
}

export const lever: Connector = {
  id: 'lever',
  label: 'Lever boards',
  kind: 'ats',
  ats: 'lever',
  homepage: 'https://jobs.lever.co',
  description: 'Company career boards hosted on Lever (EU tenants included).',
  defaultEnabled: true,
  timeoutMs: 30 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'lever', 'Lever', targetsFor(ctx, 'lever', ctx.boards.lever), 4, async (t) => {
      const eu = t.token.startsWith('eu:');
      const slug = eu ? t.token.slice(3) : t.token;
      // Lever is slow and some boards are several MB, so read it in pages.
      const data: LeverJob[] = [];
      for (let skip = 0; skip < 1000; skip += 100) {
        const page = await getJson<LeverJob[]>(
          `https://api.${eu ? 'eu.' : ''}lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json&limit=100&skip=${skip}`,
          ATS_FETCH,
        );
        if (!Array.isArray(page)) break;
        data.push(...page);
        if (page.length < 100) break;
      }
      return { jobs: parseLever(data, t), count: data.length };
    });
  },
};

// ── Ashby ───────────────────────────────────────────────────────────────────

export interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location: string }[];
  department?: string;
  team?: string;
  isRemote?: boolean;
  workplaceType?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl: string;
  applyUrl?: string;
  isListed?: boolean;
  compensation?: {
    summaryComponents?: { compensationType?: string; interval?: string; minValue?: number; maxValue?: number; currencyCode?: string }[];
  };
}

export function parseAshby(data: { jobs?: AshbyJob[] }, target: CompanyTarget): RawJob[] {
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map<RawJob>((j) => {
      const html = cleanHtml(j.descriptionHtml ?? '');
      const salary = j.compensation?.summaryComponents?.find((c) => c.compensationType === 'Salary');
      const hourly = /hour/i.test(salary?.interval ?? '');
      const location = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join(' · ');
      const min = num(salary?.minValue);
      const max = num(salary?.maxValue);
      return {
        source: 'ashby',
        externalId: `${target.token}:${j.id}`,
        title: j.title,
        company: target.name ?? prettyCompany(target.token),
        location,
        remote: j.isRemote === true || j.workplaceType === 'Remote' || isRemote(location),
        url: j.jobUrl,
        descriptionHtml: html,
        descriptionText: htmlToText(html),
        postedAt: toIso(j.publishedAt),
        salaryMin: min ? min * (hourly ? 2080 : 1) : null,
        salaryMax: max ? max * (hourly ? 2080 : 1) : null,
        salaryCurrency: salary?.currencyCode ?? null,
        tags: [j.department, j.team, j.workplaceType ? `mode:${j.workplaceType.toLowerCase()}` : undefined].filter((t): t is string => !!t),
        ats: 'ashby',
        applyUrl: j.jobUrl,
        companyDomain: target.domain ?? null,
      };
    });
}

export const ashby: Connector = {
  id: 'ashby',
  label: 'Ashby boards',
  kind: 'ats',
  ats: 'ashby',
  homepage: 'https://jobs.ashbyhq.com',
  description: 'Company career boards hosted on Ashby (OpenAI, Notion, Linear, Ramp…).',
  defaultEnabled: true,
  timeoutMs: 30 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'ashby', 'Ashby', targetsFor(ctx, 'ashby', ctx.boards.ashby), 5, async (t) => {
      const data = await getJson<{ jobs: AshbyJob[] }>(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t.token)}?includeCompensation=true`,
        ATS_FETCH,
      );
      return { jobs: parseAshby(data, t), count: (data.jobs ?? []).filter((j) => j.isListed !== false).length };
    });
  },
};
