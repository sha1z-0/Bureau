import type { AtsFamily } from '../contracts/job.ts';
import { workdayParts } from '../scout/detect.ts';
import { ashby, greenhouse, lever } from './ats.ts';
import { MORE_ATS } from './atsMore.ts';
import { getJson, HttpError, postJson } from './http.ts';
import type { Connector, SourceContext } from './types.ts';

/**
 * Look up one company's open postings on its ATS, for the resolver: titles,
 * locations and the employer's own apply URL, nothing else. Uses the same
 * public board APIs the connectors poll, in their lightest form (no
 * descriptions where the API allows it, a title search where the board is
 * huge: Workday and SmartRecruiters). Every request goes through
 * sources/http.ts (per-host spacing, SSRF-guarded safeFetch).
 *
 * Returns null when the board does not exist (404/410), so callers can tell a
 * wrong slug guess from a board that merely has no matching role. Board
 * listings are cached in memory for an hour; title searches per (board, title).
 */

export interface BoardPosting {
  title: string;
  url: string;
  location: string;
}

const LIGHT = { maxBytes: 12 * 1024 * 1024, timeoutMs: 30_000 };
const TTL = 3_600_000;
const cache = new Map<string, { at: number; value: Promise<BoardPosting[] | null> }>();

export function clearBoardCache() {
  cache.clear();
  coolingUntil.clear();
}

/** The ATS families the resolver can search. */
export function searchableAts(ats: AtsFamily): boolean {
  return ats in LISTERS || CONNECTOR_FAMILIES.has(ats);
}

const notFound = (err: unknown) => err instanceof HttpError && (err.status === 404 || err.status === 410);

type Lister = (token: string, title: string) => Promise<BoardPosting[] | null>;

const LISTERS: Partial<Record<AtsFamily, Lister>> = {
  async greenhouse(token) {
    const eu = token.startsWith('eu:');
    const slug = eu ? token.slice(3) : token;
    const data = await getJson<{ jobs?: { id: number; title: string; location?: { name?: string } }[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`,
      LIGHT,
    );
    return (data.jobs ?? []).map((j) => ({ title: j.title, location: j.location?.name ?? '', url: `https://job-boards.${eu ? 'eu.' : ''}greenhouse.io/${slug}/jobs/${j.id}` }));
  },
  async lever(token) {
    const eu = token.startsWith('eu:');
    const slug = eu ? token.slice(3) : token;
    const data = await getJson<{ text: string; hostedUrl: string; categories?: { location?: string } }[]>(
      `https://api.${eu ? 'eu.' : ''}lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
      LIGHT,
    );
    return (Array.isArray(data) ? data : []).map((j) => ({ title: j.text, location: j.categories?.location ?? '', url: j.hostedUrl }));
  },
  async ashby(token) {
    const data = await getJson<{ jobs?: { title: string; jobUrl: string; location?: string; isListed?: boolean }[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
      LIGHT,
    );
    return (data.jobs ?? []).filter((j) => j.isListed !== false).map((j) => ({ title: j.title, location: j.location ?? '', url: j.jobUrl }));
  },
  async workable(token) {
    const data = await getJson<{ name?: string; jobs?: { title: string; shortcode: string; city?: string; country?: string }[] }>(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}`,
      { ...LIGHT, minIntervalMs: 1500 },
    );
    // The widget answers 200 with an empty, nameless account for any slug: that is "no such board".
    if (!data.name && !data.jobs?.length) return null;
    return (data.jobs ?? []).map((j) => ({ title: j.title, location: [j.city, j.country].filter(Boolean).join(', '), url: `https://apply.workable.com/${token}/j/${j.shortcode}` }));
  },
  async smartrecruiters(token, title) {
    const data = await getJson<{ content?: { id: string; name: string; location?: { city?: string; country?: string } }[] }>(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100&q=${encodeURIComponent(title)}`,
      LIGHT,
    );
    return (data.content ?? []).map((p) => ({ title: p.name, location: [p.location?.city, p.location?.country].filter(Boolean).join(', '), url: `https://jobs.smartrecruiters.com/${token}/${p.id}` }));
  },
  async workday(token, title) {
    const wp = workdayParts(token);
    if (!wp) return [];
    const res = await postJson<{ jobPostings?: { title: string; externalPath: string; locationsText?: string }[] }>(
      `${wp.apiBase}/jobs`,
      { appliedFacets: {}, limit: 20, offset: 0, searchText: title },
      { timeoutMs: 45_000, minIntervalMs: 400 },
    );
    return (res.jobPostings ?? []).map((i) => ({ title: i.title, location: i.locationsText ?? '', url: `${wp.boardUrl}${i.externalPath}` }));
  },
};

/** Families searched by asking their connector for one board, with every posting treated as known (no detail requests). */
const CONNECTOR_FAMILIES = new Map<AtsFamily, Connector>(
  [greenhouse, lever, ashby, ...MORE_ATS].filter((c) => c.ats && !(c.ats in LISTERS)).map((c) => [c.ats!, c] as const),
);

async function viaConnector(c: Connector, token: string): Promise<BoardPosting[] | null> {
  let status: number | undefined;
  const ctx: SourceContext = {
    keywords: [],
    categories: ['software', 'security', 'web', 'mobile', 'game', 'data_ai', 'devops_cloud'],
    boards: { greenhouse: [], lever: [], ashby: [] },
    maxAgeDays: 3650,
    log: () => {},
    targets: () => [{ companyId: null, name: null, token }],
    reportBoard: (_ats, _token, r) => {
      if (!r.ok) status = r.status;
    },
    isKnown: () => true,
    detailBudget: 0,
    detailTotal: { left: 0 },
    workdayPages: 1,
  };
  try {
    const jobs = await c.run(ctx);
    return jobs.map((j) => ({ title: j.title, location: j.location ?? '', url: j.applyUrl ?? j.url }));
  } catch (err) {
    if (status === 404 || status === 410) return null;
    throw err;
  }
}

/** An ATS that answered 429 is left alone for a while (every later lookup on it fails fast, uncached). */
const COOL_OFF = 15 * 60_000;
const coolingUntil = new Map<AtsFamily, number>();

export class BoardRateLimited extends Error {
  constructor(ats: AtsFamily) {
    super(`${ats} is rate-limiting board lookups; cooling off`);
    this.name = 'BoardRateLimited';
  }
}

/** Postings on one board (title-searched where the ATS supports it). Null when the board doesn't exist. */
export function searchBoard(ats: AtsFamily, token: string, title: string): Promise<BoardPosting[] | null> {
  if ((coolingUntil.get(ats) ?? 0) > Date.now()) return Promise.reject(new BoardRateLimited(ats));
  const lister = LISTERS[ats];
  const searched = ats === 'workday' || ats === 'smartrecruiters';
  const key = `${ats}|${token.toLowerCase()}${searched ? `|${title.toLowerCase()}` : ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = (async (): Promise<BoardPosting[] | null> => {
    if (lister) {
      try {
        return await lister(token, title);
      } catch (err) {
        if (notFound(err)) return null;
        if (err instanceof HttpError && err.status === 429) coolingUntil.set(ats, Date.now() + COOL_OFF);
        throw err;
      }
    }
    const c = CONNECTOR_FAMILIES.get(ats);
    return c ? viaConnector(c, token) : [];
  })();
  cache.set(key, { at: Date.now(), value });
  // A transient failure must not be remembered for an hour.
  value.catch(() => cache.delete(key));
  return value;
}
