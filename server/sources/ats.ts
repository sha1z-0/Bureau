import { getJson } from '../security/safeFetch.ts';

// Big companies publish hundreds of postings with full HTML in one response.
const ATS_FETCH = { maxBytes: 40 * 1024 * 1024, timeoutMs: 45_000 };
import { cleanHtml, maybeDecodeHtml } from '../security/sanitize.ts';
import type { Connector, RawJob } from './types.ts';
import { htmlToText, isRemote, num, pool, toIso } from './util.ts';

/**
 * Public ATS job-board APIs. These are the endpoints the companies' own career
 * pages are built on, published for exactly this kind of read access, and they
 * carry the freshest, most complete listings on the internet.
 */

interface GreenhouseJob {
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

export const greenhouse: Connector = {
  id: 'greenhouse',
  label: 'Greenhouse boards',
  kind: 'ats',
  homepage: 'https://boards.greenhouse.io',
  description: 'Direct company career boards hosted on Greenhouse (Anthropic, Stripe, Cloudflare, Discord…).',
  defaultEnabled: true,
  async run(ctx) {
    const results = await pool(ctx.boards.greenhouse, 5, async (token) => {
      const data = await getJson<{ jobs: GreenhouseJob[] }>(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true&pay_transparency=true`,
        ATS_FETCH,
      );
      return (data.jobs ?? []).map<RawJob>((j) => {
        const html = cleanHtml(maybeDecodeHtml(j.content ?? ''));
        const location = j.location?.name ?? '';
        const offices = (j.offices ?? []).map((o) => o.name);
        const locationType = (j.metadata ?? []).find((m) => /location type|workplace/i.test(m.name))?.value;
        const pay = j.pay_input_ranges?.[0];
        return {
          source: 'greenhouse',
          externalId: `${token}:${j.id}`,
          title: j.title,
          company: j.company_name ?? prettyCompany(token),
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
        };
      });
    });
    reportFailures(ctx.log, 'Greenhouse', ctx.boards.greenhouse, results);
    return results.flatMap((r) => r ?? []);
  },
};

interface LeverJob {
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
  salaryRange?: { min?: number; max?: number; currency?: string };
}

export const lever: Connector = {
  id: 'lever',
  label: 'Lever boards',
  kind: 'ats',
  homepage: 'https://jobs.lever.co',
  description: 'Company career boards hosted on Lever.',
  defaultEnabled: true,
  async run(ctx) {
    const results = await pool(ctx.boards.lever, 4, async (company) => {
      // Lever is slow and some boards are several MB, so read it in pages.
      const data: LeverJob[] = [];
      for (let skip = 0; skip < 600; skip += 100) {
        const page = await getJson<LeverJob[]>(
          `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json&limit=100&skip=${skip}`,
          ATS_FETCH,
        );
        if (!Array.isArray(page)) break;
        data.push(...page);
        if (page.length < 100) break;
      }
      return (Array.isArray(data) ? data : []).map<RawJob>((j) => {
        const sections = (j.lists ?? []).map((l) => `<h4>${l.text}</h4><ul>${l.content}</ul>`).join('');
        const html = cleanHtml(`${j.description ?? ''}${sections}${j.additional ?? ''}`);
        const location = j.categories?.location ?? j.categories?.allLocations?.join(', ') ?? '';
        return {
          source: 'lever',
          externalId: `${company}:${j.id}`,
          title: j.text,
          company: prettyCompany(company),
          location,
          remote: j.workplaceType === 'remote' || isRemote(location),
          url: j.hostedUrl,
          descriptionHtml: html,
          descriptionText: htmlToText(html),
          postedAt: toIso(j.createdAt),
          salaryMin: j.salaryRange?.min ?? null,
          salaryMax: j.salaryRange?.max ?? null,
          salaryCurrency: j.salaryRange?.currency ?? null,
          tags: [j.categories?.team, j.categories?.commitment].filter((t): t is string => !!t),
        };
      });
    });
    reportFailures(ctx.log, 'Lever', ctx.boards.lever, results);
    return results.flatMap((r) => r ?? []);
  },
};

interface AshbyJob {
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
    summaryComponents?: { compensationType?: string; minValue?: number; maxValue?: number; currencyCode?: string }[];
  };
}

export const ashby: Connector = {
  id: 'ashby',
  label: 'Ashby boards',
  kind: 'ats',
  homepage: 'https://jobs.ashbyhq.com',
  description: 'Company career boards hosted on Ashby (OpenAI, Notion, Linear, Ramp…).',
  defaultEnabled: true,
  async run(ctx) {
    const results = await pool(ctx.boards.ashby, 5, async (org) => {
      const data = await getJson<{ jobs: AshbyJob[] }>(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`,
        ATS_FETCH,
      );
      return (data.jobs ?? [])
        .filter((j) => j.isListed !== false)
        .map<RawJob>((j) => {
          const html = cleanHtml(j.descriptionHtml ?? '');
          const salary = j.compensation?.summaryComponents?.find((c) => c.compensationType === 'Salary');
          const location = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join(' · ');
          return {
            source: 'ashby',
            externalId: `${org}:${j.id}`,
            title: j.title,
            company: prettyCompany(org),
            location,
            remote: j.isRemote === true || j.workplaceType === 'Remote' || isRemote(location),
            url: j.jobUrl,
            descriptionHtml: html,
            descriptionText: htmlToText(html),
            postedAt: toIso(j.publishedAt),
            salaryMin: num(salary?.minValue),
            salaryMax: num(salary?.maxValue),
            salaryCurrency: salary?.currencyCode ?? null,
            tags: [j.department, j.team].filter((t): t is string => !!t),
          };
        });
    });
    reportFailures(ctx.log, 'Ashby', ctx.boards.ashby, results);
    return results.flatMap((r) => r ?? []);
  },
};

function prettyCompany(token: string): string {
  return token
    .replace(/[-_]+/g, ' ')
    .replace(/\b(inc|llc|hq|jobs|careers)\b/gi, '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function reportFailures(log: (m: string) => void, label: string, tokens: string[], results: unknown[]) {
  const failed = tokens.filter((_, i) => results[i] === null);
  if (failed.length) log(`${label}: ${failed.length} board(s) unreachable — ${failed.slice(0, 6).join(', ')}`);
}
