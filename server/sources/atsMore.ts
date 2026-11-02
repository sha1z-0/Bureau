import { XMLParser } from 'fast-xml-parser';
import { cleanHtml, decodeEntities } from '../security/sanitize.ts';
import { categorize } from '../services/classify.ts';
import { annualise, parseSalaryText, relativePosted } from '../scout/normalize.ts';
import { workdayParts } from '../scout/detect.ts';
import { getJson, getText, postJson } from './http.ts';
import type { CompanyTarget, Connector, RawJob, SourceContext } from './types.ts';
import { htmlToText, isRemote, num, pollBoards, pool, prettyCompany, targetsFor, toIso, withinDays } from './util.ts';

/**
 * Per-company ATS connectors beyond Greenhouse/Lever/Ashby. Every endpoint here
 * is the public, unauthenticated feed the company's own careers page reads,
 * verified live on 2026-11-02 (see docs/SOURCES.md §17). Boards come from the
 * company registry, which grows through discovery.
 *
 * Each family exports a pure `parseX()` used by the connector and by the
 * offline parser tests (fixtures/feeds/<connector>-*.json|xml).
 */

const BIG = { maxBytes: 30 * 1024 * 1024, timeoutMs: 90_000 };
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', processEntities: true, parseTagValue: false, trimValues: true });
const arr = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'object' ? String((v as Record<string, unknown>)['#text'] ?? '') : String(v));

/** Only spend detail requests on postings that look like tech roles. */
function relevant(title: string): boolean {
  return categorize({ title, tags: [], descriptionText: '' }) !== null;
}

/**
 * For ATSs whose list has no description: fetch details for relevant, fresh,
 * not-yet-stored postings (up to the budget). Postings already stored come back
 * as a minimal record so their "last seen" stays current without a request.
 */
async function withDetails<T>(
  ctx: SourceContext,
  items: T[],
  o: {
    url: (t: T) => string;
    title: (t: T) => string;
    postedAt: (t: T) => string | null;
    minimal: (t: T) => RawJob;
    detail: (t: T) => Promise<RawJob>;
    concurrency?: number;
  },
): Promise<RawJob[]> {
  let budget = ctx.detailBudget ?? 40;
  const todo: T[] = [];
  const out: RawJob[] = [];
  for (const it of items) {
    if (!relevant(o.title(it)) || !withinDays(o.postedAt(it), ctx.maxAgeDays)) continue;
    if (ctx.isKnown?.(o.url(it))) out.push(o.minimal(it));
    else if (budget-- > 0) todo.push(it);
  }
  const details = await pool(todo, o.concurrency ?? 3, async (it) => {
    try {
      return await o.detail(it);
    } catch {
      return o.minimal(it);
    }
  });
  return [...out, ...details.filter((d): d is RawJob => !!d)];
}

// ── SmartRecruiters ─────────────────────────────────────────────────────────

export interface SmartRecruitersPosting {
  id: string;
  name: string;
  releasedDate?: string;
  company?: { identifier?: string; name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string };
  department?: { label?: string };
  function?: { label?: string };
  experienceLevel?: { label?: string };
  typeOfEmployment?: { label?: string };
  ref?: string;
  postingUrl?: string;
  applyUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
}

export function smartRecruitersToRaw(p: SmartRecruitersPosting, target: CompanyTarget): RawJob {
  const sections = p.jobAd?.sections ?? {};
  const html = cleanHtml(
    ['jobDescription', 'qualifications', 'additionalInformation', 'companyDescription']
      .map((k) => sections[k])
      .filter((s) => s?.text)
      .map((s) => `<h4>${s!.title ?? ''}</h4>${s!.text}`)
      .join(''),
  );
  const ident = p.company?.identifier ?? target.token;
  const posting = p.postingUrl ?? `https://jobs.smartrecruiters.com/${ident}/${p.id}`;
  const loc = p.location ?? {};
  return {
    source: 'smartrecruiters',
    externalId: `${ident}:${p.id}`,
    title: p.name,
    company: p.company?.name ?? target.name ?? prettyCompany(ident),
    location: loc.fullLocation ?? [loc.city, loc.region, loc.country?.toUpperCase()].filter(Boolean).join(', '),
    remote: !!loc.remote,
    url: posting,
    descriptionHtml: html,
    descriptionText: htmlToText(html) || `${p.name} at ${p.company?.name ?? ident}. ${[p.department?.label, p.function?.label].filter(Boolean).join(' · ')}`,
    postedAt: toIso(p.releasedDate),
    tags: [p.department?.label, p.function?.label, p.experienceLevel?.label, p.typeOfEmployment?.label, loc.hybrid ? 'mode:hybrid' : loc.remote ? 'mode:remote' : undefined].filter(
      (t): t is string => !!t,
    ),
    ats: 'smartrecruiters',
    applyUrl: `https://jobs.smartrecruiters.com/${ident}/${p.id}`,
    companyDomain: target.domain ?? null,
  };
}

