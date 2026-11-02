import { apiKey, research } from '../ai/claude.ts';
import type { Category } from '../sources/types.ts';
import { findAtsUrls } from './detect.ts';
import { addSignal, discoverUrls } from './registry.ts';
import { scoutSettings, scoutState, setScoutState } from './settings.ts';

/**
 * Registry discovery beyond passive URL parsing:
 *  - weekly Claude web search with `site:` queries per ATS, aimed at the
 *    campaign's categories; every ATS URL in the results joins the registry;
 *  - deep-scan research text is mined for careers URLs and funding news
 *    (funding → a hiring signal on that company).
 */

const ATS_SITES = [
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'jobs.lever.co',
  'jobs.ashbyhq.com',
  'apply.workable.com',
  'jobs.smartrecruiters.com',
  'myworkdayjobs.com',
  'recruitee.com',
  'jobs.personio.de',
  'teamtailor.com',
  'bamboohr.com/careers',
  'breezy.hr',
  'applytojob.com',
  'ats.rippling.com',
  'pinpointhq.com',
];

const CATEGORY_QUERY: Record<Category, string> = {
  security: '"security engineer" OR "application security" OR "SOC analyst"',
  web: '"frontend engineer" OR "full stack" OR "web developer"',
  mobile: '"iOS engineer" OR "Android engineer" OR "React Native"',
  game: '"gameplay programmer" OR "game developer" OR "Unity developer"',
  data_ai: '"machine learning engineer" OR "AI engineer" OR "data engineer"',
  devops_cloud: '"site reliability" OR "platform engineer" OR "DevOps engineer"',
  software: '"software engineer"',
};

const WEEK = 7 * 86_400_000;

export function discoveryDue(nowMs = Date.now()): boolean {
  const last = scoutState<string | null>('discovery.lastRun', null);
  return !last || nowMs - Date.parse(last) >= WEEK;
}

type ResearchFn = typeof research;

/** One discovery pass. `researchFn` is injectable for offline tests. */
export async function weeklyDiscovery(
  opts: { categories: Category[]; roles?: string[]; force?: boolean; log?: (m: string) => void },
  researchFn: ResearchFn = research,
): Promise<{ ran: boolean; reason?: string; urls: number; added: number }> {
  const log = opts.log ?? (() => {});
  if (!opts.force && !discoveryDue()) return { ran: false, reason: 'not due', urls: 0, added: 0 };
  if (!scoutSettings().discoveryEnabled && !opts.force) return { ran: false, reason: 'disabled in settings', urls: 0, added: 0 };
  if (researchFn === research && !apiKey() && process.env.BUREAU_REPLAY !== '1') return { ran: false, reason: 'no Anthropic API key', urls: 0, added: 0 };
  const cats = (opts.categories.length ? opts.categories : (['software'] as Category[])).slice(0, 4);
  const queries = cats.flatMap((c, i) => ATS_SITES.slice((i * 4) % ATS_SITES.length, ((i * 4) % ATS_SITES.length) + 5).map((s) => `site:${s} ${CATEGORY_QUERY[c]}`));
  const prompt = `Run these web searches and report every job-posting URL you see in the results, one per line, exactly as written. Do not invent URLs.\n${queries.map((q) => `- ${q}`).join('\n')}${
    opts.roles?.length ? `\nAlso search for open roles titled: ${opts.roles.slice(0, 5).join(', ')} on the same sites.` : ''
  }`;
  const res = await researchFn({
    task: 'scan',
    system: [{ type: 'text', text: 'You are a search assistant that lists job-board URLs found through web search. Report only URLs that appeared in search results.' }],
    prompt,
    maxSearches: Math.min(20, queries.length + 2),
  });
  const urls = [...res.sources.map((s) => s.url), ...findAtsUrls(res.text)];
  const added = discoverUrls(urls, 'weekly-search');
  setScoutState('discovery.lastRun', new Date().toISOString());
  log(`Discovery: ${urls.length} URLs from ${queries.length} site: searches, ${added} new company boards`);
  return { ran: true, urls: urls.length, added };
}

const FUNDING = /\b([A-Z][\w&.\- ]{1,40}?)\s+(?:has\s+|just\s+)?(?:raised|raises|closed|closes|announced|secures|secured)\s+(?:an?\s+)?(?:\$|€|£)\s?(\d[\d.,]*)\s*(m|mn|million|b|bn|billion)\b[^.\n]{0,60}?\b(seed|series [a-h]|pre-seed|growth round|funding)/gi;

/** Mine research text (deep scan) for careers URLs and funding news. Returns counts. */
export function mineResearch(text: string, sources: { url: string }[]): { boards: number; funding: number } {
  const boards = discoverUrls([...sources.map((s) => s.url), ...findAtsUrls(text)], 'deepscan');
  let funding = 0;
  for (const m of text.matchAll(FUNDING)) {
    const company = m[1].trim().replace(/^(the|and|as)\s+/i, '');
    if (company.length < 2 || /^(it|we|they|company|startup)$/i.test(company)) continue;
    addSignal(company, { type: 'funding', detail: `${m[0].trim().slice(0, 160)}` });
    funding++;
  }
  return { boards, funding };
}
