import { XMLParser } from 'fast-xml-parser';
import { getJson, getText } from './http.ts';
import { cleanHtml } from '../security/sanitize.ts';
import type { Connector, RawJob } from './types.ts';
import { firstEmail, htmlToText, isRemote, pool, toIso } from './util.ts';
import { detectAts, findAtsUrls } from '../scout/detect.ts';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', processEntities: true, cdataPropName: false });

type Item = Record<string, unknown>;

function items(doc: string): Item[] {
  const parsed = xml.parse(doc);
  return [parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? []].flat();
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'object' ? String((v as Item)['#text'] ?? '') : String(v));

/** Game studios hire in places the big boards miss. */
export const gamedev: Connector = {
  id: 'gamedev',
  label: 'Game dev boards',
  kind: 'feed',
  homepage: 'https://www.workwithindies.com',
  description: 'Indie and remote game studio roles from Work With Indies and Remote Game Jobs.',
  defaultEnabled: true,
  async run() {
    const [wwi, rgj] = await Promise.all([
      getText('https://workwithindies.com/careers/rss.xml', { accept: 'application/rss+xml, text/xml' }).catch(() => ''),
      getText('https://remotegamejobs.com/feed.rss', { accept: 'application/rss+xml, text/xml' }).catch(() => ''),
    ]);
    const out: RawJob[] = [];
    for (const it of wwi ? items(wwi) : []) {
      const title = str(it.title);
      const m = title.match(/^(.*?) is hiring (?:an? )?(.*?)(?: to work from (.*))?$/i);
      const text = htmlToText(str(it.description));
      out.push({
        source: 'gamedev',
        externalId: `wwi:${str(it.guid) || str(it.link)}`,
        title: m?.[2] ?? title,
        company: m?.[1] ?? 'Indie studio',
        location: m?.[3] ?? '',
        remote: isRemote(title, text) || !!m?.[3],
        url: str(it.link),
        descriptionText: text,
        descriptionHtml: '',
        postedAt: toIso(str(it.pubDate)),
        tags: ['game', ...[...text.matchAll(/\[([^\]]+)\]/g)].map((t) => t[1])].slice(0, 8),
      });
    }
    for (const it of rgj ? items(rgj) : []) {
      const title = str(it.title);
      const m = title.match(/^(.*?) is hiring (.*?)(?: \(Remote Job\))?$/i);
      out.push({
        source: 'gamedev',
        externalId: `rgj:${str(it.guid) || str(it.link)}`,
        title: m?.[2] ?? title,
        company: m?.[1] ?? 'Game studio',
        location: 'Remote',
        remote: true,
        url: str(it.link),
        descriptionText: htmlToText(str(it.description)),
        descriptionHtml: '',
        postedAt: toIso(str(it.pubDate)),
        tags: ['game'],
      });
    }
    // Feeds put the discipline in the title; make sure the classifier sees it's game work.
    return out.map((j) => (/game|unity|unreal|gameplay/i.test(j.title) ? j : { ...j, descriptionText: `Game studio role. ${j.descriptionText}` }));
  },
};

interface WorkingNomadsJob {
  url: string;
  title: string;
  description: string;
  company_name: string;
  category_name: string;
  tags: string;
  location: string;
  pub_date: string;
}

export const workingnomads: Connector = {
  id: 'workingnomads',
  label: 'Working Nomads',
  kind: 'aggregator',
  homepage: 'https://www.workingnomads.com',
  description: 'A small, curated feed of recent remote roles.',
  defaultEnabled: true,
  async run() {
    const data = await getJson<WorkingNomadsJob[]>('https://www.workingnomads.com/api/exposed_jobs/');
    return (Array.isArray(data) ? data : []).map<RawJob>((j) => {
      const html = cleanHtml(j.description ?? '');
      return {
        source: 'workingnomads',
        externalId: j.url.match(/go\/(\d+)/)?.[1] ?? j.url,
        title: j.title,
        company: j.company_name,
        location: j.location || 'Remote',
        remote: true,
        url: j.url,
        descriptionHtml: html,
        descriptionText: htmlToText(html),
        postedAt: toIso(j.pub_date),
        tags: [...(j.tags ?? '').split(','), j.category_name].map((t) => t.trim()).filter(Boolean),
      };
    });
  },
};

/** Two small boards whose RSS carries company, location and salary fields. */
export const nicheFeeds: Connector = {
  id: 'nichefeeds',
  label: 'Jobspresso & Larajobs',
  kind: 'feed',
  homepage: 'https://jobspresso.co',
  description: 'Hand-picked remote roles (Jobspresso) and PHP/Laravel roles (Larajobs), with salaries.',
  defaultEnabled: true,
  async run() {
    const feeds = await pool(
      [
        ['jobspresso', 'https://jobspresso.co/?feed=job_feed'],
        ['larajobs', 'https://larajobs.com/feed'],
      ] as const,
      2,
      async ([name, url]) => ({ name, list: items(await getText(url, { accept: 'application/rss+xml, text/xml' })) }),
    );
    return feeds.flatMap((f) =>
      (f?.list ?? []).map<RawJob>((it) => {
        const company = str(it['job_listing:company'] ?? it['job:company']) || 'Unknown';
        const location = str(it['job_listing:location'] ?? it['job:location']);
        const salary = str(it['job_listing:salary'] ?? it['job:salary']);
        const html = cleanHtml(str(it['content:encoded'] ?? it.description));
        const nums = [...salary.matchAll(/(\d[\d,.]*)\s*(k)?/gi)].map((m) => Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1)).filter((n) => n >= 1000);
        return {
          source: f!.name,
          externalId: str(it.guid) || str(it.link),
          title: str(it.title),
          company,
          location: location || 'Remote',
          remote: isRemote(location) || f!.name === 'jobspresso',
          url: str(it.link),
          descriptionHtml: html,
          descriptionText: htmlToText(html) || `${str(it.title)} at ${company}. ${str(it['job:tags'])}`,
          postedAt: toIso(str(it.pubDate)),
          salaryMin: nums.length ? Math.min(...nums) : null,
          salaryMax: nums.length ? Math.max(...nums) : null,
          salaryCurrency: nums.length ? (/€/.test(salary) ? 'EUR' : /£/.test(salary) ? 'GBP' : 'USD') : null,
          tags: str(it['job:tags']).split(',').map((t) => t.trim()).filter(Boolean),
        };
      }),
    );
  },
};