export const smartrecruiters: Connector = {
  id: 'smartrecruiters',
  label: 'SmartRecruiters boards',
  kind: 'ats',
  ats: 'smartrecruiters',
  homepage: 'https://www.smartrecruiters.com',
  description: 'Company boards on SmartRecruiters (Ubisoft, Western Digital, ServiceNow, Bosch…) via the public Posting API.',
  defaultEnabled: true,
  timeoutMs: 15 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'smartrecruiters', 'SmartRecruiters', targetsFor(ctx, 'smartrecruiters'), 3, async (t) => {
      const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(t.token)}/postings`;
      const list: SmartRecruitersPosting[] = [];
      let total = 0;
      for (let offset = 0; offset < 1000; offset += 100) {
        const page = await getJson<{ totalFound: number; content: SmartRecruitersPosting[] }>(`${base}?limit=100&offset=${offset}`, BIG);
        total = page.totalFound ?? 0;
        list.push(...(page.content ?? []));
        if ((page.content ?? []).length < 100 || list.length >= total) break;
      }
      const jobs = await withDetails(ctx, list, {
        url: (p) => `https://jobs.smartrecruiters.com/${p.company?.identifier ?? t.token}/${p.id}`,
        title: (p) => p.name,
        postedAt: (p) => toIso(p.releasedDate),
        minimal: (p) => smartRecruitersToRaw(p, t),
        detail: async (p) => smartRecruitersToRaw(await getJson<SmartRecruitersPosting>(`${base}/${encodeURIComponent(p.id)}`, BIG), t),
      });
      return { jobs, count: total, name: list[0]?.company?.name };
    });
  },
};

// ── Workday (CXS) ───────────────────────────────────────────────────────────

export interface WorkdayListItem {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
  remoteType?: string;
}
export interface WorkdayDetail {
  jobPostingInfo: {
    id?: string;
    title: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    postedOn?: string;
    startDate?: string;
    timeType?: string;
    jobReqId?: string;
    remoteType?: string;
    externalUrl?: string;
    country?: { descriptor?: string };
  };
  hiringOrganization?: { name?: string };
}

export function workdayToRaw(item: WorkdayListItem, detail: WorkdayDetail | null, target: CompanyTarget, now = Date.now()): RawJob {
  const wp = workdayParts(target.token)!;
  const info = detail?.jobPostingInfo;
  const html = cleanHtml(info?.jobDescription ?? '');
  const location = [info?.location ?? item.locationsText ?? '', ...(info?.additionalLocations ?? [])].filter(Boolean).join(' · ');
  const remoteType = info?.remoteType ?? item.remoteType ?? '';
  const url = info?.externalUrl ?? `${wp.boardUrl}${item.externalPath}`;
  return {
    source: 'workday',
    externalId: `${wp.tenant}:${info?.jobReqId ?? item.bulletFields?.[0] ?? item.externalPath}`,
    title: info?.title ?? item.title,
    company: target.name ?? prettyCompany(wp.tenant),
    location,
    remote: /remote/i.test(remoteType) || isRemote(location, item.title),
    url,
    descriptionHtml: html,
    descriptionText: htmlToText(html) || `${item.title} at ${target.name ?? prettyCompany(wp.tenant)} (${location}).`,
    postedAt: info?.startDate ? toIso(info.startDate) : relativePosted(info?.postedOn ?? item.postedOn, now),
    tags: [info?.timeType, remoteType ? `mode:${remoteType.toLowerCase()}` : undefined].filter((t): t is string => !!t),
    ats: 'workday',
    applyUrl: `${wp.boardUrl}${item.externalPath}`,
    companyDomain: target.domain ?? null,
  };
}

