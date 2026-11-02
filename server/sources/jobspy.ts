import { jobspyRowToRaw, jobspyStatus, runJobSpy } from '../scout/jobspy.ts';
import { scoutSettings, scoutState, setScoutState } from '../scout/settings.ts';
import { searchTerms } from './local.ts';
import type { Connector, RawJob } from './types.ts';
import { SourceUnavailable } from './util.ts';

/**
 * Aggregators through the JobSpy sidecar: LinkedIn, Indeed, Glassdoor, Google
 * Jobs, ZipRecruiter, Bayt and Naukri guest search. Never logged in. Search
 * terms rotate through the campaign's roles × locations, a few per run, so
 * every combination is covered over a day without hammering any one site.
 */

const COUNTRY_INDEED: [RegExp, string][] = [
  [/pakistan|lahore|karachi|islamabad/i, 'Pakistan'],
  [/\b(uae|dubai|abu dhabi|emirates)\b/i, 'United Arab Emirates'],
  [/saudi|riyadh|jeddah/i, 'Saudi Arabia'],
  [/qatar|doha/i, 'Qatar'],
  [/\b(uk|united kingdom|london|england)\b/i, 'UK'],
  [/germany|berlin|munich/i, 'Germany'],
  [/canada|toronto|vancouver/i, 'Canada'],
  [/india|bangalore|bengaluru|hyderabad|pune/i, 'India'],
  [/netherlands|amsterdam/i, 'Netherlands'],
  [/ireland|dublin/i, 'Ireland'],
  [/australia|sydney|melbourne/i, 'Australia'],
];

export function jobspyCombos(roles: string[], locations: string[]): { term: string; location: string }[] {
  const locs = locations.length ? locations : ['Remote'];
  return roles.flatMap((term) => locs.map((location) => ({ term, location })));
}

export const jobspy: Connector = {
  id: 'jobspy',
  label: 'LinkedIn · Indeed · Google · Bayt (JobSpy)',
  kind: 'aggregator',
  homepage: 'https://github.com/speedyapply/JobSpy',
  description: 'Public guest search on LinkedIn, Indeed, Glassdoor, Google Jobs, ZipRecruiter, Bayt and Naukri through the local JobSpy sidecar (needs Python; never logs in).',
  defaultEnabled: true,
  timeoutMs: 30 * 60_000,
  async availability() {
    const s = await jobspyStatus();
    return s.available ? null : s.reason;
  },
  async run(ctx) {
    const status = await jobspyStatus();
    if (!status.available) throw new SourceUnavailable(status.reason ?? 'JobSpy sidecar unavailable');
    const cfg = scoutSettings().jobspy;
    const combos = jobspyCombos(searchTerms(ctx, 12), ctx.locations ?? []);
    const cursor = scoutState<number>('jobspy.cursor', 0) % Math.max(1, combos.length);
    const picked = Array.from({ length: Math.min(cfg.termsPerRun, combos.length) }, (_, i) => combos[(cursor + i) % combos.length]);
    setScoutState('jobspy.cursor', (cursor + picked.length) % Math.max(1, combos.length));

    const out: RawJob[] = [];
    let failures = 0;
    for (const c of picked) {
      const remote = /remote|anywhere/i.test(c.location);
      const res = await runJobSpy(
        {
          sites: cfg.sites,
          search_term: c.term,
          location: remote ? undefined : c.location,
          is_remote: remote || ctx.remoteOnly,
          results_wanted: cfg.resultsPerSite,
          hours_old: cfg.hoursOld,
          country_indeed: COUNTRY_INDEED.find(([re]) => re.test(c.location))?.[1] ?? cfg.countryIndeed,
          proxies: cfg.proxies,
          pause_seconds: 3,
        },
        cfg.timeoutSec * 1000,
      );
      if (res.unavailable) throw new SourceUnavailable(res.error ?? 'JobSpy is not installed');
      if (!res.ok) failures++;
      for (const e of res.errors) ctx.log(`JobSpy ${e.site} ("${c.term}", ${c.location}): ${e.error.slice(0, 160)}`);
      const rows = res.jobs.map(jobspyRowToRaw).filter((j): j is RawJob => !!j);
      ctx.log(`JobSpy "${c.term}" · ${c.location}: ${rows.length} postings ${res.counts ? JSON.stringify(res.counts) : ''}`);
      out.push(...rows);
    }
    if (picked.length && failures === picked.length) throw new Error('JobSpy: every search failed');
    ctx.discover?.(out.map((j) => j.applyUrl ?? '').filter(Boolean), 'jobspy');
    return out;
  },
};
