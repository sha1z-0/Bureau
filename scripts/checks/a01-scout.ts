import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Harness } from '../lib/harness.ts';
import type { AtsFamily, RawJob } from '../../server/contracts/job.ts';
import type { Connector, SourceContext } from '../../server/sources/types.ts';

/**
 * A01 scout: ATS detection, every connector's parser against recorded payloads
 * (fixtures/feeds/), normalisation, layered dedupe, ghost/scam filter, the
 * company registry and signals, the JobSpy sidecar's missing-Python path, an
 * offline end-to-end scout run, and the /api/scout routes. Fully offline: the
 * connectors' transport is swapped for the fixtures.
 */

const FEEDS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'feeds');
const feed = (name: string) => fs.readFileSync(path.join(FEEDS, name), 'utf8');

/** URL pattern → fixture file (or inline body). Unmatched URLs (robots.txt included) get a 404. */
const ROUTES: [RegExp, string, string?][] = [
  [/boards-api\.greenhouse\.io\/v1\/boards\/bungie\/jobs/, 'greenhouse-bungie.json'],
  [/api\.lever\.co\/v0\/postings\/kabam/, 'lever-kabam.json'],
  [/api\.ashbyhq\.com\/posting-api\/job-board\/posthog/, 'ashby-posthog.json'],
  [/remotive\.com\/api\/remote-jobs/, 'remotive-software.json'],
  [/remoteok\.com\/api/, 'remoteok-api.json'],
  [/weworkremotely\.com\/categories\/remote-programming-jobs\.rss/, 'weworkremotely-programming.xml'],
  [/weworkremotely\.com\/categories\//, '', '<rss><channel></channel></rss>'],
  [/himalayas\.app\/jobs\/api\?limit/, 'himalayas-api.json'],
  [/himalayas\.app\/jobs\/api\/search/, '', '{"jobs":[]}'],
  [/workingnomads\.com\/api\/exposed_jobs/, 'workingnomads-exposed.json'],
  [/jobspresso\.co\/\?feed=job_feed/, 'nichefeeds-jobspresso.xml'],
  [/larajobs\.com\/feed/, 'nichefeeds-larajobs.xml'],
  [/workwithindies\.com\/careers\/rss\.xml/, 'gamedev-workwithindies.xml'],
  [/remotegamejobs\.com\/feed\.rss/, 'gamedev-remotegamejobs.xml'],
  [/jobicy\.com\/api\/v2\/remote-jobs\?count=50&tag=react/, 'jobicy-react.json'],
  [/jobicy\.com\/api\/v2\/remote-jobs/, '', '{"jobs":[]}'],
  [/arbeitnow\.com\/api\/job-board-api\?page=1$/, 'arbeitnow-page1.json'],
  [/arbeitnow\.com\/api\/job-board-api/, '', '{"data":[]}'],
  [/themuse\.com\/api\/public\/jobs\?category=Software%20Engineering&page=1$/, 'themuse-software.json'],
  [/themuse\.com\/api\/public\/jobs/, '', '{"results":[]}'],
  [/hn\.algolia\.com\/api\/v1\/search_by_date/, 'hackernews-stories.json'],
  [/hn\.algolia\.com\/api\/v1\/search\?tags=comment.*page=0$/, 'hackernews-comments.json'],
  [/hn\.algolia\.com\/api\/v1\/search\?tags=comment/, '', '{"hits":[]}'],
  [/reddit\.com\/r\/forhire\/new\/\.rss/, 'reddit-forhire.xml'],
  [/raw\.githubusercontent\.com\/SimplifyJobs/, 'simplify-newgrad.json'],
  [/api\.smartrecruiters\.com\/v1\/companies\/ServiceNow\/postings\?/, 'smartrecruiters-list.json'],
  [/api\.smartrecruiters\.com\/v1\/companies\/ServiceNow\/postings\/\d+/, 'smartrecruiters-detail.json'],
  [/nvidia\.wd5\.myworkdayjobs\.com\/wday\/cxs\/nvidia\/NVIDIAExternalCareerSite\/jobs$/, 'workday-list.json'],
  [/nvidia\.wd5\.myworkdayjobs\.com\/wday\/cxs\/nvidia\/NVIDIAExternalCareerSite\/job\//, 'workday-detail.json'],
  [/apply\.workable\.com\/api\/v1\/widget\/accounts\/thorlabs/, 'workable-thorlabs.json'],
  [/hardrockdigital\.recruitee\.com\/api\/offers/, 'recruitee-hardrockdigital.json'],
  [/chrono24\.jobs\.personio\.de\/xml/, 'personio-chrono24.xml'],
  [/career\.teamtailor\.com\/jobs\.rss/, 'teamtailor-career.xml'],
  [/fispan\.bamboohr\.com\/careers\/list/, 'bamboohr-list.json'],
  [/fispan\.bamboohr\.com\/careers\/\d+\/detail/, 'bamboohr-detail.json'],
  [/forge-nano\.breezy\.hr\/json/, 'breezy-forge-nano.json'],
  [/app\.jazz\.co\/feeds\/export\/jobs\/evertz/, 'jazzhr-evertz.xml'],
  [/api\.rippling\.com\/platform\/api\/ats\/v1\/board\/rippling\/jobs$/, 'rippling-list.json'],
  [/api\.rippling\.com\/platform\/api\/ats\/v1\/board\/rippling\/jobs\/[0-9a-f-]+$/, 'rippling-detail.json'],
  [/wolve\.pinpointhq\.com\/postings\.json/, 'pinpoint-wolve.json'],
  [/4dayweek\.io\/api\/v1\?page=1$/, 'fourdayweek-page1.json'],
  [/4dayweek\.io\/api\/v1/, '', '{"jobs":[],"has_more":false}'],
  [/python\.org\/jobs\/feed\/rss/, 'pythonjobs-rss.xml'],
  [/hacker-news\.firebaseio\.com\/v0\/jobstories\.json/, 'ycombinator-jobstories.json'],
  [/hacker-news\.firebaseio\.com\/v0\/item\//, 'ycombinator-item.json'],
  [/workatastartup\.com\/jobs\/l\/software-engineer$/, 'ycombinator-waas.html'],
  [/rozee\.pk\/job\/jsearch\/q\/software%20engineer$/, 'rozee-search.html'],
  [/mustakbil\.com\/jobs\/pakistan\/computer-software/, 'mustakbil-computer-software.html'],
  // robots.txt for the robots test
  [/blocked\.example\.org\/robots\.txt/, '', 'User-agent: *\nDisallow: /private\nAllow: /private/ok\n'],
  [/acme-careers\.example\.org\/careers/, '', '<html><body><iframe src="https://job-boards.greenhouse.io/embed/job_board?for=acmeco"></iframe></body></html>'],
];

const TARGETS: Partial<Record<AtsFamily, string>> = {
  greenhouse: 'bungie',
  lever: 'kabam',
  ashby: 'posthog',
  smartrecruiters: 'ServiceNow',
  workday: 'nvidia:wd5:NVIDIAExternalCareerSite',
  workable: 'thorlabs',
  recruitee: 'hardrockdigital',
  personio: 'chrono24',
  teamtailor: 'career',
  bamboohr: 'fispan',
  breezy: 'forge-nano',
  jazzhr: 'evertz',
  rippling: 'rippling',
  pinpoint: 'wolve',
};

export default async function scout({ check, section }: Harness) {
  process.env.BUREAU_JOBSPY_PYTHON = 'none';
  const http = await import('../../server/sources/http.ts');
  const { detectAts, detectAtsInHtml, canonicalApplyUrl, findAtsUrls, employerDomain, boardUrlFor } = await import('../../server/scout/detect.ts');
  const { parseSalaryText, relativePosted, workMode, visaMention, seniority, normalizeJob, relevantTitle } = await import('../../server/scout/normalize.ts');
  const { assessLegitimacy, priorityFor } = await import('../../server/scout/legitimacy.ts');
  const { CONNECTORS } = await import('../../server/sources/index.ts');
  const { db, get, run, all } = await import('../../server/db.ts');
  const { ingestJobs, ingestSync, isKnownUrl, repostCount, titleSimilarity } = await import('../../server/scout/ingest.ts');
  const registry = await import('../../server/scout/registry.ts');
  const { jobspyStatus, jobspyRowToRaw, resetJobspyStatus } = await import('../../server/scout/jobspy.ts');
  const { pipelineState } = await import('../../server/campaign/pipeline.ts');
  const { scoutPipeline, sourceHealth } = await import('../../server/scout/index.ts');
  const { saveScoutSettings } = await import('../../server/scout/settings.ts');
  const { resolveApplyUrls } = await import('../../server/scout/resolve.ts');
  const { weeklyDiscovery, mineResearch } = await import('../../server/scout/discovery.ts');
  const { SourceUnavailable } = await import('../../server/sources/util.ts');

  const requested: string[] = [];
  http.setTransport(async (url) => {
    requested.push(url);
    const hit = ROUTES.find(([re]) => re.test(url));
    const body = hit ? (hit[1] ? feed(hit[1]) : (hit[2] ?? '')) : 'not found';
    const status = hit ? 200 : 404;
    return {
      ok: status === 200,
      status,
      url,
      contentType: url.endsWith('.json') || body.trimStart().startsWith('{') || body.trimStart().startsWith('[') ? 'application/json' : /<html/i.test(body) ? 'text/html' : 'application/xml',
      text: () => body,
      json: <T>() => JSON.parse(body) as T,
    };
  });

  const ctx = (over: Partial<SourceContext> = {}): SourceContext => ({
    keywords: [],
    categories: ['software', 'security', 'web', 'game', 'data_ai', 'devops_cloud', 'mobile'],
    boards: { greenhouse: [], lever: [], ashby: [] },
    maxAgeDays: 36_500,
    log: () => {},
    targets: (ats) => (TARGETS[ats] ? [{ companyId: null, name: null, token: TARGETS[ats]! }] : []),
    roles: ['software engineer'],
    ...over,
  });

  // ── ATS detection ─────────────────────────────────────────────────────────
  section('Scout · ATS detection');
  const SAMPLES: [string, AtsFamily | null, string | null, string | null][] = [
    ['https://boards.greenhouse.io/anthropic', 'greenhouse', 'anthropic', null],
    ['https://boards.greenhouse.io/anthropic/jobs/4020305008', 'greenhouse', 'anthropic', '4020305008'],
    ['https://job-boards.greenhouse.io/genevatrading/jobs/5085231007?gh_src=abc', 'greenhouse', 'genevatrading', '5085231007'],
    ['https://job-boards.eu.greenhouse.io/agency/jobs/4797634101', 'greenhouse', 'eu:agency', '4797634101'],
    ['https://boards.greenhouse.io/embed/job_app?for=stripe&token=7737124', 'greenhouse', 'stripe', '7737124'],
    ['https://boards-api.greenhouse.io/v1/boards/discord/jobs', 'greenhouse', 'discord', null],
    ['https://stripe.com/jobs/search?gh_jid=7737124', 'greenhouse', null, '7737124'],
    ['https://jobs.lever.co/ivo/3ce9dc16-90fd-4b99-b4b9-dfd48ec1a50d', 'lever', 'ivo', '3ce9dc16-90fd-4b99-b4b9-dfd48ec1a50d'],
    ['https://jobs.lever.co/spotify', 'lever', 'spotify', null],
    ['https://jobs.eu.lever.co/cirrus/1979da07-33fb-4dc8-af01-9f12bc9d7b29/apply', 'lever', 'eu:cirrus', '1979da07-33fb-4dc8-af01-9f12bc9d7b29'],
    ['https://api.lever.co/v0/postings/palantir?mode=json', 'lever', 'palantir', null],
    ['https://jobs.ashbyhq.com/uncountable/1f8425be-cd39-4397-a9c1-6511ecfc39fc/application', 'ashby', 'uncountable', '1f8425be-cd39-4397-a9c1-6511ecfc39fc'],
    ['https://jobs.ashbyhq.com/openai', 'ashby', 'openai', null],
    ['https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Yokneam/IC-Practical-Engineer_JR2022657', 'workday', 'nvidia:wd5:NVIDIAExternalCareerSite', '/job/Israel-Yokneam/IC-Practical-Engineer_JR2022657'],
    ['https://globalhr.wd5.myworkdayjobs.com/en-US/rec_rtx_ext_gateway/job/US-AZ-TUCSON/Engineer_01', 'workday', 'globalhr:wd5:rec_rtx_ext_gateway', '/job/US-AZ-TUCSON/Engineer_01'],
    ['https://wd5.myworkdaysite.com/recruiting/microchiphr/External/job/UK/Graduate_R2', 'workday', 'microchiphr:wd5:External:site', '/job/UK/Graduate_R2'],
    ['https://crowdstrike.wd5.myworkdayjobs.com/wday/cxs/crowdstrike/crowdstrikecareers/jobs', 'workday', 'crowdstrike:wd5:crowdstrikecareers', null],
    ['https://jobs.smartrecruiters.com/TTP1/744000130799419', 'smartrecruiters', 'TTP1', '744000130799419'],
    ['https://jobs.smartrecruiters.com/ServiceNow/744000159057430-staff-software-engineer', 'smartrecruiters', 'ServiceNow', '744000159057430'],
    ['https://careers.smartrecruiters.com/Ubisoft2', 'smartrecruiters', 'Ubisoft2', null],
    ['https://api.smartrecruiters.com/v1/companies/BoschGroup/postings', 'smartrecruiters', 'BoschGroup', null],
    ['https://apply.workable.com/tickpick/j/5840ECEB50/apply', 'workable', 'tickpick', '5840ECEB50'],
    ['https://apply.workable.com/huggingface/', 'workable', 'huggingface', null],
    ['https://apply.workable.com/j/FBF966729F', 'workable', null, 'FBF966729F'],
    ['https://bunq.recruitee.com/o/collections-expert', 'recruitee', 'bunq', 'collections-expert'],
    ['https://chrono24.jobs.personio.de/job/2827202?language=en', 'personio', 'chrono24', '2827202'],
    ['https://acme.jobs.personio.com/', 'personio', 'acme.com', null],
    ['https://career.teamtailor.com/jobs/8636263-solution-architect', 'teamtailor', 'career', '8636263'],
    ['https://asuresoftware.bamboohr.com/careers/1053/', 'bamboohr', 'asuresoftware', '1053'],
    ['https://forge-nano.breezy.hr/p/ef317746553f-application-engineer-i', 'breezy', 'forge-nano', 'ef317746553f'],
    ['https://lamons.applytojob.com/apply/6SA4nACfmW/Business-Intelligence-Analyst', 'jazzhr', 'lamons', '6SA4nACfmW'],
    ['https://ats.rippling.com/flexai/jobs/93ada67c-8527-427c-b2f6-4a5557b00674', 'rippling', 'flexai', '93ada67c-8527-427c-b2f6-4a5557b00674'],
    ['https://wolve.pinpointhq.com/en/postings/e03d9864-a128-40ff-91b5-dfc9fd1b59d6?ats=pinpointhq', 'pinpoint', 'wolve', 'e03d9864-a128-40ff-91b5-dfc9fd1b59d6'],
    ['https://www.comeet.com/jobs/monday/41.00B', 'comeet', 'monday/41.00B', null],
    ['https://careers-gdms.icims.com/jobs/12345/software-engineer/job', 'icims', 'careers-gdms', '12345'],
    ['https://careers.garmin.com/jobs/18475?icims=1', 'icims', null, '18475'],
    ['https://textron.taleo.net/careersection/textron/jobdetail.ftl?job=342666', 'taleo', 'textron/textron', '342666'],
    ['https://career4.successfactors.com/career?company=acmecorp&career_job_req_id=123456', 'successfactors', 'acmecorp@career4.successfactors.com', '123456'],
    ['https://eedu.fa.em3.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1003/job/202601653', 'other', 'eedu.fa.em3.oraclecloud.com/CX_1003', '202601653'],
    ['https://jobs.jobvite.com/iboss/job/orvdAfwt?nl=1', 'other', 'iboss', 'orvdAfwt'],
    ['https://www.linkedin.com/jobs/view/123456', null, null, null],
    ['https://remoteok.com/remote-jobs/123', null, null, null],
    ['not a url', null, null, null],
  ];
  await check(`detects ${SAMPLES.length} URL samples (ATS, token, job id)`, () => {
    const wrong: string[] = [];
    for (const [url, ats, token, jobId] of SAMPLES) {
      const h = detectAts(url);
      const got = [h?.ats ?? null, h?.token ?? null, h?.jobId ?? null];
      if (JSON.stringify(got) !== JSON.stringify([ats, token, jobId])) wrong.push(`${url} → ${JSON.stringify(got)}`);
    }
    assert.equal(wrong.length, 0, wrong.join('\n'));
    assert.ok(SAMPLES.filter((s) => s[1]).length >= 30);
  });
  await check('canonical apply URLs collapse tracking and apply sub-pages', () => {
    assert.equal(canonicalApplyUrl('https://boards.greenhouse.io/Stripe/jobs/7737124?gh_src=x&utm_source=y'), 'https://job-boards.greenhouse.io/stripe/jobs/7737124');
    assert.equal(canonicalApplyUrl('https://jobs.lever.co/ivo/3CE9DC16-90fd-4b99-b4b9-dfd48ec1a50d/apply'), 'https://jobs.lever.co/ivo/3ce9dc16-90fd-4b99-b4b9-dfd48ec1a50d');
    assert.equal(canonicalApplyUrl('https://jobs.ashbyhq.com/openai/1f8425be-cd39-4397-a9c1-6511ecfc39fc/application'), 'https://jobs.ashbyhq.com/openai/1f8425be-cd39-4397-a9c1-6511ecfc39fc');
    assert.equal(canonicalApplyUrl('https://jobs.smartrecruiters.com/ServiceNow/744000159057430-staff-software-engineer?oga=true'), 'https://jobs.smartrecruiters.com/ServiceNow/744000159057430');
    assert.equal(canonicalApplyUrl('https://apply.workable.com/tickpick/j/5840eceb50/apply'), 'https://apply.workable.com/tickpick/j/5840ECEB50');
    assert.equal(canonicalApplyUrl('https://www.example.com/careers/123/?utm_campaign=z#apply'), 'https://example.com/careers/123');
  });
  await check('DOM fingerprints find embedded boards', () => {
    const html = `<script>Grnhse.Settings.boardToken = "acmeco";</script><a href="https://jobs.lever.co/acme/3ce9dc16-90fd-4b99-b4b9-dfd48ec1a50d">x</a>
      <div id="BambooHR" data-domain="acmehr.bamboohr.com"></div><iframe src="//jobs.ashbyhq.com/acme-ai/embed"></iframe>`;
    const hits = detectAtsInHtml(html);
    assert.deepEqual(hits[0], { ats: 'lever', token: 'acme', jobId: '3ce9dc16-90fd-4b99-b4b9-dfd48ec1a50d', boardUrl: 'https://jobs.lever.co/acme', platform: 'lever' });
    const keys = hits.map((h) => `${h.ats}:${h.token}`);
    for (const k of ['greenhouse:acmeco', 'bamboohr:acmehr', 'ashby:acme-ai']) assert.ok(keys.includes(k), `${k} in ${keys}`);
    assert.deepEqual(findAtsUrls('Apply: https://jobs.lever.co/acme/3ce9dc16-90fd-4b99-b4b9-dfd48ec1a50d. Or email.'), ['https://jobs.lever.co/acme/3ce9dc16-90fd-4b99-b4b9-dfd48ec1a50d']);
    assert.equal(employerDomain('https://careers.acme.io/jobs'), 'acme.io');
    assert.equal(employerDomain('https://boards.greenhouse.io/acme'), null);
    assert.equal(boardUrlFor('workday', 'nvidia:wd5:NVIDIAExternalCareerSite'), 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');
  });

  // ── Politeness ────────────────────────────────────────────────────────────
  section('Scout · robots.txt and politeness');
  await check('robots.txt rules: longest match wins, allow wins ties, wildcards', () => {
    const r = http.parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /search\nAllow: /search/jobs$\nDisallow: /*?s=*\nCrawl-delay: 2\n');
    assert.equal(r.crawlDelayMs, 2000);
    assert.equal(http.robotsAllows(r.rules, '/jobs/1'), true);
    assert.equal(http.robotsAllows(r.rules, '/search?q=x'), false);
    assert.equal(http.robotsAllows(r.rules, '/search/jobs'), true);
    assert.equal(http.robotsAllows(r.rules, '/a?s=b'), false);
    assert.equal(http.robotsAllows(http.parseRobots('User-agent: bureau\nDisallow: /\nUser-agent: *\nAllow: /').rules, '/x'), false);
  });
  await check('a robots-disallowed page is refused before any request', async () => {
    await assert.rejects(http.getText('https://blocked.example.org/private/page', { robots: true }), /robots\.txt disallows/);
    assert.ok(!requested.includes('https://blocked.example.org/private/page'));
    await http.getText('https://blocked.example.org/private/ok', { robots: true }).catch(() => {});
    assert.ok(requested.includes('https://blocked.example.org/private/ok'));
  });

  // ── Connectors against recorded payloads ─────────────────────────────────
  section('Scout · connectors (recorded payloads)');
  const expectAts: Record<string, AtsFamily> = Object.fromEntries(Object.entries(TARGETS).map(([ats]) => [ats, ats as AtsFamily]));
  const byId = Object.fromEntries(CONNECTORS.map((c) => [c.id, c])) as Record<string, Connector>;
  await check(`${CONNECTORS.length} connectors registered, ids unique, v1 sixteen kept`, () => {
    assert.equal(new Set(CONNECTORS.map((c) => c.id)).size, CONNECTORS.length);
    for (const id of ['greenhouse', 'lever', 'ashby', 'remotive', 'remoteok', 'weworkremotely', 'himalayas', 'workingnomads', 'nichefeeds', 'gamedev', 'jobicy', 'arbeitnow', 'themuse', 'hackernews', 'reddit', 'simplify']) {
      assert.ok(byId[id], id);
    }
    const polled = CONNECTORS.filter((c) => c.ats).map((c) => c.ats);
    assert.ok(polled.length >= 14, `ATS families polled: ${polled.length}`);
    for (const ats of registry.POLLED_ATS) assert.ok(polled.includes(ats), `connector for ${ats}`);
  });
  const results: Record<string, RawJob[]> = {};
  for (const c of CONNECTORS) {
    if (c.id === 'jobspy') continue;
    await check(`${c.id}: parses its recorded payload`, async () => {
      const jobs = await c.run(ctx());
      results[c.id] = jobs;
      assert.ok(jobs.length > 0, 'no jobs parsed');
      for (const j of jobs) {
        assert.ok(j.title && j.title.trim(), `title missing in ${JSON.stringify(j).slice(0, 120)}`);
        assert.ok(j.company, 'company');
        assert.ok(/^https?:\/\//.test(j.url), `url ${j.url}`);
        assert.ok(j.externalId, 'externalId');
        assert.equal(typeof j.remote, 'boolean');
        if (j.postedAt) assert.ok(!Number.isNaN(Date.parse(j.postedAt)), `postedAt ${j.postedAt}`);
      }
      if (c.ats) {
        for (const j of jobs) {
          assert.equal(j.ats, expectAts[c.ats], 'ats set');
          assert.ok(j.applyUrl && /^https:\/\//.test(j.applyUrl), 'applyUrl set');
        }
      }
    });
  }
  await check('connector field mapping spot checks', () => {
    const gh = results.greenhouse[0];
    assert.match(gh.applyUrl!, /^https:\/\/job-boards\.greenhouse\.io\/bungie\/jobs\/\d+$/);
    assert.ok((gh.descriptionText ?? '').length > 200 && !/&lt;/.test(gh.descriptionHtml ?? ''));
    const wd = results.workday.find((j) => /Security Software/.test(j.title)) ?? results.workday[0];
    assert.equal(wd.company, 'Nvidia');
    assert.match(wd.applyUrl!, /^https:\/\/nvidia\.wd5\.myworkdayjobs\.com\/NVIDIAExternalCareerSite\/job\//);
    const sr = results.smartrecruiters[0];
    assert.equal(sr.company, 'ServiceNow');
    assert.ok((sr.descriptionText ?? '').length > 200, 'SR description from detail');
    const per = results.personio.find((j) => /Full Stack/.test(j.title))!;
    assert.match(per.location, /Remote/);
    assert.equal(per.applyUrl, 'https://chrono24.jobs.personio.de/job/2827202');
    const bam = results.bamboohr[0];
    assert.equal(bam.salaryMin, 130000);
    assert.equal(bam.salaryMax, 160000);
    const jz = results.jazzhr[0];
    assert.equal(jz.postedAt, '2026-10-30T19:20:24.000Z');
    const tt = results.teamtailor[0];
    assert.ok(tt.tags?.includes('mode:hybrid'));
    const hn = results.hackernews;
    assert.ok(hn.every((j) => j.source === 'hackernews'));
    const yc = results.ycombinator.find((j) => j.externalId.startsWith('hn:'))!;
    assert.equal(yc.company, 'Wasmer');
    assert.ok(results.ycombinator.some((j) => j.externalId.startsWith('waas:')));
    const rz = results.rozee[0];
    assert.match(rz.url, /^https:\/\/www\.rozee\.pk\/[a-z0-9-]+-\d+$/);
    const mk = results.mustakbil[0];
    assert.match(mk.url, /^https:\/\/www\.mustakbil\.com\/jobs\/job\/\d+$/);
    assert.ok(mk.postedAt, 'relative time parsed');
    assert.ok(results.simplify.every((j) => j.applyUrl === j.url));
  });
  await check('detail fetches are skipped for postings already stored', async () => {
    const before = requested.filter((u) => /smartrecruiters\.com\/v1\/companies\/ServiceNow\/postings\/\d+/.test(u)).length;
    const jobs = await byId.smartrecruiters.run(ctx({ isKnown: () => true }));
    const after = requested.filter((u) => /smartrecruiters\.com\/v1\/companies\/ServiceNow\/postings\/\d+/.test(u)).length;
    assert.equal(after, before);
    assert.ok(jobs.length > 0);
  });
  await check('JobSpy rows map to RawJob with the employer link as applyUrl', () => {
    const doc = JSON.parse(feed('jobspy-sidecar-output.json')) as { jobs: Parameters<typeof jobspyRowToRaw>[0][] };
    const rows = doc.jobs.map(jobspyRowToRaw).filter((j): j is RawJob => !!j);
    assert.ok(rows.length >= 2);
    assert.ok(rows.some((r) => r.source === 'jobspy-indeed') && rows.some((r) => r.source === 'jobspy-linkedin'));
    const mapped = jobspyRowToRaw({ site: 'indeed', job_url: 'https://www.indeed.com/viewjob?jk=1', job_url_direct: 'https://jobs.lever.co/acme/3ce9dc16-90fd-4b99-b4b9-dfd48ec1a50d', title: 'Backend Engineer', company: 'Acme', min_amount: 50, max_amount: 60, interval: 'hourly', currency: 'USD', date_posted: '2026-10-30', emails: ['jobs@acme.io'] })!;
    assert.equal(mapped.salaryMin, 104000);
    assert.equal(mapped.applyUrl, 'https://jobs.lever.co/acme/3ce9dc16-90fd-4b99-b4b9-dfd48ec1a50d');
    assert.equal(mapped.applyEmail, 'jobs@acme.io');
  });

  // ── Normalisation ─────────────────────────────────────────────────────────
  section('Scout · normalisation');
  await check('salary text parsed and annualised', () => {
    assert.deepEqual(parseSalaryText('$120k – $150k'), { min: 120000, max: 150000, currency: 'USD', period: 'year' });
    assert.deepEqual(parseSalaryText('PKR 150,000 - 200,000 per month'), { min: 150000, max: 200000, currency: 'PKR', period: 'month' });
    assert.deepEqual(parseSalaryText('€55.000–€70.000 brutto per year'), { min: 55000, max: 70000, currency: 'EUR', period: 'year' });
    assert.deepEqual(parseSalaryText('$45 - $60 an hour'), { min: 45, max: 60, currency: 'USD', period: 'hour' });
    assert.equal(parseSalaryText('5 years of experience'), null);
    const n = normalizeJob({ source: 't', externalId: '1', title: 'Engineer', company: 'A', location: 'Remote', remote: false, url: 'https://x.io/1', tags: ['$45 - $60 an hour'] });
    assert.equal(n.salaryMin, 93600);
    assert.equal(n.salaryMax, 124800);
  });
  await check('relative dates, work mode, visa, seniority', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    assert.equal(relativePosted('Posted 3 Days Ago', now), '2026-10-30T12:00:00.000Z');
    assert.equal(relativePosted('Posted 30+ Days Ago', now), '2026-10-03T12:00:00.000Z');
    assert.equal(relativePosted('37 mins ago', now), new Date(now - 37 * 60_000).toISOString());
    assert.equal(relativePosted('Posted Yesterday', now), '2026-11-01T12:00:00.000Z');
    assert.equal(workMode({ remote: false, location: 'Berlin (Hybrid)', title: 'Dev', tags: [] }), 'hybrid');
    assert.equal(workMode({ remote: true, location: 'Anywhere', title: 'Dev', tags: [] }), 'remote');
    assert.equal(visaMention('We are unable to offer visa sponsorship for this role.'), 'no-sponsorship');
    assert.equal(visaMention('Visa sponsorship is available for the right candidate.'), 'sponsors');
    assert.equal(seniority('Sr. Software Engineer'), 'senior');
    assert.equal(seniority('Software Engineering Intern'), 'intern');
    assert.equal(seniority('Staff Engineer'), 'lead');
    assert.equal(seniority('Junior Developer'), 'junior');
    const n = normalizeJob({ source: 't', externalId: '1', title: 'Senior Backend Engineer', company: ' Acme ', location: 'Lahore', remote: false, url: 'https://x.io/1', descriptionText: 'Hybrid role. We are unable to sponsor visas.', postedAt: 'Posted 2 Days Ago' }, now);
    assert.deepEqual(n.tags?.slice(0, 3), ['mode:hybrid', 'visa:no-sponsorship', 'level:senior']);
    assert.equal(n.postedAt, '2026-10-31T12:00:00.000Z');
    assert.equal(relevantTitle('Civil Engineer', 'software'), false);
    assert.equal(relevantTitle('Embedded Software Engineer', 'software'), true);
  });

  // ── Dedupe, legitimacy, priority ──────────────────────────────────────────
  section('Scout · dedupe and filtering');
  const fresh = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const desc =
    'Dunder Robotics is hiring a backend engineer to build the payments platform: Go and PostgreSQL services, event streaming with Kafka, ' +
    'on-call for the ledger, and close work with product on reconciliation features. You have shipped production APIs and care about correctness.';
  await check('the same job from 3 sources collapses to 1, sources linked, ATS route kept', async () => {
    const jobs: RawJob[] = [
      { source: 'greenhouse', externalId: 'dunderrobotics:9001', title: 'Senior Backend Engineer, Payments', company: 'Dunder Robotics', location: 'Remote - US', remote: true, url: 'https://boards.greenhouse.io/dunderrobotics/jobs/9001', applyUrl: 'https://job-boards.greenhouse.io/dunderrobotics/jobs/9001', ats: 'greenhouse', descriptionText: `${desc} ${desc}`, postedAt: fresh, salaryMin: 150000, salaryMax: 190000, salaryCurrency: 'USD' },
      { source: 'himalayas', externalId: 'h-1', title: 'Senior Backend Engineer, Payments', company: 'Dunder Robotics Inc.', location: 'Worldwide', remote: true, url: 'https://himalayas.app/companies/dunder/jobs/backend', applyUrl: 'https://boards.greenhouse.io/dunderrobotics/jobs/9001?gh_src=himalayas', descriptionText: desc, postedAt: fresh },
      { source: 'jobicy', externalId: 'j-77', title: 'Sr. Backend Engineer (Payments)', company: 'Dunder Robotics', location: 'USA', remote: true, url: 'https://jobicy.com/jobs/77-backend', descriptionText: desc.slice(0, 200), postedAt: fresh },
    ];
    const r = await ingestJobs(jobs, { maxAgeDays: 30 });
    assert.equal(r.stats.inserted, 1, JSON.stringify(r.stats));
    assert.equal(r.stats.dupBatchUrl + r.stats.dupBatchFingerprint, 2);
    const row = get<{ id: string; ats: string; apply_url_canonical: string; sources: string; legitimacy: string; priority: number; salary_min: number; company_id: string }>(
      'SELECT id, ats, apply_url_canonical, sources, legitimacy, priority, salary_min, company_id FROM jobs WHERE id = ?',
      r.added[0],
    )!;
    assert.equal(row.ats, 'greenhouse');
    assert.equal(row.apply_url_canonical, 'https://job-boards.greenhouse.io/dunderrobotics/jobs/9001');
    assert.deepEqual(JSON.parse(row.sources).map((s: { source: string }) => s.source).sort(), ['greenhouse', 'himalayas', 'jobicy']);
    assert.equal(row.legitimacy, 'ok');
    assert.equal(row.priority, 2, 'fresh under 48h');
    assert.equal(row.salary_min, 150000);
    assert.ok(row.company_id);
    assert.equal(pipelineState(row.id)?.state, 'found');
    assert.ok(get('SELECT 1 FROM job_embeddings WHERE job_id = ? AND model = ?', row.id, 'hash-384'), 'embedding stored with its model');
    // A later run from yet another source merges into the stored row.
    const again = await ingestJobs([{ ...jobs[2], source: 'remoteok', externalId: 'rok-5', url: 'https://remoteok.com/remote-jobs/5' }], { maxAgeDays: 30 });
    assert.equal(again.stats.inserted, 0);
    assert.equal(again.stats.dupDbFingerprint + again.stats.dupDbUrl, 1);
    assert.equal(JSON.parse(get<{ sources: string }>('SELECT sources FROM jobs WHERE id = ?', row.id)!.sources).length, 4);
    assert.ok(isKnownUrl('https://boards.greenhouse.io/dunderrobotics/jobs/9001?utm_source=x'));
  });
  await check('embedding layer catches re-worded duplicates of the same company, keeps distinct roles', async () => {
    const base = { company: 'Quokka Labs', location: 'Remote', remote: true, postedAt: fresh } as const;
    const a = await ingestJobs([{ ...base, source: 'lever', externalId: 'q1', title: 'Platform Engineer, Kubernetes', url: 'https://jobs.lever.co/quokka/11111111-1111-4111-8111-111111111111', descriptionText: desc }], { maxAgeDays: 30 });
    assert.equal(a.stats.inserted, 1);
    const b = await ingestJobs(
      [
        { ...base, source: 'weworkremotely', externalId: 'w9', title: 'Senior Kubernetes Platform Engineer', url: 'https://weworkremotely.com/remote-jobs/quokka-k8s', descriptionText: desc },
        { ...base, source: 'weworkremotely', externalId: 'w10', title: 'iOS Developer', url: 'https://weworkremotely.com/remote-jobs/quokka-ios', descriptionText: 'Build the Quokka iPhone app in Swift and SwiftUI, own releases, accessibility and crash-free sessions. Work with design daily on our consumer product.' },
      ],
      { maxAgeDays: 30 },
    );
    assert.equal(b.stats.dupEmbedding, 1, JSON.stringify(b.stats));
    assert.equal(b.stats.inserted, 1);
    assert.ok(titleSimilarity('Platform Engineer, Kubernetes', 'Senior Kubernetes Platform Engineer') >= 0.5);
  });
  await check('ghost and scam filter marks (never deletes); disclaimers are not scams', () => {
    const job = (over: Partial<RawJob>): RawJob => ({ source: 'x', externalId: '1', title: 'Software Engineer', company: 'Acme', location: '', remote: true, url: 'https://x.io/1', descriptionText: 'A long enough description of the role and the team and the stack and the product.', ...over });
    const scam = assessLegitimacy({ job: job({ descriptionText: 'Work from home! Pay a small registration fee of $50 to start. Contact on WhatsApp.', applyEmail: 'hr.jobs@gmail.com' }), maxAgeDays: 30, hasApplyRoute: true, fromAts: false });
    assert.equal(scam.legitimacy, 'scam');
    const disclaimer = assessLegitimacy({ job: job({ descriptionText: 'It is against our policy for candidates to pay any fee. No agency will ask candidates to pay a fee at any time.' }), maxAgeDays: 30, hasApplyRoute: true, fromAts: true });
    assert.equal(disclaimer.legitimacy, 'ok');
    assert.equal(assessLegitimacy({ job: job({}), repostCount: 3, maxAgeDays: 30, hasApplyRoute: true, fromAts: true }).legitimacy, 'ghost');
    assert.equal(assessLegitimacy({ job: job({ title: 'General Application - Talent Pool' }), maxAgeDays: 30, hasApplyRoute: true, fromAts: true }).legitimacy, 'ghost');
    assert.equal(assessLegitimacy({ job: job({ applyEmail: 'boss@gmail.com', company: 'Unknown' }), maxAgeDays: 30, hasApplyRoute: true, fromAts: false }).legitimacy, 'suspect');
    assert.equal(repostCount([1, 2, 3].map((i) => ({ source: 'indeed', externalId: String(i), url: '', loc: 'lahore', seenAt: '' }))), 3);
    assert.equal(priorityFor(new Date().toISOString(), true), 3);
    assert.equal(priorityFor(new Date(Date.now() - 5 * 86_400_000).toISOString(), false), 0);
  });
  await check('v1 ingest() adapter fills the v2 columns and enters the pipeline', async () => {
    const { ingest } = await import('../../server/services/scanner.ts');
    const r = ingest([{ source: 'capture', externalId: 'c1', title: 'Security Engineer', company: 'Wombat Security', location: 'Karachi', remote: false, url: 'https://apply.workable.com/wombat/j/ABC123DEF0', descriptionText: desc, postedAt: fresh }], 3650);
    assert.equal(r.added.length, 1);
    const row = get<{ ats: string; apply_url_canonical: string; legitimacy: string }>('SELECT ats, apply_url_canonical, legitimacy FROM jobs WHERE id = ?', r.added[0])!;
    assert.equal(row.ats, 'workable');
    assert.equal(row.apply_url_canonical, 'https://apply.workable.com/wombat/j/ABC123DEF0');
    assert.equal(pipelineState(r.added[0])?.state, 'found');
    assert.equal(registry.findByAts('workable', 'wombat')?.status, 'active', 'apply URL discovered its board');
    assert.equal(ingestSync([{ source: 'capture', externalId: 'c1', title: 'Security Engineer', company: 'Wombat Security', location: 'Karachi', remote: false, url: 'https://apply.workable.com/wombat/j/ABC123DEF0' }], { maxAgeDays: 3650 }).added.length, 0);
  });

  // ── Registry, discovery, signals ──────────────────────────────────────────
  section('Scout · company registry');
  await check('seeds 3,000+ companies once, idempotently', () => {
    const first = registry.seedRegistry();
    const second = registry.seedRegistry();
    assert.ok(first.total >= 3000, `seeded ${first.total}`);
    assert.equal(second.added, 0);
    const stats = registry.registryStats();
    for (const ats of ['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable'] as const) assert.ok((stats.byAts[ats] ?? 0) > 0, ats);
  });
  await check('grows from apply URLs seen anywhere (discovery)', () => {
    const added = registry.discoverUrls(['https://jobs.ashbyhq.com/newco-ai/1f8425be-cd39-4397-a9c1-6511ecfc39fc', 'https://jobs.ashbyhq.com/newco-ai', 'https://example.com/jobs/1'], 'test');
    assert.equal(added, 1);
    const c = registry.findByAts('ashby', 'newco-ai')!;
    assert.equal(c.status, 'active');
    assert.equal(c.discoveredVia, 'discovery:test');
    const research = mineResearch('Acme Robotics raised $40 million Series B last week. Openings: https://boards.greenhouse.io/acmerobotics/jobs/123', []);
    assert.equal(research.boards, 1);
    assert.equal(research.funding, 1);
    assert.ok(registry.findByName('Acme Robotics')?.signals.some((s) => s.type === 'funding'));
  });
  await check('open-role jumps of 30%+ raise a hiring signal and move the board to the front', () => {
    registry.upsertCompany({ ats: 'greenhouse', token: 'growthco', name: 'GrowthCo', discoveredVia: 'test' });
    assert.equal(registry.recordBoard('greenhouse', 'growthco', { ok: true, count: 10 }), null);
    const sig = registry.recordBoard('greenhouse', 'growthco', { ok: true, count: 14 });
    assert.equal(sig?.type, 'roles_jump');
    assert.equal(registry.findByAts('greenhouse', 'growthco')?.openRoles, 14);
    const order = registry.targetsForAts('greenhouse', 5).map((t) => t.token);
    assert.ok(order.slice(0, 2).includes('growthco'), `signal boards first: ${order}`);
    registry.recordBoard('greenhouse', 'growthco-gone', { ok: false, count: 0, status: 404 });
    assert.equal(registry.findByAts('greenhouse', 'growthco-gone')?.status, 'dead');
  });
  await check('add a careers URL: ATS from the URL, else from the page DOM', async () => {
    const a = await registry.addCareersUrl({ url: 'https://apply.workable.com/huggingface/', name: 'Hugging Face' });
    assert.equal(a.via, 'url');
    assert.equal(a.company.ats, 'workable');
    const b = await registry.addCareersUrl({ url: 'https://acme-careers.example.org/careers', name: 'Acme Co' });
    assert.equal(b.via, 'dom');
    assert.equal(b.company.ats, 'greenhouse');
    assert.equal(b.company.atsToken, 'acmeco');
  });
  await check('resolver follows an aggregator link to the employer ATS (robots-checked)', async () => {
    http.setTransport(async (url) => {
      if (url.endsWith('/robots.txt')) return { ok: false, status: 404, url, contentType: 'text/plain', text: () => '', json: <T>() => ({}) as T };
      const html = '<html><body><a class="apply" href="https://jobs.lever.co/resolvedco/22222222-2222-4222-8222-222222222222/apply">Apply</a></body></html>';
      return { ok: true, status: 200, url, contentType: 'text/html', text: () => html, json: <T>() => ({}) as T };
    });
    const job: RawJob = { source: 'remotive', externalId: '1', title: 'Engineer', company: 'ResolvedCo', location: '', remote: true, url: 'https://remotive.com/remote-jobs/software-dev/engineer-1' };
    const st = await resolveApplyUrls([job], { budget: { left: 5 }, deadline: Date.now() + 10_000 });
    assert.equal(st.resolved, 1);
    assert.equal(job.applyUrl, 'https://jobs.lever.co/resolvedco/22222222-2222-4222-8222-222222222222/apply');
    const skip: RawJob = { ...job, url: 'https://www.linkedin.com/jobs/view/1' };
    assert.equal((await resolveApplyUrls([skip], { budget: { left: 5 }, deadline: Date.now() + 10_000 })).tried, 0, 'guest-search pages are never fetched');
  });
  // Restore the fixture transport for the rest.
  http.setTransport(async (url) => {
    requested.push(url);
    const hit = ROUTES.find(([re]) => re.test(url));
    const body = hit ? (hit[1] ? feed(hit[1]) : (hit[2] ?? '')) : 'not found';
    return { ok: !!hit, status: hit ? 200 : 404, url, contentType: /<html/i.test(body) ? 'text/html' : 'application/json', text: () => body, json: <T>() => JSON.parse(body) as T };
  });
  await check('weekly discovery uses site: searches and feeds the registry (injected search)', async () => {
    const r = await weeklyDiscovery({ categories: ['security'], force: true }, async () => ({
      text: 'Found: https://jobs.ashbyhq.com/discoveredsec/33333333-3333-4333-8333-333333333333',
      sources: [{ url: 'https://boards.greenhouse.io/discoveredsec2/jobs/1', title: 'x' }],
    }));
    assert.equal(r.ran, true);
    assert.equal(r.added, 2);
  });

  // ── JobSpy, end-to-end run, health, routes ────────────────────────────────
  section('Scout · JobSpy sidecar and full run');
  await check('missing Python → JobSpy reports unavailable, never throws into the scan', async () => {
    resetJobspyStatus();
    const s = await jobspyStatus(true);
    assert.equal(s.available, false);
    assert.match(s.reason ?? '', /setup-sidecar/);
    await assert.rejects(byId.jobspy.run(ctx()), (e: unknown) => e instanceof SourceUnavailable);
  });
  await check('runScout end to end offline: JobSpy unavailable, others ingested, health recorded', async () => {
    saveScoutSettings({ discoveryEnabled: false, resolvePerRun: 0 });
    const before = (get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs')?.n ?? 0) as number;
    const r = await scoutPipeline({ sources: ['jobspy', 'pythonjobs', 'workday', 'personio', 'rozee'], recordScan: true, log: () => {} });
    assert.equal(r.connectors.jobspy.unavailable, true);
    assert.ok(r.connectors.pythonjobs.found > 0 && !r.connectors.pythonjobs.error);
    assert.ok(r.added.length > 0, JSON.stringify(r.stats));
    const after = get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs')?.n ?? 0;
    assert.equal(after - before, r.added.length);
    for (const id of r.added) assert.equal(pipelineState(id)?.state, 'found');
    const health = Object.fromEntries(sourceHealth().map((h) => [h.id, h]));
    assert.equal(health.jobspy.status, 'unavailable');
    assert.equal(health.pythonjobs.status, 'ok');
    assert.ok(health.workday.boardsOk! >= 0);
    assert.ok(['disabled', 'idle', 'ok'].includes(health.lever.status));
    // A second pass finds nothing new: everything is a known duplicate.
    const again = await scoutPipeline({ sources: ['pythonjobs'], log: () => {} });
    assert.equal(again.added.length, 0);
    assert.ok(again.stats.dupDbUrl + again.stats.dupDbFingerprint > 0);
  });
  await check('/api/scout routes: health, detect, companies, settings', async () => {
    const Fastify = (await import('fastify')).default;
    const { scoutRoutes } = await import('../../server/scout/routes.ts');
    const app = Fastify();
    app.setErrorHandler((err: Error & { status?: number }, _req, reply) => reply.status(err.status ?? 500).send({ message: err.message }));
    await app.register(scoutRoutes);
    const health = (await app.inject({ method: 'GET', url: '/api/scout/health' })).json() as { sources: { id: string }[]; jobspy: { available: boolean } };
    assert.ok(health.sources.length >= CONNECTORS.length);
    assert.equal(health.jobspy.available, false);
    const det = (await app.inject({ method: 'POST', url: '/api/scout/detect', payload: { url: 'jobs.lever.co/acme' } })).json() as { detected: { ats: string } };
    assert.equal(det.detected.ats, 'lever');
    const add = await app.inject({ method: 'POST', url: '/api/scout/companies', payload: { url: 'https://jobs.smartrecruiters.com/Ubisoft2/744000158084745', name: 'Ubisoft' } });
    assert.equal(add.statusCode, 200);
    assert.equal((add.json() as { company: { ats: string } }).company.ats, 'smartrecruiters');
    const list = (await app.inject({ method: 'GET', url: '/api/scout/companies?q=ubisoft' })).json() as { companies: { name: string }[]; total: number };
    assert.ok(list.total >= 1);
    const stats = await app.inject({ method: 'GET', url: '/api/scout/stats' });
    assert.equal(stats.statusCode, 200);
    const bad = await app.inject({ method: 'PUT', url: '/api/scout/settings', payload: { embedThreshold: 5 } });
    assert.equal(bad.statusCode, 400);
    const ok = (await app.inject({ method: 'PUT', url: '/api/scout/settings', payload: { detailBudget: 25 } })).json() as { detailBudget: number };
    assert.equal(ok.detailBudget, 25);
    await app.close();
  });

  http.setTransport(null);
  void db;
  void run;
  void all;
}