export const workday: Connector = {
  id: 'workday',
  label: 'Workday boards',
  kind: 'ats',
  ats: 'workday',
  homepage: 'https://www.workday.com',
  description: 'Enterprise career sites on Workday (NVIDIA, CrowdStrike, Boeing, Intel…) through their public CXS search API. Newest postings first, details for tech roles only.',
  defaultEnabled: true,
  timeoutMs: 20 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'workday', 'Workday', targetsFor(ctx, 'workday'), 3, async (t) => {
      const wp = workdayParts(t.token);
      if (!wp) throw new Error(`bad Workday token ${t.token}`);
      const items: WorkdayListItem[] = [];
      let total = 0;
      const pages = ctx.workdayPages ?? 5;
      for (let page = 0; page < pages; page++) {
        const res = await postJson<{ total: number; jobPostings: WorkdayListItem[] }>(
          `${wp.apiBase}/jobs`,
          { appliedFacets: {}, limit: 20, offset: page * 20, searchText: '' },
          { timeoutMs: 45_000, minIntervalMs: 400 },
        );
        if (page === 0) total = res.total ?? 0;
        const batch = res.jobPostings ?? [];
        items.push(...batch);
        // Stop once the board runs out or postings fall past the freshness window.
        const last = batch[batch.length - 1];
        if (batch.length < 20 || (last && !withinDays(relativePosted(last.postedOn), ctx.maxAgeDays))) break;
      }
      const jobs = await withDetails(ctx, items, {
        url: (i) => `${wp.boardUrl}${i.externalPath}`,
        title: (i) => i.title,
        postedAt: (i) => relativePosted(i.postedOn),
        minimal: (i) => workdayToRaw(i, null, t),
        detail: async (i) => workdayToRaw(i, await getJson<WorkdayDetail>(`${wp.apiBase}${i.externalPath}`, { timeoutMs: 45_000, minIntervalMs: 400 }), t),
        concurrency: 2,
      });
      return { jobs, count: total };
    });
  },
};

// ── Workable ────────────────────────────────────────────────────────────────

export interface WorkableAccount {
  name?: string;
  jobs?: {
    title: string;
    shortcode: string;
    employment_type?: string;
    telecommuting?: boolean;
    department?: string;
    url?: string;
    application_url?: string;
    published_on?: string;
    created_at?: string;
    country?: string;
    city?: string;
    state?: string;
    experience?: string;
    function?: string;
    description?: string;
    locations?: { country?: string; city?: string; region?: string; hidden?: boolean }[];
  }[];
}

export function parseWorkable(data: WorkableAccount, target: CompanyTarget): RawJob[] {
  return (data.jobs ?? []).map<RawJob>((j) => {
    const html = cleanHtml(j.description ?? '');
    const locs = (j.locations ?? []).filter((l) => !l.hidden).map((l) => [l.city, l.region, l.country].filter(Boolean).join(', '));
    const location = locs.length ? locs.join(' · ') : [j.city, j.state, j.country].filter(Boolean).join(', ');
    return {
      source: 'workable',
      externalId: `${target.token}:${j.shortcode}`,
      title: j.title,
      company: data.name ?? target.name ?? prettyCompany(target.token),
      location,
      remote: !!j.telecommuting || isRemote(location),
      url: j.url ?? `https://apply.workable.com/${target.token}/j/${j.shortcode}`,
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      postedAt: j.published_on ? toIso(`${j.published_on}T00:00:00Z`) : toIso(j.created_at),
      tags: [j.department, j.function, j.employment_type, j.experience, j.telecommuting ? 'mode:remote' : undefined].filter((t): t is string => !!t),
      ats: 'workable',
      applyUrl: `https://apply.workable.com/${target.token}/j/${j.shortcode}`,
      companyDomain: target.domain ?? null,
    };
  });
}