interface SimplifyRow {
  id: string;
  company_name: string;
  title: string;
  url: string;
  locations: string[];
  date_posted: number;
  active: boolean;
  is_visible: boolean;
  category?: string;
  sponsorship?: string;
}

/** Thousands of new-grad roles, maintained daily on GitHub. Off by default; switch on if you're early-career. */
export const simplify: Connector = {
  id: 'simplify',
  label: 'New-grad lists (GitHub)',
  kind: 'community',
  homepage: 'https://github.com/SimplifyJobs/New-Grad-Positions',
  description: 'The community-maintained SimplifyJobs new-grad list: direct ATS links, no descriptions. Best for entry-level hunts.',
  defaultEnabled: false,
  async run(ctx) {
    const rows = await getJson<SimplifyRow[]>('https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json', {
      maxBytes: 60 * 1024 * 1024,
      timeoutMs: 300_000,
    });
    // Every row (open or closed) names a company's ATS board: feed them all to registry discovery.
    ctx.discover?.(rows.map((r) => r.url).filter(Boolean), 'simplify');
    const cutoff = Date.now() / 1000 - ctx.maxAgeDays * 86_400;
    return rows
      .filter((r) => r.active && r.is_visible && r.date_posted >= cutoff)
      .map<RawJob>((r) => ({
        source: 'simplify',
        externalId: r.id,
        title: r.title,
        company: r.company_name,
        location: (r.locations ?? []).join('; '),
        remote: (r.locations ?? []).some((l) => /remote/i.test(l)),
        url: r.url,
        descriptionText: `${r.title} at ${r.company_name}. New-grad role (${r.category ?? 'Software'}). Sponsorship: ${r.sponsorship ?? 'unknown'}. Locations: ${(r.locations ?? []).join(', ')}.`,
        descriptionHtml: '',
        postedAt: toIso(r.date_posted),
        tags: ['new-grad', r.category ?? '', r.sponsorship ?? ''].filter(Boolean),
        applyUrl: r.url,
      }));
  },
};

const SUBREDDITS = ['forhire', 'remotejs', 'cybersecurityjobs', 'gameDevClassifieds'];

/**
 * Reddit closed its anonymous JSON API, but subreddit RSS still works when read
 * slowly. Bureau reads one subreddit every ~11 seconds to stay polite.
 */
export const reddit: Connector = {
  id: 'reddit',
  label: 'Reddit hiring subs',
  kind: 'community',
  homepage: 'https://www.reddit.com',
  description: '[HIRING] posts from r/forhire, r/remotejs, r/cybersecurityjobs and r/gameDevClassifieds via RSS, read slowly to respect Reddit.',
  defaultEnabled: true,
  async run(ctx) {
    const out: RawJob[] = [];
    for (const [i, sub] of SUBREDDITS.entries()) {
      if (i) await new Promise((r) => setTimeout(r, 11_000));
      const doc = await getText(`https://www.reddit.com/r/${sub}/new/.rss`, {
        accept: 'application/atom+xml, application/xml',
        headers: { 'user-agent': 'desktop:bureau-jobhunt:1.0 (personal job search; low volume)' },
      }).catch(() => null);
      if (!doc) {
        ctx.log(`Reddit: r/${sub} is throttled right now, skipping`);
        continue;
      }
      for (const e of items(doc)) {
        const title = str(e.title);
        if (/\[for hire\]/i.test(title) || !/\[hiring\]|hiring|looking for/i.test(title)) continue;
        const link = (e.link as Item)?.['@href'] as string | undefined;
        const html = cleanHtml(str(e.content));
        const text = htmlToText(html);
        out.push({
          source: 'reddit',
          externalId: str(e.id),
          title: title.replace(/\[(hiring|remote|onsite|hybrid|paid|task)\]/gi, '').trim().slice(0, 140) || 'Hiring post',
          company: `${str((e.author as Item)?.name) || 'u/unknown'} · r/${sub}`,
          location: isRemote(title, text) ? 'Remote' : '',
          remote: isRemote(title, text),
          url: link ?? `https://www.reddit.com/r/${sub}`,
          descriptionHtml: html,
          descriptionText: text,
          postedAt: toIso(str(e.published)),
          tags: [`r/${sub}`],
          applyEmail: firstEmail(text),
          applyUrl: findAtsUrls(html).find((u) => detectAts(u)?.jobId) ?? null,
        });
        ctx.discover?.(findAtsUrls(html), 'reddit');
      }
    }
    return out;
  },
};
