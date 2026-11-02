import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Harness } from '../lib/harness.ts';

/** A02 matcher: scoring, normalisation, hard filters, similarity, recorded assessments, prompt caching, cost, selection, routes, v1 compatibility. */
export default async function a02Match({ check, section }: Harness) {
  const { now, run, get, all } = await import('../../server/db.ts');
  const { transition, pipelineState } = await import('../../server/campaign/pipeline.ts');
  const { CampaignConfigSchema } = await import('../../server/contracts/campaign.ts');
  const { MatchResultSchema, STRETCH_ALLOWANCE } = await import('../../server/contracts/match.ts');
  const { structured, replayHash, MODEL_CHOICES, modelFor } = await import('../../server/ai/claude.ts');
  const { taskCost } = await import('../../server/ai/cost.ts');
  const { HASH_MODEL, toBlob, embed } = await import('../../server/ai/embed.ts');
  const scoring = await import('../../server/match/scoring.ts');
  const { scoreMatch, normaliseRequirements, stretchPenalty, gradeFor, yearsOutOfReach, BLOCKER_CAP } = scoring;
  const { hardFilter, buildFilterContext, remoteRestriction, annualise } = await import('../../server/match/filters.ts');
  const { companyNameKey } = await import('../../server/match/companies.ts');
  const { jobSimilarity } = await import('../../server/match/similarity.ts');
  const { buildSystemBlocks, renderBatchContent } = await import('../../server/match/assessment.ts');
  const { finalise } = await import('../../server/match/engine.ts');
  const { matchJobs, selectForCampaign, pendingForMatch, planSelection, readMatch, SCORE_TOOLTIP, MATCH_RUBRIC } = await import('../../server/match/index.ts');
  const { rejectedMatch } = await import('../../server/match/store.ts');
  const { matchRoutes } = await import('../../server/match/routes.ts');
  const { profileEmbeddingText, toMatchProfile } = await import('../../server/match/profile.ts');
  const { FIXTURE_ASSESSMENTS, FIXTURE_JOBS, FIXTURE_NOW, TEST_PROFILE, TEST_V1_PROFILE } = await import('../../server/match/fixtures.ts');
  const { SCORING_RUBRIC } = await import('../../server/ai/prompts.ts');
  const { AppError } = await import('../../server/errors.ts');
  const { scoreJobs, computeScore } = await import('../../server/ai/score.ts');
  type MatchJob = import('../../server/match/jobs.ts').MatchJob;
  type CampaignConfig = import('../../server/contracts/campaign.ts').CampaignConfig;
  type NormalisedRequirement = import('../../server/match/scoring.ts').NormalisedRequirement;

  // The assumed per-call estimate, taken before this module's replayed calls turn it into a measured average.
  const estimateBefore = taskCost('match');
  const RECORD_HINT = 'recordings are stale: run `npx tsx server/match/record-fixtures.ts`';
  const day = 86_400_000;
  const ago = (days: number) => new Date(Date.parse(FIXTURE_NOW) - days * day).toISOString();

  const cfgOf = (over: Partial<CampaignConfig> = {}): CampaignConfig =>
    CampaignConfigSchema.parse({
      startsAt: ago(1),
      endsAt: ago(-30),
      roles: ['Full-Stack Developer'],
      categories: ['web', 'software', 'data_ai'],
      locations: ['Remote', 'Lahore, Pakistan'],
      remoteOnly: false,
      stretchLevel: 'balanced',
      minScore: 60,
      dailyCap: 10,
      companyCooldownDays: 30,
      activeHours: { tz: 'Asia/Karachi', start: '09:00', end: '18:00' },
      pacingMinutes: { min: 8, max: 25 },
      budgetUsd: 20,
      dryRunDays: 0,
      channels: { email: true, forms: true, agent: true },
      sources: {},
      ...over,
    });

  const baseJob = (j: Partial<MatchJob> & { id: string }): MatchJob => ({
    title: 'Full-Stack Developer',
    company: 'Testco',
    companyId: null,
    location: 'Remote',
    remote: true,
    category: 'web',
    descriptionText: 'React, TypeScript and Node.js role.',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: ago(1),
    foundAt: ago(1),
    prefilterScore: 70,
    legitimacy: 'ok',
    priority: 0,
    status: 'new',
    url: `https://jobs.example.com/${j.id}`,
    applyUrl: null,
    applyEmail: null,
    ...j,
  });

  function insertJob(j: MatchJob) {
    run(
      `INSERT OR REPLACE INTO jobs (id, fingerprint, source, url, title, company, company_id, location, remote, category, description_text,
         salary_min, salary_max, salary_currency, posted_at, found_at, prefilter_score, legitimacy, priority, status, updated_at)
       VALUES (?, ?, 'test', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      j.id,
      `fp-${j.id}`,
      j.url,
      j.title,
      j.company,
      j.companyId,
      j.location,
      j.remote ? 1 : 0,
      j.category,
      j.descriptionText,
      j.salaryMin,
      j.salaryMax,
      j.salaryCurrency,
      j.postedAt,
      j.foundAt,
      j.prefilterScore,
      j.legitimacy,
      j.priority,
      j.status,
      now(),
    );
    return j;
  }

  const req = (over: Partial<NormalisedRequirement>): NormalisedRequirement => ({
    text: 'Skill',
    importance: 'important',
    evidence: 'stated',
    match: 'met',
    proof: 'did it',
    blocker: false,
    blockerKind: 'none',
    proofKind: 'direct',
    adjusted: '',
    ...over,
  });
  const dims = { skills: 4, experience: 4, domain: 3, logistics: 5, compensation: 3, growth: 4 };
  const input = (requirements: NormalisedRequirement[], over: Partial<Parameters<typeof scoreMatch>[0]> = {}) => ({
    requirements,
    dimensions: dims,
    legitimacy: 'ok' as const,
    preRank: 70,
    stretchLevel: 'balanced' as const,
    postedAt: ago(10),
    hiringSignal: false,
    now: FIXTURE_NOW,
    ...over,
  });

  // ── Scoring ────────────────────────────────────────────────────────────────
  section('A02 matcher: scoring (chance of passing the screen)');
  await check('a true blocker caps the score at 35, even with perfect inputs and every boost', () => {
    const perfect = [req({ importance: 'critical' }), req({}), req({ importance: 'nice' })];
    const free = scoreMatch(input(perfect, { dimensions: { skills: 5, experience: 5, domain: 5, logistics: 5, compensation: 5, growth: 5 }, preRank: 100 }));
    assert.ok(free.screenPassScore > 90, `uncapped ${free.screenPassScore}`);
    const blocked = scoreMatch(
      input([...perfect, req({ importance: 'critical', blocker: true, blockerKind: 'clearance', match: 'missing', proof: '', proofKind: 'none', text: 'Secret clearance' })], {
        dimensions: { skills: 5, experience: 5, domain: 5, logistics: 5, compensation: 5, growth: 5 },
        preRank: 100,
        postedAt: ago(0.5),
        hiringSignal: true,
      }),
    );
    assert.equal(blocked.screenPassScore, BLOCKER_CAP);
    assert.deepEqual(blocked.breakdown.blockers, ['Secret clearance']);
  });
  await check('a blocker the candidate meets (e.g. holds the licence) does not cap', () => {
    const r = scoreMatch(input([req({ importance: 'critical', blocker: true, blockerKind: 'licence', text: 'Licence' }), req({})]));
    assert.ok(r.screenPassScore > BLOCKER_CAP && !r.breakdown.blockers.length);
  });
  await check('stretch levels: conservative allows 1 missing important, balanced 3, aggressive 5', () => {
    assert.deepEqual(STRETCH_ALLOWANCE, { conservative: 1, balanced: 3, aggressive: 5 });
    const four = [req({ importance: 'critical' }), req({ importance: 'critical' }), req({}), req({}), ...[1, 2, 3, 4].map((i) => req({ text: `gap ${i}`, match: 'missing', proof: '', proofKind: 'none' }))];
    const at = (level: 'conservative' | 'balanced' | 'aggressive') => scoreMatch(input(four, { stretchLevel: level }));
    const c = at('conservative');
    const b = at('balanced');
    const a = at('aggressive');
    assert.equal(c.breakdown.stretch.excess, 3);
    assert.equal(b.breakdown.stretch.excess, 1);
    assert.equal(a.breakdown.stretch.excess, 0);
    assert.equal(c.breakdown.stretch.penalty, 24);
    assert.equal(b.breakdown.stretch.penalty, 6);
    assert.equal(a.breakdown.stretch.penalty, 0);
    assert.ok(c.screenPassScore < b.screenPassScore && b.screenPassScore < a.screenPassScore, `${c.screenPassScore} < ${b.screenPassScore} < ${a.screenPassScore}`);
    // Within the allowance there is no penalty at all.
    const one = [req({ importance: 'critical' }), req({}), req({ match: 'missing', proof: '', proofKind: 'none' })];
    assert.equal(scoreMatch(input(one, { stretchLevel: 'conservative' })).breakdown.stretch.penalty, 0);
  });
  await check('beyond the allowance the penalty steps up, each step bigger than the last', () => {
    const steps = [0, 1, 2, 3, 4, 5, 6, 7].map(stretchPenalty);
    assert.deepEqual(steps.slice(0, 6), [0, 6, 14, 24, 36, 50]);
    for (let i = 2; i < steps.length; i++) assert.ok(steps[i] - steps[i - 1] >= steps[i - 1] - steps[i - 2], `step ${i}`);
  });
  await check('missing critical (non-blocker) requirements count toward the stretch too', () => {
    const r = scoreMatch(input([req({ importance: 'critical', match: 'missing', proof: '', proofKind: 'none' }), req({})], { stretchLevel: 'balanced' }));
    assert.equal(r.breakdown.stretch.unmetCritical, 1);
    assert.equal(r.breakdown.stretch.unmetImportant, 0);
  });
  await check('unmet "nice" requirements barely matter', () => {
    const core = [req({ importance: 'critical' }), req({}), req({})];
    const nice = (i: number, m: 'met' | 'missing') => req({ importance: 'nice', text: `nice ${i}`, match: m, proof: m === 'met' ? 'yes' : '', proofKind: m === 'met' ? 'direct' : 'none' });
    const all3 = scoreMatch(input([...core, nice(1, 'met'), nice(2, 'met'), nice(3, 'met')])).screenPassScore;
    const one = scoreMatch(input([...core, nice(1, 'met'), nice(2, 'met'), nice(3, 'missing')])).screenPassScore;
    const none = scoreMatch(input([...core, nice(1, 'missing'), nice(2, 'missing'), nice(3, 'missing')])).screenPassScore;
    assert.ok(all3 - one <= 3, `one missing nice item costs ${all3 - one}`);
    assert.ok(all3 - none <= 9, `all nice items missing costs ${all3 - none}`);
    // The same three items as "important" and missing hurt more.
    const imp = scoreMatch(input([...core, ...[1, 2, 3].map((i) => req({ text: `imp ${i}`, match: 'missing', proof: '', proofKind: 'none' }))])).screenPassScore;
    assert.ok(all3 - imp > all3 - none, `important gap ${all3 - imp}, nice gap ${all3 - none}`);
  });
  await check('freshness (<48h) adds 5 and a hiring signal adds 3', () => {
    const rs = [req({ importance: 'critical' }), req({})];
    const base = scoreMatch(input(rs, { postedAt: ago(3) })).screenPassScore;
    assert.equal(scoreMatch(input(rs, { postedAt: ago(1.9) })).screenPassScore, Math.min(100, base + 5));
    assert.equal(scoreMatch(input(rs, { postedAt: ago(2.05) })).screenPassScore, base);
    assert.equal(scoreMatch(input(rs, { postedAt: ago(3), hiringSignal: true })).screenPassScore, Math.min(100, base + 3));
  });
  await check('logistics dealbreaker caps at 40; scam at 10; ghost at 30', () => {
    const rs = [req({ importance: 'critical' }), req({})];
    assert.ok(scoreMatch(input(rs, { dimensions: { ...dims, logistics: 0 } })).screenPassScore <= 40);
    assert.ok(scoreMatch(input(rs, { legitimacy: 'scam' })).screenPassScore <= 10);
    assert.ok(scoreMatch(input(rs, { legitimacy: 'ghost' })).screenPassScore <= 30);
  });
  await check('deterministic: same inputs give the same score and breakdown; requirement order does not matter', () => {
    const rs = [req({ importance: 'critical' }), req({ match: 'partial', proofKind: 'transferable' }), req({ importance: 'nice', match: 'missing', proof: '', proofKind: 'none' }), req({ match: 'missing', proof: '', proofKind: 'none' })];
    const first = JSON.stringify(scoreMatch(input(rs)));
    for (let i = 0; i < 25; i++) assert.equal(JSON.stringify(scoreMatch(input(rs))), first);
    assert.equal(scoreMatch(input([...rs].reverse())).screenPassScore, scoreMatch(input(rs)).screenPassScore);
  });
  await check('grades: S 88+, A 78+, B 65+, C 50+, D 35+, F below', () => {
    assert.deepEqual([95, 88, 87, 78, 65, 50, 35, 34].map(gradeFor), ['S', 'S', 'A', 'A', 'B', 'C', 'D', 'F']);
  });

  // ── Normalisation ─────────────────────────────────────────────────────────
  section('A02 matcher: the rubric rules, enforced in code');
  const asm = (requirements: (typeof FIXTURE_ASSESSMENTS)['inflated']['requirements'], over: Partial<(typeof FIXTURE_ASSESSMENTS)['inflated']> = {}) => ({ ...FIXTURE_ASSESSMENTS.inflated, requirements, ...over });
  const raw = (over: Partial<(typeof FIXTURE_ASSESSMENTS)['inflated']['requirements'][number]>) => ({
    text: 'Skill',
    importance: 'important' as const,
    evidence: 'stated' as const,
    blocker: false,
    blockerKind: 'none' as const,
    yearsAsked: 0,
    match: 'missing' as const,
    proofKind: 'none' as const,
    proof: '',
    ...over,
  });
  const ctx = { learning: ['AWS', 'Docker'], yearsExperience: 1.5 };
  await check('skills on the learning list count as partial, proof "currently learning"', () => {
    const [r] = normaliseRequirements(asm([raw({ text: 'Docker and Docker Compose' })]), ctx);
    assert.equal(r.match, 'partial');
    assert.equal(r.proof, 'currently learning');
    assert.equal(r.proofKind, 'learning');
  });
  await check('"learning" credit for a skill not on the learning list is withdrawn', () => {
    const [r] = normaliseRequirements(asm([raw({ text: 'Rust', match: 'partial', proofKind: 'learning', proof: 'currently learning' })]), ctx);
    assert.equal(r.match, 'missing');
  });
  await check('transferable evidence is partial, never met; no proof means no credit', () => {
    const [t, n] = normaliseRequirements(asm([raw({ text: 'Vue', match: 'met', proofKind: 'transferable', proof: 'React at Kestrel' }), raw({ text: 'Go', match: 'met', proofKind: 'direct', proof: '' })]), ctx);
    assert.equal(t.match, 'partial');
    assert.equal(n.match, 'missing');
  });
  await check('inferred requirements are never critical; skills are never blockers', () => {
    const [i, s] = normaliseRequirements(
      asm([raw({ importance: 'critical', evidence: 'inferred' }), raw({ text: 'Kubernetes', importance: 'important', blocker: true, blockerKind: 'other' })]),
      ctx,
    );
    assert.equal(i.importance, 'important');
    assert.equal(s.blocker, false);
  });
  await check('years block only when far out of reach (>2× and 3+ more) on a non-entry role', () => {
    assert.equal(yearsOutOfReach(5, 1.5, 'entry', false), false);
    assert.equal(yearsOutOfReach(5, 1.5, 'mid', true), false);
    assert.equal(yearsOutOfReach(3, 1.5, 'mid', false), false);
    assert.equal(yearsOutOfReach(5, 1.5, 'mid', false), true);
    assert.equal(yearsOutOfReach(8, 5, 'senior', false), false);
    assert.equal(yearsOutOfReach(12, 5, 'senior', false), true);
    const [inflated] = normaliseRequirements(asm([raw({ text: '5+ years', importance: 'critical', blocker: true, blockerKind: 'years', yearsAsked: 5 })], { postingLevel: 'entry', inflatedPosting: true }), ctx);
    assert.equal(inflated.blocker, false);
    const [far] = normaliseRequirements(asm([raw({ text: '8+ years', importance: 'critical', blocker: false, blockerKind: 'years', yearsAsked: 8 })], { postingLevel: 'senior', inflatedPosting: false }), ctx);
    assert.equal(far.blocker, true);
  });
  await check('a clearance gap is never softened by the learning list', () => {
    const [r] = normaliseRequirements(asm([raw({ text: 'AWS security clearance', importance: 'critical', blocker: true, blockerKind: 'clearance' })]), ctx);
    assert.equal(r.blocker, true);
    assert.equal(r.match, 'missing');
  });

  // ── Hard filters ──────────────────────────────────────────────────────────
  section('A02 matcher: hard filters');
  const profile = TEST_PROFILE;
  const fctx = (over: Partial<CampaignConfig> = {}, p = profile) => buildFilterContext(cfgOf(over), p, FIXTURE_NOW);
  const verdict = (j: Partial<MatchJob>, over: Partial<CampaignConfig> = {}, p = profile) => hardFilter(baseJob({ id: `flt-${Math.random()}`, ...j }), fctx(over, p));
  await check('remote-only campaigns drop on-site roles', () => {
    assert.equal(verdict({ remote: false, location: 'Lahore, Pakistan' }, { remoteOnly: true }).code, 'remote_only');
    assert.equal(verdict({ remote: true, location: 'Remote' }, { remoteOnly: true }).pass, true);
  });
  await check('remote roles restricted to another country are dropped; worldwide ones pass', () => {
    assert.equal(verdict({ location: 'Remote (US)' }).code, 'remote_region');
    assert.equal(verdict({ location: 'Remote - United Kingdom' }).code, 'remote_region');
    assert.equal(verdict({ location: 'Remote', descriptionText: 'You must be located in the United States.' }).code, 'remote_region');
    assert.equal(verdict({ location: 'Remote (worldwide)' }).pass, true);
    assert.equal(verdict({ location: 'Remote, Pakistan' }).pass, true);
    assert.equal(verdict({ location: 'Remote', descriptionText: 'Join us! Contact us only through the form.' }).pass, true);
    assert.deepEqual(remoteRestriction({ location: 'Remote', descriptionText: 'Applicants must be based in Canada.' }), ['Canada']);
  });
  await check('on-site roles outside the campaign locations are dropped', () => {
    assert.equal(verdict({ remote: false, location: 'Berlin, Germany' }).code, 'location');
    assert.equal(verdict({ remote: false, location: 'Lahore, Punjab, Pakistan' }).pass, true);
  });
  await check('visa: a posting that will not sponsor is dropped only when the candidate needs sponsorship', () => {
    const needs = { ...profile, preferences: { ...profile.preferences, needsSponsorship: true } };
    const desc = 'We are unable to sponsor visas for this role.';
    assert.equal(verdict({ descriptionText: desc }, {}, needs).code, 'visa');
    assert.equal(verdict({ descriptionText: 'Must be authorized to work without sponsorship.' }, {}, needs).code, 'visa');
    assert.equal(verdict({ descriptionText: desc }).pass, true);
  });
  await check('salary floor applies only to stated pay in the same currency (annualised)', () => {
    assert.equal(annualise(25), 52_000);
    assert.equal(annualise(1200), 14_400);
    assert.equal(annualise(16_000), 16_000);
    assert.equal(verdict({ salaryMin: 1000, salaryMax: 1200, salaryCurrency: 'USD' }).code, 'salary');
    assert.equal(verdict({ salaryMin: 14_000, salaryMax: 16_000, salaryCurrency: 'usd' }).code, 'salary');
    assert.equal(verdict({ salaryMin: 30_000, salaryMax: 40_000, salaryCurrency: 'USD' }).pass, true);
    assert.equal(verdict({ salaryMin: 100_000, salaryMax: 150_000, salaryCurrency: 'PKR' }).pass, true);
    assert.equal(verdict({}).pass, true);
  });
  await check('excluded companies and keywords; ghost and scam listings; stale posts; other categories', () => {
    assert.equal(verdict({ company: 'Shadyco Inc' }).code, 'excluded_company');
    assert.equal(verdict({ descriptionText: 'Build our online gambling platform.' }).code, 'excluded_keyword');
    assert.equal(verdict({ legitimacy: 'ghost' }).code, 'legitimacy');
    assert.equal(verdict({ legitimacy: 'scam' }).code, 'legitimacy');
    assert.equal(verdict({ legitimacy: 'suspect' }).pass, true);
    assert.equal(verdict({ postedAt: ago(20) }).code, 'stale');
    assert.equal(verdict({ category: 'game' }).code, 'category');
    assert.equal(verdict({ status: 'dismissed' }).code, 'dismissed');
  });
  await check('company names normalise ("ACME, Inc." is "Acme")', () => {
    assert.equal(companyNameKey('ACME, Inc.'), companyNameKey('Acme'));
    assert.equal(companyNameKey('Orchid Analytics GmbH'), 'orchid analytics');
    assert.notEqual(companyNameKey('Orchid Analytics'), companyNameKey('Orchid Labs'));
  });
  await check('company cooldown holds across campaigns (by company id, by normalised name, and by submitted pipeline rows)', () => {
    const sent = insertJob(baseJob({ id: 'cd-sent', company: 'Orchid Analytics, Inc.', companyId: 'co-orchid' }));
    run(
      `INSERT INTO applications (id, job_id, status, channel, campaign_id, sent_at, created_at, updated_at) VALUES ('app-cd-1', ?, 'sent', 'email', 'camp-a', ?, ?, ?)`,
      sent.id,
      ago(5),
      ago(5),
      ago(5),
    );
    const byName = baseJob({ id: 'cd-name', company: 'ORCHID ANALYTICS' });
    const byId = baseJob({ id: 'cd-id', company: 'Orchid Data Platform', companyId: 'co-orchid' });
    const other = baseJob({ id: 'cd-other', company: 'Orchid Labs' });
    const c = fctx({ companyCooldownDays: 30 });
    assert.equal(hardFilter(byName, c).code, 'cooldown');
    assert.equal(hardFilter(byId, c).code, 'cooldown');
    assert.equal(hardFilter(other, c).pass, true);
    assert.equal(hardFilter(byName, fctx({ companyCooldownDays: 3 })).pass, true, '5 days ago is outside a 3-day cooldown');
    assert.equal(hardFilter(byName, fctx({ companyCooldownDays: 0 })).pass, true);
    // An external agent marked a job submitted in another campaign, with no application row.
    const viaPipe = insertJob(baseJob({ id: 'cd-pipe', company: 'Juniper Robotics' }));
    for (const s of ['found', 'filtered', 'scored', 'selected', 'submitted'] as const) transition(viaPipe.id, s, { campaignId: 'camp-b' });
    assert.equal(hardFilter(baseJob({ id: 'cd-pipe-2', company: 'Juniper Robotics Ltd' }), buildFilterContext(cfgOf(), profile, now())).code, 'cooldown');
    assert.equal(hardFilter(sent, c).code, 'already_applied');
  });

  // ── Similarity ────────────────────────────────────────────────────────────
  section('A02 matcher: similarity pre-rank');
  const simNear = insertJob(baseJob({ id: 'sim-near', title: 'Full-Stack Developer (React, TypeScript, Node.js)', descriptionText: 'Build React and TypeScript front ends and Node.js APIs on PostgreSQL. Next.js a plus.' }));
  const simFar = insertJob(baseJob({ id: 'sim-far', title: 'Warehouse forklift operator', descriptionText: 'Night shift forklift driving, pallet loading and inventory counts in our depot.' }));
  const simOther = insertJob(baseJob({ id: 'sim-other-model', title: 'Frontend Engineer (React, TypeScript)', descriptionText: 'React, TypeScript, Next.js and testing.' }));
  run("INSERT OR REPLACE INTO job_embeddings (job_id, model, vector) VALUES (?, 'some-other-model', ?)", simOther.id, toBlob(new Float32Array(16).fill(0.25)));
  await check('a relevant posting ranks above an unrelated one', async () => {
    const s = await jobSimilarity([simNear, simFar], profileEmbeddingText(profile, ['Full-Stack Developer']));
    assert.ok(s.score.get('sim-near')! > s.score.get('sim-far')!, `${s.score.get('sim-near')} vs ${s.score.get('sim-far')}`);
  });
  await check('missing job embeddings are computed on demand and stored with their model', async () => {
    const row = get<{ model: string }>('SELECT model FROM job_embeddings WHERE job_id = ?', 'sim-near');
    assert.equal(row?.model, (await embed(['x'])).model);
  });
  await check('vectors from another model are never compared (recomputed in memory, row left alone)', async () => {
    const s = await jobSimilarity([simOther], profileEmbeddingText(profile));
    assert.equal(s.model, HASH_MODEL);
    assert.ok(s.score.has(simOther.id));
    assert.equal(get<{ model: string }>('SELECT model FROM job_embeddings WHERE job_id = ?', simOther.id)?.model, 'some-other-model');
  });

  // ── Recorded assessments ──────────────────────────────────────────────────
  section('A02 matcher: recorded assessments (inflated entry-level, clearance blocker, strong match)');
  const fx = Object.values(FIXTURE_JOBS).map((j) => insertJob({ ...j }));
  const calls: { system: string; content: string; blocks: { cache_control?: unknown; text: string }[] }[] = [];
  const spy: typeof structured = (opts) => {
    calls.push({ system: JSON.stringify(opts.system), content: String(opts.content), blocks: opts.system as { cache_control?: unknown; text: string }[] });
    return structured(opts);
  };
  const usageBefore = get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_usage WHERE task = 'match'")?.n ?? 0;
  type Result = Awaited<ReturnType<typeof matchJobs>>[number];
  let results: Result[] = [];
  await check('matchJobs assesses the three postings in replay mode', async () => {
    try {
      results = await matchJobs(
        fx.map((j) => j.id),
        cfgOf(),
        { profile, now: FIXTURE_NOW, batchSize: 1, campaignId: 'camp-fixture', structuredFn: spy },
      );
    } catch (err) {
      throw new Error(`${(err as Error).message} (${RECORD_HINT})`);
    }
    assert.equal(results.length, 3);
    assert.equal(calls.length, 3);
  });
  const byId = (id: string) => results.find((r) => r.jobId === id)!;
  await check('inflated entry-level post: recognised as inflated, no blocker, worth applying', () => {
    const r = byId(FIXTURE_JOBS.inflated.id);
    assert.equal(r.inflatedPosting, true);
    assert.equal(r.stretch.blockers.length, 0);
    assert.equal(r.stretch.unmetImportant, 2);
    assert.ok(r.screenPassScore >= 60, `score ${r.screenPassScore}`);
    assert.equal(r.decision, 'scored');
    assert.equal(pipelineState(r.jobId)?.state, 'scored');
    assert.ok(r.requirements.some((q) => q.text.startsWith('AWS') && q.match === 'partial' && q.proof === 'currently learning'));
  });
  await check('clearance blocker: capped at 35 and skipped with the reason; the years line is not a blocker', () => {
    const r = byId(FIXTURE_JOBS.clearance.id);
    assert.ok(r.screenPassScore <= 35, `score ${r.screenPassScore}`);
    assert.deepEqual(r.stretch.blockers, ['Active Secret security clearance', 'U.S. citizenship']);
    assert.equal(r.decision, 'skipped');
    assert.match(r.reason, /^blocker: /);
    assert.equal(pipelineState(r.jobId)?.state, 'skipped');
    const log = get<{ reason: string }>("SELECT reason FROM pipeline_log WHERE job_id = ? AND to_state = 'skipped' ORDER BY id DESC LIMIT 1", r.jobId);
    assert.match(log?.reason ?? '', /blocker: Active Secret/);
  });
  await check('strong match: grade A or S, hiring signal boost applied', () => {
    const r = byId(FIXTURE_JOBS.strong.id) as Result & { explain: { breakdown: { adjustments: { reason: string }[] } } };
    assert.ok(r.screenPassScore >= 78, `score ${r.screenPassScore}`);
    assert.match(r.grade, /^[AS]$/);
    assert.ok(r.explain.breakdown.adjustments.some((a) => /hiring signals/.test(a.reason)));
  });
  await check('results honour the MatchResult contract and persist to jobs.match and the v1 columns', () => {
    for (const r of results) {
      MatchResultSchema.parse(r);
      const row = get<{ match: string; ai_score: number; ai_grade: string; ai_analysis: string }>('SELECT match, ai_score, ai_grade, ai_analysis FROM jobs WHERE id = ?', r.jobId)!;
      assert.equal(MatchResultSchema.parse(JSON.parse(row.match)).screenPassScore, r.screenPassScore);
      assert.equal(row.ai_score, r.screenPassScore);
      const a = JSON.parse(row.ai_analysis);
      for (const k of ['requirements', 'dimensions', 'legitimacy', 'confidence', 'verdict', 'strengths', 'gaps', 'redFlags', 'applyChannel', 'atsKeywords', 'seniorityFit', 'breakdown', 'decision']) assert.ok(k in a, k);
      assert.ok(['apply', 'consider', 'research', 'skip'].includes(a.decision));
      assert.ok(['S', 'A', 'B', 'C', 'D'].includes(row.ai_grade));
    }
  });
  await check('stretch level is per campaign: the same assessment scores lower under conservative', () => {
    const j = FIXTURE_JOBS.inflated;
    const common = { similarity: 50, preRank: 60, profile, now: FIXTURE_NOW, campaignId: null, task: 'match', embedModel: null, signals: new Set<string>(), pipelineOn: true };
    const at = (stretchLevel: 'conservative' | 'balanced' | 'aggressive') => finalise(j, FIXTURE_ASSESSMENTS.inflated, { ...common, cfg: { stretchLevel, minScore: 60 } });
    assert.ok(at('conservative').screenPassScore < at('balanced').screenPassScore);
    assert.equal(at('balanced').screenPassScore, at('aggressive').screenPassScore);
    assert.equal(JSON.stringify(at('balanced')), JSON.stringify(at('balanced')), 'deterministic');
  });

  section('A02 matcher: prompt cache and cost');
  await check('rubric and profile are two cached system blocks, byte-identical across batches', () => {
    assert.equal(calls.length, 3);
    for (const c of calls) {
      assert.equal(c.system, calls[0].system);
      assert.equal(c.blocks.length, 2);
      for (const b of c.blocks) assert.deepEqual(b.cache_control, { type: 'ephemeral' });
    }
    assert.equal(calls[0].blocks[0].text, MATCH_RUBRIC);
    assert.equal(new Set(calls.map((c) => c.content)).size, 3, 'only the postings vary');
    assert.ok(!/\d{4}-\d\d-\d\dT\d\d:/.test(calls[0].system), 'no timestamps in the cached prefix');
  });
  await check('the cached prefix is long enough to cache on Haiku 5.5 (512-token minimum)', () => {
    const chars = calls[0].blocks.reduce((n, b) => n + b.text.length, 0);
    assert.ok(chars / 4 > 1024, `about ${Math.round(chars / 4)} tokens`);
  });
  await check('cost per assessed job stays within the existing estimate (cache hits counted)', () => {
    assert.equal(modelFor('match'), 'claude-haiku-5-5');
    const price = MODEL_CHOICES.find((m) => m.id === modelFor('match'))!;
    const prefixTokens = calls[0].blocks.reduce((n, b) => n + b.text.length, 0) / 4;
    const jobTokens = fx.map((j) => renderBatchContent([j]).length / 4);
    const outTokens = Object.values(FIXTURE_ASSESSMENTS).map((a) => JSON.stringify(a).length / 3.2 + 250); // + low-effort thinking
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // A full batch of 6: prefix read from cache once per call, shared by 6 jobs.
    const perJob = (avg(jobTokens) * price.input + (prefixTokens / 6) * price.cacheRead + avg(outTokens) * price.output) / 1_000_000;
    assert.equal(estimateBefore.measured, false, 'expected the assumed estimate');
    const estimate = estimateBefore.usd / 6;
    assert.ok(perJob <= estimate, `projected $${perJob.toFixed(6)} per job vs estimate $${estimate.toFixed(6)}`);
    // The metered calls show the cache working: everything after the first call reads the prefix.
    const rows = all<{ cache_read: number; cache_write: number }>("SELECT cache_read, cache_write FROM ai_usage WHERE task = 'match' ORDER BY id").slice(usageBefore);
    assert.equal(rows.length, 3);
    assert.ok(rows[0].cache_write > 0 && rows.slice(1).every((r) => r.cache_read > 0));
  });
  await check('recordings hash against the current rubric and rendering', () => {
    const system = buildSystemBlocks(profile);
    for (const j of Object.values(FIXTURE_JOBS)) {
      const hash = replayHash('match', system, renderBatchContent([j]));
      assert.ok(fs.existsSync(path.join(process.cwd(), 'fixtures', 'claude', 'match', `${hash}.json`)), `${j.id}: ${RECORD_HINT}`);
    }
  });

  section('A02 matcher: pipeline behaviour');
  await check('jobs below the pre-rank floor are skipped without a Claude call', async () => {
    const weak = insertJob(baseJob({ id: 'pr-weak', title: 'Night shift forklift operator', descriptionText: 'Pallets, depot inventory and forklift certification.', prefilterScore: 0 }));
    const before = calls.length;
    const out = await matchJobs([weak.id], cfgOf(), { profile, now: FIXTURE_NOW, structuredFn: spy });
    assert.equal(calls.length, before);
    assert.equal(out[0].decision, 'skipped');
    assert.match(out[0].reason, /weak match/);
    assert.equal(pipelineState(weak.id)?.state, 'skipped');
  });
  await check('over the per-cycle limit, jobs wait at filtered for the next cycle', async () => {
    const wait = insertJob(baseJob({ id: 'pr-wait', title: 'Full-Stack Developer (React, Node.js)', descriptionText: 'React, TypeScript, Node.js and PostgreSQL.', prefilterScore: 85 }));
    const out = await matchJobs([wait.id], cfgOf(), { profile, now: FIXTURE_NOW, assessLimit: 0, structuredFn: spy });
    assert.equal(out.length, 0);
    assert.equal(pipelineState(wait.id)?.state, 'filtered');
    assert.ok(pendingForMatch(null).includes(wait.id));
  });
  await check('filter rejections are returned and recorded with their reason', async () => {
    const onsite = insertJob(baseJob({ id: 'pr-onsite', location: 'Austin, TX', remote: false }));
    const [r] = await matchJobs([onsite.id], cfgOf(), { profile, now: FIXTURE_NOW, structuredFn: spy });
    assert.equal(r.decision, 'skipped');
    assert.match(r.reason, /^filter: on-site in Austin/);
    assert.equal(readMatch(onsite.id)?.explain.filter?.code, 'location');
  });
  await check('when the budget runs out, the error surfaces and the jobs wait at filtered', async () => {
    const j = insertJob(baseJob({ id: 'pr-budget', title: 'Frontend Engineer (React)', descriptionText: 'React and TypeScript.', prefilterScore: 80 }));
    const broke: typeof structured = async () => {
      throw new AppError(402, 'BUDGET', 'Monthly AI budget reached.');
    };
    await assert.rejects(matchJobs([j.id], cfgOf(), { profile, now: FIXTURE_NOW, structuredFn: broke }), (e: unknown) => (e as { code?: string }).code === 'BUDGET');
    assert.equal(pipelineState(j.id)?.state, 'filtered');
  });
  await check('jobs already past scoring (selected, writing, …) are left alone', async () => {
    const busy = insertJob(baseJob({ id: 'pr-busy' }));
    for (const s of ['found', 'filtered', 'scored', 'selected', 'writing'] as const) transition(busy.id, s);
    const out = await matchJobs([busy.id], cfgOf(), { profile, now: FIXTURE_NOW, structuredFn: spy });
    assert.equal(out.length, 0);
    assert.equal(pipelineState(busy.id)?.state, 'writing');
  });

  // ── Selection ─────────────────────────────────────────────────────────────
  section('A02 matcher: selection for a campaign');
  const scored = (id: string, company: string, category: MatchJob['category'], score: number, campaignId: string, extra: { blocker?: string; companyId?: string } = {}) => {
    const j = insertJob(baseJob({ id, company, category, companyId: extra.companyId ?? null, title: `${category} role ${id}` }));
    const m = rejectedMatch(j, { code: 'category', reason: 'x' }, { asOf: FIXTURE_NOW, campaignId, stretchLevel: 'balanced', minScore: 60 }, null);
    m.screenPassScore = score;
    m.grade = gradeFor(score);
    m.decision = 'scored';
    m.reason = '';
    m.explain.filter = null;
    if (extra.blocker) m.stretch.blockers = [extra.blocker];
    run('UPDATE jobs SET match = ? WHERE id = ?', JSON.stringify(m), j.id);
    for (const s of ['found', 'filtered', 'scored'] as const) transition(j.id, s, { campaignId });
    return j.id;
  };
  const C = 'camp-sel-1';
  scored('sel-a1', 'Alder Systems', 'web', 90, C);
  scored('sel-a2', 'Alder Systems Inc', 'web', 88, C);
  scored('sel-b', 'Birch Labs', 'web', 85, C);
  scored('sel-g', 'Ginkgo AI', 'data_ai', 80, C);
  scored('sel-d', 'Dogwood', 'web', 82, C);
  scored('sel-low', 'Elm Co', 'web', 55, C);
  scored('sel-blk', 'Fir Defense', 'web', 75, C, { blocker: 'Secret clearance' });
  await check('selection is deterministic for the same state', () => {
    assert.deepEqual(planSelection(cfgOf(), C, 3, FIXTURE_NOW), planSelection(cfgOf(), C, 3, FIXTURE_NOW));
  });
  let chosen: string[] = [];
  await check('picks the best, spreads across categories, one per company in flight, respects slots', () => {
    chosen = selectForCampaign(cfgOf(), C, 3);
    assert.deepEqual(chosen, ['sel-a1', 'sel-b', 'sel-g']);
    for (const id of chosen) assert.equal(pipelineState(id)?.state, 'selected');
    assert.equal(readMatch('sel-a1')?.decision, 'selected');
  });
  await check('below-minimum and blocked jobs are skipped with a reason; the rest wait', () => {
    assert.equal(pipelineState('sel-low')?.state, 'skipped');
    assert.equal(pipelineState('sel-blk')?.state, 'skipped');
    assert.equal(pipelineState('sel-a2')?.state, 'scored');
    assert.equal(pipelineState('sel-d')?.state, 'scored');
    assert.match(readMatch('sel-blk')?.reason ?? '', /blocker/);
  });
  await check('the next pass takes the next best, still holding the busy company', () => {
    assert.deepEqual(selectForCampaign(cfgOf(), C, 3), ['sel-d']);
    assert.equal(pipelineState('sel-a2')?.state, 'scored');
  });
  await check('with no cooldown, at most 2 per company per week', () => {
    const K = 'camp-sel-2';
    scored('sel-k1', 'Kauri Cloud', 'web', 91, K);
    scored('sel-k2', 'Kauri Cloud', 'web', 90, K);
    scored('sel-k3', 'Kauri Cloud', 'web', 89, K);
    const plan = planSelection(cfgOf({ companyCooldownDays: 0 }), K, 5, FIXTURE_NOW);
    assert.deepEqual(plan.chosen.map((c) => c.jobId), ['sel-k1', 'sel-k2']);
    assert.match(plan.held.find((h) => h.jobId === 'sel-k3')?.reason ?? '', /2 applications to Kauri Cloud this week/);
  });
  await check('a company applied to within the cooldown (any campaign) is skipped at selection', () => {
    const L = 'camp-sel-3';
    const id = scored('sel-l1', 'Larch Health', 'web', 92, L, { companyId: 'co-larch' });
    const old = insertJob(baseJob({ id: 'sel-l-old', company: 'Larch Health GmbH', companyId: 'co-larch' }));
    run("INSERT INTO applications (id, job_id, status, channel, campaign_id, sent_at, created_at, updated_at) VALUES ('app-larch', ?, 'submitted', 'form', 'camp-other', ?, ?, ?)", old.id, now(), now(), now());
    assert.deepEqual(selectForCampaign(cfgOf(), L, 3), []);
    assert.equal(pipelineState(id)?.state, 'skipped');
    assert.match(readMatch(id)?.reason ?? '', /cooldown/);
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  section('A02 matcher: routes');
  const Fastify = (await import('fastify')).default;
  const app = Fastify();
  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message });
    return reply.status(500).send({ error: 'X', message: err.message });
  });
  await app.register(matchRoutes);
  await check('GET /api/match/meaning explains the score as the chance of passing the screen', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/match/meaning' });
    assert.equal(res.statusCode, 200);
    const b = res.json() as { label: string; tooltip: string; stretch: { allowance: Record<string, number> } };
    assert.equal(b.label, 'Chance of passing the screen');
    assert.match(b.tooltip, /chance of passing the screen/i);
    assert.equal(b.tooltip, SCORE_TOOLTIP);
    assert.equal(b.stretch.allowance.balanced, 3);
  });
  await check('GET /api/match/jobs/:id returns the breakdown and the explanation', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/match/jobs/${FIXTURE_JOBS.inflated.id}` });
    assert.equal(res.statusCode, 200);
    const b = res.json() as { match: { screenPassScore: number }; breakdown: { stretch: { allowance: number } }; explanation: { text: string; tooltip: string }; pipeline: { state: string } };
    assert.equal(b.match.screenPassScore, byId(FIXTURE_JOBS.inflated.id).screenPassScore);
    assert.equal(b.breakdown.stretch.allowance, 3);
    assert.match(b.explanation.text, /^Chance of passing the screen: \d+\/100/);
    assert.match(b.explanation.text, /Inflated posting/);
    assert.equal(b.pipeline.state, 'scored');
  });
  await check('GET /api/match/jobs/:id/explain names a true blocker; unknown jobs 404', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/match/jobs/${FIXTURE_JOBS.clearance.id}/explain` });
    assert.match((res.json() as { text: string }).text, /True blocker: Active Secret security clearance/);
    assert.equal((await app.inject({ method: 'GET', url: '/api/match/jobs/nope' })).statusCode, 404);
  });
  await check('GET /api/match/queue previews selection without moving anything', async () => {
    run(
      "INSERT OR REPLACE INTO campaigns (id, name, status, starts_at, ends_at, config, created_at, updated_at) VALUES ('camp-sel-1', 'Sel', 'active', ?, ?, ?, ?, ?)",
      ago(1),
      ago(-30),
      JSON.stringify(cfgOf()),
      now(),
      now(),
    );
    const res = await app.inject({ method: 'GET', url: '/api/match/queue?campaignId=camp-sel-1&slots=5' });
    assert.equal(res.statusCode, 200);
    assert.equal(pipelineState('sel-a2')?.state, 'scored');
  });
  await check('GET/PUT /api/match/settings keep unspecified fields', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/match/settings', payload: { minPreRank: 25 } });
    assert.equal(put.statusCode, 200);
    assert.deepEqual(put.json(), { assessPerCycle: 40, minPreRank: 25, batchSize: 6, concurrency: 3, legitimacyFloor: 'suspect' });
    await app.inject({ method: 'PUT', url: '/api/match/settings', payload: { minPreRank: 20 } });
    assert.equal((await app.inject({ method: 'PUT', url: '/api/match/settings', payload: { batchSize: 99 } })).statusCode, 400);
  });
  await check('GET /api/match/stats reports cache hit rate and cost per assessed job', async () => {
    const b = (await app.inject({ method: 'GET', url: '/api/match/stats' })).json() as { match: { cacheHitRate: number; costPerAssessedJob: number } };
    assert.ok(b.match.cacheHitRate > 0.5, `hit rate ${b.match.cacheHitRate}`);
    assert.ok(b.match.costPerAssessedJob > 0);
  });
  await app.close();

  // ── v1 compatibility ──────────────────────────────────────────────────────
  section('A02 matcher: v1 callers');
  await check('SCORING_RUBRIC is the new rubric; computeScore still works on a v1 assessment', () => {
    assert.equal(SCORING_RUBRIC, MATCH_RUBRIC);
    assert.equal(typeof computeScore, 'function');
  });
  await check('scoreJobs (v1 scanner) runs the matcher under the score task, fills ai_* and leaves the pipeline alone', async () => {
    const id = FIXTURE_JOBS.strong.id;
    const logBefore = get<{ n: number }>('SELECT COUNT(*) AS n FROM pipeline_log WHERE job_id = ?', id)!.n;
    run('UPDATE jobs SET ai_score = NULL WHERE id = ?', id);
    let n = 0;
    try {
      n = await scoreJobs([id], TEST_V1_PROFILE);
    } catch (err) {
      throw new Error(`${(err as Error).message} (${RECORD_HINT})`);
    }
    assert.equal(n, 1);
    assert.ok((get<{ ai_score: number }>('SELECT ai_score FROM jobs WHERE id = ?', id)?.ai_score ?? 0) >= 70);
    assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM pipeline_log WHERE job_id = ?', id)!.n, logBefore);
    assert.equal(toMatchProfile(TEST_V1_PROFILE).learning.length, 0);
  });
}