export const workable: Connector = {
  id: 'workable',
  label: 'Workable boards',
  kind: 'ats',
  ats: 'workable',
  homepage: 'https://www.workable.com',
  description: 'Company boards on Workable (Hugging Face, Thorlabs…) via the public widget API with full descriptions.',
  defaultEnabled: true,
  timeoutMs: 15 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'workable', 'Workable', targetsFor(ctx, 'workable'), 3, async (t) => {
      const data = await getJson<WorkableAccount>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(t.token)}?details=true`, {
        ...BIG,
        minIntervalMs: 600,
      });
      return { jobs: parseWorkable(data, t), count: data.jobs?.length ?? 0, name: data.name };
    });
  },
};

// ── Recruitee ───────────────────────────────────────────────────────────────

export interface RecruiteeOffer {
  id: number;
  slug?: string;
  title: string;
  company_name?: string;
  location?: string;
  remote?: boolean;
  hybrid?: boolean;
  on_site?: boolean;
  careers_url?: string;
  careers_apply_url?: string;
  published_at?: string;
  created_at?: string;
  description?: string;
  requirements?: string;
  department?: string;
  tags?: string[];
  employment_type_code?: string;
  experience_code?: string;
  status?: string;
  salary?: { min?: number | string | null; max?: number | string | null; period?: string | null; currency?: string | null };
}

const recruiteeDate = (s?: string) => (s ? toIso(s.replace(' ', 'T').replace(/ UTC$/, 'Z')) : null);

export function parseRecruitee(data: { offers?: RecruiteeOffer[] }, target: CompanyTarget): RawJob[] {
  return (data.offers ?? [])
    .filter((o) => !o.status || o.status === 'published')
    .map<RawJob>((o) => {
      const html = cleanHtml(`${o.description ?? ''}${o.requirements ? `<h4>Requirements</h4>${o.requirements}` : ''}`);
      const period = (o.salary?.period ?? 'year').toLowerCase();
      const per = period.startsWith('hour') ? 'hour' : period.startsWith('month') ? 'month' : period.startsWith('week') ? 'week' : period.startsWith('day') ? 'day' : 'year';
      const url = o.careers_url ?? `https://${target.token}.recruitee.com/o/${o.slug}`;
      return {
        source: 'recruitee',
        externalId: `${target.token}:${o.id}`,
        title: o.title,
        company: o.company_name ?? target.name ?? prettyCompany(target.token),
        location: o.location ?? '',
        remote: !!o.remote,
        url,
        descriptionHtml: html,
        descriptionText: htmlToText(html),
        postedAt: recruiteeDate(o.published_at ?? o.created_at),
        salaryMin: annualise(num(o.salary?.min), per),
        salaryMax: annualise(num(o.salary?.max), per),
        salaryCurrency: o.salary?.currency ?? null,
        tags: [o.department, o.employment_type_code, o.experience_code, o.remote ? 'mode:remote' : o.hybrid ? 'mode:hybrid' : o.on_site ? 'mode:onsite' : undefined, ...(o.tags ?? [])].filter(
          (t): t is string => !!t,
        ),
        ats: 'recruitee',
        applyUrl: url,
        companyDomain: target.domain ?? null,
      };
    });
}

export const recruitee: Connector = {
  id: 'recruitee',
  label: 'Recruitee boards',
  kind: 'ats',
  ats: 'recruitee',
  homepage: 'https://recruitee.com',
  description: 'Company boards on Recruitee (bunq, Hard Rock Digital…) via the public offers API.',
  defaultEnabled: true,
  timeoutMs: 15 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'recruitee', 'Recruitee', targetsFor(ctx, 'recruitee'), 3, async (t) => {
      const data = await getJson<{ offers: RecruiteeOffer[] }>(`https://${encodeURIComponent(t.token)}.recruitee.com/api/offers/`, BIG);
      return { jobs: parseRecruitee(data, t), count: data.offers?.length ?? 0, name: data.offers?.[0]?.company_name };
    });
  },
};

// ── Personio (XML feed) ─────────────────────────────────────────────────────

export function parsePersonio(doc: string, target: CompanyTarget): RawJob[] {
  const parsed = xml.parse(doc) as { 'workzag-jobs'?: { position?: Record<string, unknown> | Record<string, unknown>[] } };
  const base = target.token.endsWith('.com') ? `https://${target.token.slice(0, -4)}.jobs.personio.com` : `https://${target.token}.jobs.personio.de`;
  return arr(parsed['workzag-jobs']?.position).map<RawJob>((p) => {
    const descs = arr((p.jobDescriptions as { jobDescription?: unknown } | undefined)?.jobDescription) as { name?: unknown; value?: unknown }[];
    const html = cleanHtml(descs.map((d) => `<h4>${str(d.name)}</h4>${str(d.value)}`).join(''));
    const offices = [str(p.office), ...arr((p.additionalOffices as { office?: unknown } | undefined)?.office).map(str)].filter(Boolean);
    const id = str(p.id);
    return {
      source: 'personio',
      externalId: `${target.token}:${id}`,
      title: str(p.name),
      company: str(p.subcompany) || target.name || prettyCompany(target.token.replace(/\.com$/, '')),
      location: offices.join(' · '),
      remote: isRemote(...offices),
      url: `${base}/job/${id}`,
      descriptionHtml: html,
      descriptionText: htmlToText(html) || `${str(p.name)} at ${str(p.subcompany) || target.token}. ${str(p.department)}`,
      postedAt: toIso(str(p.createdAt)),
      tags: [str(p.department), str(p.employmentType), str(p.seniority), str(p.schedule), str(p.occupationCategory)].filter(Boolean),
      ats: 'personio',
      applyUrl: `${base}/job/${id}`,
      companyDomain: target.domain ?? null,
    };
  });
}

export const personio: Connector = {
  id: 'personio',
  label: 'Personio boards',
  kind: 'ats',
  ats: 'personio',
  homepage: 'https://www.personio.com',
  description: 'European company boards on Personio (1KOMMA5°, Chrono24, ottonova…) via each board’s public XML feed.',
  defaultEnabled: true,
  timeoutMs: 15 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'personio', 'Personio', targetsFor(ctx, 'personio'), 3, async (t) => {
      const host = t.token.endsWith('.com') ? `${t.token.slice(0, -4)}.jobs.personio.com` : `${t.token}.jobs.personio.de`;
      const doc = await getText(`https://${host}/xml`, { ...BIG, accept: 'application/xml, text/xml' });
      const jobs = parsePersonio(doc, t);
      return { jobs, count: jobs.length };
    });
  },
};

// ── Teamtailor (RSS) ────────────────────────────────────────────────────────

export function parseTeamtailor(doc: string, target: CompanyTarget): RawJob[] {
  const parsed = xml.parse(doc) as { rss?: { channel?: { title?: unknown; item?: unknown } } };
  const channel = parsed.rss?.channel;
  const company = str(channel?.title) || target.name || prettyCompany(target.token);
  return arr(channel?.item as Record<string, unknown> | Record<string, unknown>[]).map<RawJob>((it) => {
    const html = cleanHtml(decodeEntities(str(it.description)));
    const locs = arr((it['tt:locations'] as { 'tt:location'?: unknown } | undefined)?.['tt:location']) as Record<string, unknown>[];
    const location = locs.map((l) => [str(l['tt:city']), str(l['tt:country'])].filter(Boolean).join(', ')).filter(Boolean);
    const remoteStatus = str(it.remoteStatus).toLowerCase();
    const link = str(it.link);
    return {
      source: 'teamtailor',
      externalId: `${target.token}:${str(it.guid) || link}`,
      title: str(it.title),
      company,
      location: [...new Set(location)].join(' · ') || (remoteStatus === 'fully' ? 'Remote' : ''),
      remote: remoteStatus === 'fully' || remoteStatus === 'remote',
      url: link,
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      postedAt: toIso(str(it.pubDate)),
      tags: [
        str(it['tt:department']),
        str(it['tt:role']),
        remoteStatus === 'hybrid' ? 'mode:hybrid' : remoteStatus === 'fully' ? 'mode:remote' : remoteStatus === 'none' ? 'mode:onsite' : '',
      ].filter(Boolean),
      ats: 'teamtailor',
      applyUrl: link,
      companyDomain: target.domain ?? null,
    };
  });
}

export const teamtailor: Connector = {
  id: 'teamtailor',
  label: 'Teamtailor boards',
  kind: 'ats',
  ats: 'teamtailor',
  homepage: 'https://www.teamtailor.com',
  description: 'Company career sites on Teamtailor via their public jobs RSS feed.',
  defaultEnabled: true,
  timeoutMs: 15 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'teamtailor', 'Teamtailor', targetsFor(ctx, 'teamtailor'), 3, async (t) => {
      const doc = await getText(`https://${encodeURIComponent(t.token)}.teamtailor.com/jobs.rss`, { ...BIG, accept: 'application/rss+xml, text/xml' });
      const jobs = parseTeamtailor(doc, t);
      return { jobs, count: jobs.length };
    });
  },
};

// ── BambooHR ────────────────────────────────────────────────────────────────

export interface BambooListItem {
  id: string;
  jobOpeningName: string;
  departmentLabel?: string;
  employmentStatusLabel?: string;
  location?: { city?: string | null; state?: string | null };
  atsLocation?: { country?: string | null; state?: string | null; city?: string | null };
  isRemote?: boolean | null;
  locationType?: string | null;
}
export interface BambooDetail {
  result?: { jobOpening?: { jobOpeningName?: string; description?: string; compensation?: string | null; datePosted?: string; jobOpeningShareUrl?: string; minimumExperience?: string } };
}

export function bambooToRaw(item: BambooListItem, detail: BambooDetail | null, target: CompanyTarget): RawJob {
  const d = detail?.result?.jobOpening;
  const html = cleanHtml(d?.description ?? '');
  const loc = item.atsLocation ?? {};
  const location = [loc.city ?? item.location?.city, loc.state ?? item.location?.state, loc.country].filter(Boolean).join(', ');
  // locationType: 0 on-site, 1 remote, 2 hybrid (BambooHR careers API)
  const mode = item.locationType === '1' || item.isRemote ? 'remote' : item.locationType === '2' ? 'hybrid' : 'onsite';
  const salary = parseSalaryText(d?.compensation);
  const url = `https://${target.token}.bamboohr.com/careers/${item.id}`;
  return {
    source: 'bamboohr',
    externalId: `${target.token}:${item.id}`,
    title: item.jobOpeningName.trim(),
    company: target.name ?? prettyCompany(target.token),
    location: location || (mode === 'remote' ? 'Remote' : ''),
    remote: mode === 'remote',
    url,
    descriptionHtml: html,
    descriptionText: htmlToText(html) || `${item.jobOpeningName} at ${target.name ?? target.token}. ${item.departmentLabel ?? ''}`,
    postedAt: toIso(d?.datePosted),
    salaryMin: salary ? annualise(salary.min, salary.period) : null,
    salaryMax: salary ? annualise(salary.max, salary.period) : null,
    salaryCurrency: salary?.currency ?? null,
    tags: [item.departmentLabel, item.employmentStatusLabel, d?.minimumExperience, `mode:${mode}`].filter((t): t is string => !!t),
    ats: 'bamboohr',
    applyUrl: url,
    companyDomain: target.domain ?? null,
  };
}

export const bamboohr: Connector = {
  id: 'bamboohr',
  label: 'BambooHR boards',
  kind: 'ats',
  ats: 'bamboohr',
  homepage: 'https://www.bamboohr.com',
  description: 'Small and mid-size company careers pages on BambooHR via the public careers list/detail JSON.',
  defaultEnabled: true,
  timeoutMs: 15 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'bamboohr', 'BambooHR', targetsFor(ctx, 'bamboohr'), 3, async (t) => {
      const base = `https://${encodeURIComponent(t.token)}.bamboohr.com/careers`;
      const list = await getJson<{ result?: BambooListItem[] }>(`${base}/list`, BIG);
      const items = list.result ?? [];
      const jobs = await withDetails(ctx, items, {
        url: (i) => `${base}/${i.id}`,
        title: (i) => i.jobOpeningName,
        postedAt: () => null,
        minimal: (i) => bambooToRaw(i, null, t),
        detail: async (i) => bambooToRaw(i, await getJson<BambooDetail>(`${base}/${encodeURIComponent(i.id)}/detail`, BIG), t),
      });
      return { jobs: jobs.filter((j) => withinDays(j.postedAt, ctx.maxAgeDays)), count: items.length };
    });
  },
};

// ── Breezy HR ───────────────────────────────────────────────────────────────

export interface BreezyPosition {
  id: string;
  friendly_id?: string;
  name: string;
  url: string;
  published_date?: string;
  type?: { name?: string };
  location?: { name?: string; city?: string; is_remote?: boolean; country?: { name?: string }; state?: { name?: string } };
  locations?: { name?: string; is_remote?: boolean }[];
  department?: string;
  salary?: string;
  company?: { name?: string };
  description?: string;
}

export function parseBreezy(data: BreezyPosition[], target: CompanyTarget): RawJob[] {
  return (Array.isArray(data) ? data : []).map<RawJob>((p) => {
    const salary = parseSalaryText(p.salary);
    const html = cleanHtml(p.description ?? '');
    const location = (p.locations?.length ? p.locations.map((l) => l.name) : [p.location?.name]).filter(Boolean).join(' · ');
    const remote = !!p.location?.is_remote || (p.locations ?? []).some((l) => l.is_remote);
    const company = p.company?.name ?? target.name ?? prettyCompany(target.token);
    return {
      source: 'breezy',
      externalId: `${target.token}:${p.id}`,
      title: p.name,
      company,
      location: location || (remote ? 'Remote' : ''),
      remote,
      url: p.url,
      descriptionHtml: html,
      descriptionText: htmlToText(html) || `${p.name} at ${company}. ${[p.department, p.type?.name, location, p.salary].filter(Boolean).join(' · ')}`,
      postedAt: toIso(p.published_date),
      salaryMin: salary ? annualise(salary.min, salary.period) : null,
      salaryMax: salary ? annualise(salary.max, salary.period) : null,
      salaryCurrency: salary?.currency ?? null,
      tags: [p.department, p.type?.name, remote ? 'mode:remote' : undefined].filter((t): t is string => !!t),
      ats: 'breezy',
      applyUrl: p.url,
      companyDomain: target.domain ?? null,
    };
  });
}

export const breezy: Connector = {
  id: 'breezy',
  label: 'Breezy HR boards',
  kind: 'ats',
  ats: 'breezy',
  homepage: 'https://breezy.hr',
  description: 'Company boards on Breezy HR via each portal’s public /json listing.',
  defaultEnabled: true,
  timeoutMs: 10 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'breezy', 'Breezy', targetsFor(ctx, 'breezy'), 3, async (t) => {
      const data = await getJson<BreezyPosition[]>(`https://${encodeURIComponent(t.token)}.breezy.hr/json`, BIG);
      return { jobs: parseBreezy(data, t), count: Array.isArray(data) ? data.length : 0, name: Array.isArray(data) ? data[0]?.company?.name : undefined };
    });
  },
};

// ── JazzHR (XML export feed) ────────────────────────────────────────────────

export function parseJazz(doc: string, target: CompanyTarget): RawJob[] {
  const parsed = xml.parse(doc) as { jobs?: { company?: unknown; job?: unknown } };
  const company = str(parsed.jobs?.company) || target.name || prettyCompany(target.token);
  return arr(parsed.jobs?.job as Record<string, unknown> | Record<string, unknown>[])
    .filter((j) => !str(j.status) || /open/i.test(str(j.status)))
    .map<RawJob>((j) => {
      const id = str(j.id);
      // Ids look like job_20261030192024_ATWXRDUM3FSNN2EL: the creation timestamp is embedded.
      const ts = id.match(/job_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
      const html = cleanHtml(str(j.description));
      const location = [str(j.city), str(j.state), str(j.country)].filter(Boolean).join(', ');
      return {
        source: 'jazzhr',
        externalId: `${target.token}:${id}`,
        title: str(j.title),
        company,
        location,
        remote: isRemote(location, str(j.title)),
        url: str(j.url),
        descriptionHtml: html,
        descriptionText: htmlToText(html),
        postedAt: ts ? toIso(`${ts[1]}-${ts[2]}-${ts[3]}T${ts[4]}:${ts[5]}:${ts[6]}Z`) : null,
        tags: [str(j.department), str(j.type), str(j.experience)].filter(Boolean),
        ats: 'jazzhr',
        applyUrl: str(j.url),
        companyDomain: target.domain ?? null,
      };
    });
}

export const jazzhr: Connector = {
  id: 'jazzhr',
  label: 'JazzHR boards',
  kind: 'ats',
  ats: 'jazzhr',
  homepage: 'https://www.jazzhr.com',
  description: 'Company boards on JazzHR (applytojob.com) via the public XML job export.',
  defaultEnabled: true,
  timeoutMs: 10 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'jazzhr', 'JazzHR', targetsFor(ctx, 'jazzhr'), 3, async (t) => {
      const doc = await getText(`https://app.jazz.co/feeds/export/jobs/${encodeURIComponent(t.token)}`, { ...BIG, accept: 'application/xml, text/xml' });
      const jobs = parseJazz(doc, t);
      return { jobs, count: jobs.length };
    });
  },
};

// ── Rippling ────────────────────────────────────────────────────────────────

export interface RipplingListItem {
  uuid: string;
  name: string;
  department?: { label?: string };
  url: string;
  workLocation?: { label?: string };
}
export interface RipplingDetail {
  uuid: string;
  name: string;
  description?: { company?: string; role?: string };
  workLocations?: string[];
  department?: { name?: string; base_department?: string };
  employmentType?: { label?: string; id?: string };
  createdOn?: string;
  payRangeDetails?: { rangeStart?: number; rangeEnd?: number; currency?: string; frequency?: string }[];
}

export function ripplingToRaw(item: RipplingListItem, detail: RipplingDetail | null, target: CompanyTarget): RawJob {
  const html = cleanHtml(`${detail?.description?.role ?? ''}${detail?.description?.company ? `<h4>About</h4>${detail.description.company}` : ''}`);
  const location = (detail?.workLocations?.length ? detail.workLocations : [item.workLocation?.label]).filter(Boolean).join(' · ');
  const pay = detail?.payRangeDetails?.[0];
  const per = /hour/i.test(pay?.frequency ?? '') ? 'hour' : /month/i.test(pay?.frequency ?? '') ? 'month' : 'year';
  return {
    source: 'rippling',
    externalId: `${target.token}:${item.uuid}`,
    title: (detail?.name ?? item.name).trim(),
    company: target.name ?? prettyCompany(target.token),
    location,
    remote: isRemote(location, item.name),
    url: item.url,
    descriptionHtml: html,
    descriptionText: htmlToText(html) || `${item.name.trim()} at ${target.name ?? target.token}. ${item.department?.label ?? ''}`,
    postedAt: toIso(detail?.createdOn),
    salaryMin: annualise(num(pay?.rangeStart), per),
    salaryMax: annualise(num(pay?.rangeEnd), per),
    salaryCurrency: pay?.currency ?? null,
    tags: [item.department?.label, detail?.department?.base_department, detail?.employmentType?.id].filter((t): t is string => !!t),
    ats: 'rippling',
    applyUrl: item.url,
    companyDomain: target.domain ?? null,
  };
}

export const rippling: Connector = {
  id: 'rippling',
  label: 'Rippling boards',
  kind: 'ats',
  ats: 'rippling',
  homepage: 'https://www.rippling.com/recruiting',
  description: 'Company boards on Rippling Recruiting (ats.rippling.com) via the public board API.',
  defaultEnabled: true,
  timeoutMs: 15 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'rippling', 'Rippling', targetsFor(ctx, 'rippling'), 3, async (t) => {
      const base = `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(t.token)}/jobs`;
      const items = await getJson<RipplingListItem[]>(base, BIG);
      const list = Array.isArray(items) ? items : [];
      const jobs = await withDetails(ctx, list, {
        url: (i) => i.url,
        title: (i) => i.name,
        postedAt: () => null,
        minimal: (i) => ripplingToRaw(i, null, t),
        detail: async (i) => ripplingToRaw(i, await getJson<RipplingDetail>(`${base}/${encodeURIComponent(i.uuid)}`, BIG), t),
      });
      return { jobs: jobs.filter((j) => withinDays(j.postedAt, ctx.maxAgeDays)), count: list.length };
    });
  },
};

// ── Pinpoint ────────────────────────────────────────────────────────────────

export interface PinpointPosting {
  id: string;
  title: string;
  url: string;
  description?: string;
  key_responsibilities?: string;
  key_responsibilities_header?: string;
  skills_knowledge_expertise?: string;
  skills_knowledge_expertise_header?: string;
  benefits?: string;
  benefits_header?: string;
  compensation_minimum?: number | null;
  compensation_maximum?: number | null;
  compensation_currency?: string | null;
  compensation_frequency?: string | null;
  compensation_visible?: boolean;
  employment_type_text?: string;
  workplace_type?: string;
  deadline_at?: string | null;
  location?: { city?: string; name?: string; province?: string };
  job?: { department?: { name?: string }; division?: { name?: string } };
}

export function parsePinpoint(data: { data?: PinpointPosting[] }, target: CompanyTarget): RawJob[] {
  return (data.data ?? []).map<RawJob>((p) => {
    const html = cleanHtml(
      [
        p.description,
        p.key_responsibilities ? `<h4>${p.key_responsibilities_header ?? 'Responsibilities'}</h4>${p.key_responsibilities}` : '',
        p.skills_knowledge_expertise ? `<h4>${p.skills_knowledge_expertise_header ?? 'Requirements'}</h4>${p.skills_knowledge_expertise}` : '',
        p.benefits ? `<h4>${p.benefits_header ?? 'Benefits'}</h4>${p.benefits}` : '',
      ].join(''),
    );
    const freq = (p.compensation_frequency ?? 'year').toLowerCase();
    const per = freq.startsWith('hour') ? 'hour' : freq.startsWith('month') ? 'month' : 'year';
    const show = p.compensation_visible !== false;
    const mode = (p.workplace_type ?? '').toLowerCase();
    return {
      source: 'pinpoint',
      externalId: `${target.token}:${p.id}`,
      title: p.title,
      company: p.job?.division?.name ?? target.name ?? prettyCompany(target.token),
      location: p.location?.name ?? p.location?.city ?? '',
      remote: mode === 'remote' || isRemote(p.location?.name),
      url: p.url,
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      // The public feed has no publish date; the scout's first-seen time stands in.
      postedAt: null,
      salaryMin: show ? annualise(num(p.compensation_minimum), per) : null,
      salaryMax: show ? annualise(num(p.compensation_maximum), per) : null,
      salaryCurrency: show ? (p.compensation_currency ?? null) : null,
      tags: [p.job?.department?.name, p.employment_type_text, mode ? `mode:${mode}` : undefined].filter((t): t is string => !!t),
      ats: 'pinpoint',
      applyUrl: p.url,
      companyDomain: target.domain ?? null,
    };
  });
}

export const pinpoint: Connector = {
  id: 'pinpoint',
  label: 'Pinpoint boards',
  kind: 'ats',
  ats: 'pinpoint',
  homepage: 'https://www.pinpointhq.com',
  description: 'Company boards on Pinpoint via each board’s public postings.json.',
  defaultEnabled: true,
  timeoutMs: 10 * 60_000,
  async run(ctx) {
    return pollBoards(ctx, 'pinpoint', 'Pinpoint', targetsFor(ctx, 'pinpoint'), 3, async (t) => {
      const data = await getJson<{ data: PinpointPosting[] }>(`https://${encodeURIComponent(t.token)}.pinpointhq.com/postings.json`, BIG);
      return { jobs: parsePinpoint(data, t), count: data.data?.length ?? 0 };
    });
  },
};

export const MORE_ATS: Connector[] = [smartrecruiters, workday, workable, recruitee, personio, teamtailor, bamboohr, breezy, jazzhr, rippling, pinpoint];
