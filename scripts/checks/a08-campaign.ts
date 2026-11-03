import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Harness } from '../lib/harness.ts';

/**
 * A08 campaign autopilot: campaigns, the state machine under the worker,
 * crash/resume without double submits, pacing on a fake clock, dry-run → live,
 * auto-end, kill switch, digest, Telegram (mocked HTTP), keep-awake, routes and
 * the /api/hunt shim. No network, no real browser, no real messages.
 */
export default async function a08Campaign({ check, section }: Harness) {
  const { db, run, get, all, now: dbNow } = await import('../../server/db.ts');
  const { DATA_DIR } = await import('../../server/config.ts');
  const { bus } = await import('../../server/services/bus.ts');
  const { AppError } = await import('../../server/errors.ts');
  const { NotImplemented } = await import('../../server/contracts/stub.ts');
  const { transition, pipelineState, canTransition, IllegalTransition } = await import('../../server/campaign/pipeline.ts');
  const { claimJob, releaseClaim } = await import('../../server/campaign/claims.ts');
  const C = await import('../../server/campaign/campaigns.ts');
  const T = await import('../../server/campaign/time.ts');
  const { FakeClock, flush } = await import('../../server/campaign/clock.ts');
  const { Engine } = await import('../../server/campaign/engine.ts');
  const { createKeepAwake, encodedCommand } = await import('../../server/campaign/awake.ts');
  const { setKillState, killState, STOP_FILE } = await import('../../server/campaign/kill.ts');
  const { saveAutopilotSettings } = await import('../../server/campaign/settings.ts');
  const { buildDigest, renderDigestText, renderDigestTelegram, skipFamily } = await import('../../server/campaign/digest.ts');
  const { stepsForJob, loadPacket } = await import('../../server/campaign/journal.ts');
  const campaignIndex = await import('../../server/campaign/index.ts');
  const { setEngine, telegramHandlers } = campaignIndex;
  const { campaignRoutes } = await import('../../server/campaign/routes.ts');
  const N = await import('../../server/notify/index.ts');
  const { parseCommand, splitAnswer, handleUpdate, startTelegramPoller } = await import('../../server/notify/commands.ts');
  const { setTelegramHttp, sendTelegram, chunk } = await import('../../server/notify/telegram.ts');
  const { setTelegramCredentials, clearTelegram, saveNotifySettings, DEFAULT_NOTIFY, setNtfyTopic } = await import('../../server/notify/settings.ts');
  const { pushQuestions } = await import('../../server/notify/questions.ts');
  type EngineDeps = import('../../server/campaign/deps.ts').EngineDeps;
  type FillOutcome = import('../../server/contracts/forms.ts').FillOutcome;
  type FillOptions = import('../../server/contracts/forms.ts').FillOptions;
  type ApplicationPacket = import('../../server/contracts/writer.ts').ApplicationPacket;
  type CampaignConfig = import('../../server/contracts/campaign.ts').CampaignConfig;
  type TgUpdate = import('../../server/notify/telegram.ts').TgUpdate;

  const MIN = 60_000;
  const HOUR = 60 * MIN;
  // Monday 2 Nov 2026, 08:00 in Karachi (UTC+5).
  const MON_0800 = Date.parse('2026-11-02T03:00:00Z');
  const TZ = 'Asia/Karachi';

  saveAutopilotSettings({ globalDailyCap: 400, preferEmployerHours: true });
  saveNotifySettings(DEFAULT_NOTIFY);

  // ── Fixtures ──────────────────────────────────────────────────────────────

  let seq = 0;
  const uid = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 7)}`;

  function mkJob(over: { company?: string; title?: string; location?: string; email?: string | null; url?: string; canonical?: string | null; score?: number } = {}) {
    const id = uid('a08job');
    const ts = dbNow();
    run(
      `INSERT INTO jobs (id, fingerprint, source, url, title, company, location, category, found_at, updated_at, apply_email, apply_url_canonical, match, ai_score)
       VALUES (?, ?, 'test', ?, ?, ?, ?, 'web', ?, ?, ?, ?, ?, ?)`,
      id,
      id,
      over.url ?? `https://boards.example.com/${id}`,
      over.title ?? 'Full-Stack Developer',
      over.company ?? `Company ${id}`,
      over.location ?? 'Remote',
      ts,
      ts,
      over.email ?? null,
      over.canonical ?? null,
      JSON.stringify({ screenPassScore: over.score ?? 80 }),
      over.score ?? 80,
    );
    return id;
  }

  function toSelected(jobId: string, campaignId: string) {
    transition(jobId, 'found', { campaignId });
    transition(jobId, 'filtered');
    transition(jobId, 'scored');
    transition(jobId, 'selected', { reason: 'test queue' });
  }

  const cfg = (over: Partial<CampaignConfig> = {}): Record<string, unknown> => ({
    startsAt: new Date(MON_0800 - HOUR).toISOString(),
    endsAt: new Date(MON_0800 + 30 * 24 * HOUR).toISOString(),
    roles: ['Full-Stack Developer'],
    categories: ['web'],
    locations: ['Remote'],
    remoteOnly: false,
    stretchLevel: 'balanced',
    minScore: 60,
    dailyCap: 10,
    companyCooldownDays: 30,
    activeHours: { tz: TZ, start: '09:00', end: '18:00' },
    pacingMinutes: { min: 1, max: 2 },
    budgetUsd: 0,
    dryRunDays: 0,
    channels: { email: true, forms: true, agent: true },
    sources: {},
    ...over,
  });

  /** Only this scenario's campaigns may be active; no kill flag; no STOP file. */
  function isolate() {
    run("UPDATE campaigns SET status = 'ended' WHERE status IN ('active', 'paused', 'draft')");
    setKillState(null);
    fs.rmSync(STOP_FILE(), { force: true });
  }

  function packetFor(jobId: string, appId: string): ApplicationPacket {
    const file = path.join(DATA_DIR, `${appId}.pdf`);
    fs.writeFileSync(file, '%PDF-1.4 test');
    return {
      applicationId: appId,
      jobId,
      cvPdfPath: file,
      letterPdfPath: file,
      subject: 'Application: Full-Stack Developer',
      coverLetter: 'Dear team, I build things.',
      shortAnswers: {},
      outreach: '',
      followUp: '',
      quality: {
        critic: { score: 8, scores: { specificity: 8, evidence: 8, voice: 8, clarity: 8, ask: 8, aiTells: 8 }, demands: [] },
        lint: { pass: true, checks: [] },
        truth: { pass: true, issues: [] },
      },
    };
  }

  function outcome(status: FillOutcome['status'], verified: boolean, reason = ''): FillOutcome {
    return {
      status,
      reason: reason || status,
      shotPath: null,
      shots: [],
      answers: [],
      verified,
      unknownQuestions: [],
      fieldLog: [],
      ats: null,
      via: 'generic',
      recipeId: null,
      url: null,
    };
  }

  interface Ledger {
    /** Real submissions the "employer" received, per job. */
    submitted: Map<string, number>;
    writes: Map<string, number>;
    fills: { jobId: string; submit: boolean; at: number }[];
    emails: { jobId: string; at: number }[];
    notes: { kind: string; title: string; body: string }[];
    spawns: number;
    kills: number;
    closed: number;
  }

  const unavailable = () => Promise.reject(new NotImplemented('test', 'stage'));

  function fakeDeps(clock: InstanceType<typeof FakeClock>, over: Partial<EngineDeps> = {}, ledger?: Ledger): { deps: EngineDeps; ledger: Ledger } {
    const L: Ledger = ledger ?? { submitted: new Map(), writes: new Map(), fills: [], emails: [], notes: [], spawns: 0, kills: 0, closed: 0 };
    const keepAwake = createKeepAwake({
      platform: 'win32',
      spawner: () => {
        L.spawns++;
        return { pid: 1, kill: () => (L.kills++, true), once: () => undefined as never, stdin: null } as never;
      },
    });
    const deps: EngineDeps = {
      clock,
      scout: async () => ({ found: 0, added: [] }),
      match: async () => [],
      pendingForMatch: () => [],
      selectForCampaign: () => [],
      syncProfile: unavailable,
      pollInbox: unavailable,
      buildGapReport: unavailable,
      discoverCompanies: unavailable,
      recipeJobs: unavailable,
      write: async (jobId) => {
        const n = (L.writes.get(jobId) ?? 0) + 1;
        L.writes.set(jobId, n);
        const appId = `app-${jobId}-${n}`;
        run(
          "INSERT INTO applications (id, job_id, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)",
          appId,
          jobId,
          dbNow(),
          dbNow(),
        );
        return packetFor(jobId, appId);
      },
      fill: async (packet: ApplicationPacket, opts: FillOptions) => {
        L.fills.push({ jobId: packet.jobId, submit: opts.submit, at: clock.now() });
        if (opts.submit) {
          L.submitted.set(packet.jobId, (L.submitted.get(packet.jobId) ?? 0) + 1);
          return outcome('submitted', true, 'Thanks for applying');
        }
        return outcome('rehearsed', true, 'Filled and verified');
      },
      sendEmail: async ({ packet }) => {
        L.emails.push({ jobId: packet.jobId, at: clock.now() });
        L.submitted.set(packet.jobId, (L.submitted.get(packet.jobId) ?? 0) + 1);
        return 'msg-1';
      },
      emailReady: () => false,
      notify: async (kind, payload) => {
        L.notes.push({ kind, title: payload.title, body: payload.body });
        return { via: ['test'] };
      },
      pushQuestions: async () => 0,
      sourceHealth: () => [],
      monthBudget: () => ({ spentUsd: 0, budgetUsd: 0 }),
      spendSince: () => 0,
      keepAwake,
      closeBrowsers: async () => {
        L.closed++;
      },
      ...over,
    };
    return { deps, ledger: L };
  }

  function scenario(opts: { config?: Partial<CampaignConfig>; start?: number; over?: Partial<EngineDeps>; name?: string } = {}) {
    isolate();
    const clock = new FakeClock(opts.start ?? MON_0800 + HOUR + 5 * MIN); // 09:05 local
    const { deps, ledger } = fakeDeps(clock, opts.over);
    const engine = new Engine(deps, { tickMs: MIN });
    setEngine(engine);
    const c = C.createCampaign({ name: opts.name ?? uid('Campaign'), config: cfg(opts.config) });
    return { clock, deps, ledger, engine, c };
  }

  async function step(engine: InstanceType<typeof Engine>) {
    await engine.settle();
    await engine.tick();
    await engine.settle();
  }

  /** Tick every `every` ms of fake time until `until`. */
  async function runUntil(engine: InstanceType<typeof Engine>, clock: InstanceType<typeof FakeClock>, until: number, every = 2 * MIN) {
    while (clock.now() < until) {
      await step(engine);
      clock.set(Math.min(until, clock.now() + every));
    }
    await step(engine);
  }

  const never = () => new Promise<never>(() => undefined);

  // Make sure no engine built on real modules is ever used by these checks.
  setEngine(new Engine(fakeDeps(new FakeClock(MON_0800)).deps));

  // ── Time ──────────────────────────────────────────────────────────────────
  section('A08 campaign: time zones and windows');
  await check('active hours are read in the campaign time zone, overnight windows included', () => {
    const w = { tz: TZ, start: '09:00', end: '18:00' };
    assert.equal(T.inWindow(MON_0800, w), false); // 08:00
    assert.equal(T.inWindow(MON_0800 + HOUR, w), true); // 09:00
    assert.equal(T.inWindow(MON_0800 + 10 * HOUR, w), false); // 18:00
    assert.equal(T.nextWindowStart(MON_0800, w), MON_0800 + HOUR);
    const night = { tz: TZ, start: '22:00', end: '06:00' };
    assert.equal(T.inWindow(MON_0800 + 15 * HOUR, night), true); // 23:00
    assert.equal(T.inWindow(MON_0800 - 3 * HOUR, night), true); // 05:00
    assert.equal(T.inWindow(MON_0800 + 4 * HOUR, night), false); // 12:00
    assert.equal(T.startOfLocalDay(MON_0800, TZ), Date.parse('2026-11-01T19:00:00Z'));
    assert.equal(T.localDaysBetween(MON_0800, MON_0800 + 17 * HOUR, TZ), 2 - 1); // 01:00 next day
  });
  await check('employer business hours are preferred when the posting names a place', () => {
    assert.equal(T.employerTimeZone('London, United Kingdom'), 'Europe/London');
    assert.equal(T.employerTimeZone('San Francisco, CA'), 'America/Los_Angeles');
    assert.equal(T.employerTimeZone('Remote'), null);
    // 09:05 Karachi = 04:05 London: outside London business hours.
    assert.equal(T.inEmployerHours(MON_0800 + HOUR, 'Europe/London'), false);
    assert.equal(T.inEmployerHours(MON_0800 + 7 * HOUR, 'Europe/London'), true);
    assert.equal(T.inEmployerHours(MON_0800, null), null);
  });

  // ── Campaigns ─────────────────────────────────────────────────────────────
  section('A08 campaign: campaigns');
  await check('campaign config is validated: dates, pacing and time zone', () => {
    isolate();
    assert.throws(() => C.createCampaign({ name: 'x', config: cfg({ endsAt: new Date(MON_0800 - 2 * HOUR).toISOString() }) }), /end after it starts/);
    assert.throws(() => C.createCampaign({ name: 'x', config: cfg({ pacingMinutes: { min: 30, max: 5 } }) }), /shortest gap/);
    assert.throws(() => C.createCampaign({ name: 'x', config: cfg({ activeHours: { tz: 'Mars/Olympus', start: '09:00', end: '18:00' } }) }), /time zone/);
    assert.throws(() => C.createCampaign({ name: 'x', config: { ...cfg(), dailyCap: -1 } }), /dailyCap/);
  });
  await check('status moves draft → active → paused → active → ended and emits campaign.status', () => {
    const { c, clock } = scenario();
    const seen: string[] = [];
    const on = (e: { type: string; campaignId?: string; status?: string }) => {
      if (e.type === 'campaign.status' && e.campaignId === c.id) seen.push(e.status!);
    };
    bus.on('event', on);
    try {
      assert.equal(c.status, 'draft');
      C.setStatus(c.id, 'active', 'go', clock.now());
      C.setStatus(c.id, 'paused', 'rest', clock.now());
      C.setStatus(c.id, 'active', 'go', clock.now());
      C.setStatus(c.id, 'ended', 'done', clock.now());
      assert.throws(() => C.setStatus(c.id, 'active', 'again', clock.now()), /ended campaign cannot/);
      assert.deepEqual(seen, ['active', 'paused', 'active', 'ended']);
      assert.ok(C.campaignMeta(c.id).firstActiveAt);
    } finally {
      bus.off('event', on);
    }
  });
  await check('campaigns can be found by name or id prefix (for Telegram)', () => {
    const { c } = scenario({ name: 'Spring Push A08' });
    assert.equal(C.findCampaign('spring push a08')?.id, c.id);
    assert.equal(C.findCampaign(c.id.slice(0, 8))?.id, c.id);
    assert.equal(C.findCampaign('nope-nope'), null);
  });
  await check('dry-run days are counted in local days from the first activation', () => {
    const { c, clock } = scenario({ config: { dryRunDays: 2 } });
    C.setStatus(c.id, 'active', 'go', clock.now());
    const fresh = C.requireCampaign(c.id);
    assert.equal(C.isDryRun(fresh, clock.now()), true);
    assert.equal(C.isDryRun(fresh, clock.now() + 24 * HOUR), true);
    assert.equal(C.isDryRun(fresh, clock.now() + 48 * HOUR), false);
    // Live begins at local midnight of day 3 (Wednesday 00:00 Karachi = Tuesday 19:00 UTC).
    assert.equal(C.liveAt(fresh), '2026-11-03T19:00:00.000Z');
  });

  // ── State machine under the worker ────────────────────────────────────────
  section('A08 campaign: state machine and apply worker');
  await check('illegal transitions throw, and the submitted state is final', () => {
    const j = mkJob();
    transition(j, 'found');
    assert.throws(() => transition(j, 'writing'), IllegalTransition);
    assert.throws(() => transition(j, 'rehearsed'), /cannot move/);
    assert.equal(canTransition('rehearsed', 'filling'), false);
    assert.equal(canTransition('verified', 'rehearsed'), true);
    assert.equal(canTransition('submitted', 'selected'), false);
  });
  await check('a live job runs write → fill → verify → submit once, and the application is marked sent', async () => {
    const { engine, c, ledger, clock } = scenario();
    const j = mkJob();
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    await step(engine);
    assert.equal(pipelineState(j)?.state, 'submitted');
    assert.equal(ledger.submitted.get(j), 1);
    assert.deepEqual(ledger.fills.map((f) => f.submit), [true]);
    const steps = stepsForJob(j).map((s) => s.step);
    assert.ok(steps.indexOf('submit_intent') < steps.indexOf('outcome'), steps.join(','));
    const app = get<{ status: string; campaign_id: string; sent_at: string | null }>('SELECT status, campaign_id, sent_at FROM applications WHERE job_id = ?', j);
    assert.equal(app?.status, 'sent');
    assert.equal(app?.campaign_id, c.id);
    assert.ok(app?.sent_at);
    // A later tick never touches it again.
    clock.set(clock.now() + HOUR);
    await step(engine);
    assert.equal(ledger.submitted.get(j), 1);
  });
  await check('changing what a campaign wants re-sorts its jobs and holds back written ones that no longer fit', async () => {
    const { seedProfile } = await import('../e2e/seed.ts');
    const { invalidateMasterProfile } = await import('../../server/profile/index.ts');
    const { ruledOutNow } = await import('../../server/campaign/refilter.ts');
    const { c } = scenario({ config: { locations: ['Remote'] } });
    seedProfile(); // the test candidate lives in Lahore
    invalidateMasterProfile();
    try {
      const skippedBy = (location: string, code: string) => {
        const j = mkJob({ location });
        run('UPDATE jobs SET match = ? WHERE id = ?', JSON.stringify({ decision: 'skipped', reason: `filter: ${code}`, explain: { filter: { code, reason: code } } }), j);
        transition(j, 'found', { campaignId: c.id });
        transition(j, 'skipped', { campaignId: c.id, reason: `filter: ${code}` });
        return j;
      };
      const nearby = skippedBy('Lahore, Pakistan', 'location');
      const scam = skippedBy('Lahore, Pakistan', 'legitimacy');
      const abroad = mkJob({ location: 'Berlin, Germany' });
      toSelected(abroad, c.id);
      C.updateCampaign(c.id, { config: { locations: ['Lahore'] } });
      assert.equal(pipelineState(nearby)?.state, 'found', 'a job the old places ruled out goes back to the matcher');
      assert.equal(pipelineState(scam)?.state, 'skipped', 'a scam stays skipped');
      assert.equal(pipelineState(abroad)?.state, 'skipped', 'a picked job the new places rule out is dropped');
      const cfgNow = C.requireCampaign(c.id).config;
      assert.ok(ruledOutNow(abroad, cfgNow), 'a written application for it would be held back');
      assert.equal(ruledOutNow(nearby, cfgNow), null);
      // Changing only the name or the daily cap re-sorts nothing.
      C.updateCampaign(c.id, { config: { dailyCap: 3 } });
      assert.equal(pipelineState(nearby)?.state, 'found');
    } finally {
      run('DELETE FROM profile');
      invalidateMasterProfile();
    }
  });
  await check('a rehearsal that cannot verify goes to needs_you, never to submit', async () => {
    const { engine, c, ledger } = scenario({ config: { dryRunDays: 1 }, over: {} });
    engine.deps.fill = async (p, o) => {
      ledger.fills.push({ jobId: p.jobId, submit: o.submit, at: 0 });
      return outcome('rehearsed', false, 'Read-back mismatch on "Phone"');
    };
    const j = mkJob();
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    await step(engine);
    assert.equal(pipelineState(j)?.state, 'needs_you');
    assert.deepEqual(ledger.fills.map((f) => f.submit), [false]);
  });
  await check('a form engine that submits without verifying is recorded truthfully and pauses the campaign', async () => {
    const { engine, c, ledger } = scenario();
    engine.deps.fill = async () => outcome('submitted', false, 'clicked submit');
    const j = mkJob();
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    await step(engine);
    assert.equal(pipelineState(j)?.state, 'submitted');
    assert.equal(C.requireCampaign(c.id).status, 'paused');
    assert.ok(ledger.notes.some((n) => n.kind === 'alert' && /paused/i.test(n.title)));
  });
  await check('claims: a job another agent holds is left alone; the next one is taken', async () => {
    const { engine, c, ledger } = scenario();
    const held = mkJob({ score: 95 });
    const free = mkJob({ score: 70 });
    toSelected(held, c.id);
    toSelected(free, c.id);
    assert.ok(claimJob(held, 'external:k1', 20));
    engine.startCampaign(c.id);
    await step(engine);
    assert.equal(pipelineState(held)?.state, 'selected');
    assert.equal(pipelineState(free)?.state, 'submitted');
    assert.equal(ledger.submitted.get(held), undefined);
    releaseClaim(held, 'external:k1');
  });
  await check('uniqueness: a second role at the same company inside the cooldown is skipped at submit time', async () => {
    const { engine, c, ledger, clock } = scenario({ config: { companyCooldownDays: 30 } });
    const company = uid('Acme');
    const a = mkJob({ company, score: 90 });
    const b = mkJob({ company: `${company}, Inc.`, score: 85 });
    toSelected(a, c.id);
    toSelected(b, c.id);
    engine.startCampaign(c.id);
    await step(engine);
    clock.set(clock.now() + 5 * MIN);
    await step(engine);
    assert.equal(pipelineState(a)?.state, 'submitted');
    assert.equal(pipelineState(b)?.state, 'skipped');
    assert.match(get<{ reason: string }>("SELECT reason FROM pipeline_log WHERE job_id = ? AND to_state = 'skipped'", b)?.reason ?? '', /cooldown/);
    assert.equal(ledger.submitted.get(b), undefined);
  });
  await check('the same posting listed twice is applied to once', async () => {
    const { engine, c, ledger, clock } = scenario({ config: { companyCooldownDays: 0 } });
    const canon = `https://jobs.example.com/${uid('post')}`;
    const a = mkJob({ canonical: canon });
    const b = mkJob({ canonical: canon });
    toSelected(a, c.id);
    toSelected(b, c.id);
    engine.startCampaign(c.id);
    await step(engine);
    clock.set(clock.now() + 5 * MIN);
    await step(engine);
    assert.equal([...ledger.submitted.values()].reduce((x, y) => x + y, 0), 1);
    assert.deepEqual([pipelineState(a)?.state, pipelineState(b)?.state].sort(), ['skipped', 'submitted']);
  });
  await check('writer skips and unavailable stages are handled without failing the campaign', async () => {
    const { engine, c, ledger, clock } = scenario();
    const skipJob = mkJob();
    toSelected(skipJob, c.id);
    engine.deps.write = async () => ({ skipped: 'truth lock: no honest framing for "5 years of Rust"' });
    engine.startCampaign(c.id);
    await step(engine);
    assert.equal(pipelineState(skipJob)?.state, 'skipped');

    const waitJob = mkJob();
    toSelected(waitJob, c.id);
    engine.deps.write = () => Promise.reject(new NotImplemented('A04', 'writeApplication'));
    clock.set(clock.now() + 5 * MIN);
    await step(engine);
    assert.equal(pipelineState(waitJob)?.state, 'selected');
    assert.ok(get("SELECT 1 FROM events WHERE kind = 'campaign' AND message LIKE '%writer is not available yet%'"));
    assert.equal(C.requireCampaign(c.id).status, 'active');

    // Form engine not built: the packet is kept and the job waits at written.
    engine.deps.write = fakeDeps(clock, {}, ledger).deps.write;
    engine.deps.fill = () => Promise.reject(new NotImplemented('A05', 'fillApplication'));
    clock.set(clock.now() + 20 * MIN);
    await step(engine);
    assert.equal(pipelineState(waitJob)?.state, 'written');
    assert.ok(loadPacket(waitJob));
  });
  await check('failures back off exponentially and stop after the attempt limit', async () => {
    const { engine, c, clock } = scenario();
    saveAutopilotSettings({ maxAttempts: 2 });
    let calls = 0;
    engine.deps.fill = async () => {
      calls++;
      return outcome('failed', false, 'Upload widget timed out');
    };
    const j = mkJob();
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    await step(engine);
    const r1 = pipelineState(j)!;
    assert.equal(r1.state, 'failed');
    assert.equal(r1.attempts, 1);
    assert.equal(Date.parse(r1.nextActionAt!) - clock.now(), 30 * MIN);
    clock.set(clock.now() + 10 * MIN);
    await step(engine);
    assert.equal(calls, 1, 'not retried before the backoff');
    clock.set(clock.now() + 25 * MIN);
    await step(engine);
    assert.equal(calls, 2);
    assert.equal(pipelineState(j)?.attempts, 2);
    clock.set(clock.now() + 5 * HOUR);
    await step(engine);
    assert.equal(calls, 2, 'gave up after maxAttempts');
    saveAutopilotSettings({ maxAttempts: 3 });
  });
  await check('email route: rehearsed in dry run, sent once live, verified first', async () => {
    const { engine, c, ledger } = scenario({ config: { dryRunDays: 0 }, over: { emailReady: () => true } });
    const j = mkJob({ email: 'jobs@acme-example.com' });
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    await step(engine);
    assert.equal(pipelineState(j)?.state, 'submitted');
    assert.equal(ledger.emails.length, 1);
    assert.equal(ledger.fills.length, 0);
    const log = all<{ to_state: string }>('SELECT to_state FROM pipeline_log WHERE job_id = ? ORDER BY id', j).map((r) => r.to_state);
    assert.deepEqual(log.slice(-4), ['written', 'filling', 'verified', 'submitted']);
  });

  // ── Crash and resume ──────────────────────────────────────────────────────
  section('A08 campaign: crash at every step, restart, never a double submit');

  /** Run engine 1 until it hangs at the chosen step, abandon it (process death), then let engine 2 recover and finish. */
  async function crashAt(point: 'write' | 'rehearse_fill' | 'live_fill' | 'after_submit' | 'email' | 'outcome_recorded') {
    const dry = point === 'rehearse_fill';
    const { engine, c, ledger, clock } = scenario({ config: { dryRunDays: dry ? 5 : 0 }, over: { emailReady: () => point === 'email' } });
    const j = mkJob(point === 'email' ? { email: 'hr@crash-example.com' } : {});
    toSelected(j, c.id);
    if (point === 'write') engine.deps.write = never;
    if (point === 'rehearse_fill' || point === 'live_fill') engine.deps.fill = never;
    if (point === 'after_submit') {
      // The employer got it, then the process died before Bureau heard back.
      engine.deps.fill = async (p) => {
        ledger.submitted.set(p.jobId, (ledger.submitted.get(p.jobId) ?? 0) + 1);
        return never();
      };
    }
    if (point === 'email') {
      engine.deps.sendEmail = async ({ packet }) => {
        ledger.submitted.set(packet.jobId, (ledger.submitted.get(packet.jobId) ?? 0) + 1);
        return never();
      };
    }
    if (point === 'outcome_recorded') {
      // The fill came back "submitted" and was journaled; the process died before the transition.
      engine.deps.fill = async (p) => {
        ledger.submitted.set(p.jobId, 1);
        const { recordStep } = await import('../../server/campaign/journal.ts');
        recordStep(clock.now(), { campaignId: c.id, jobId: p.jobId, step: 'outcome', status: 'submitted', detail: { verified: true } });
        return never();
      };
    }
    engine.startCampaign(c.id);
    void engine.tick();
    await flush(10);
    const before = pipelineState(j)!.state;
    engine.stop(); // process dies: the hung step never returns

    // Restart on the same database with healthy modules.
    const clock2 = new FakeClock(clock.now() + 5 * MIN);
    const { deps: deps2 } = fakeDeps(clock2, { emailReady: () => point === 'email' }, ledger);
    const e2 = new Engine(deps2, { tickMs: MIN });
    setEngine(e2);
    const recovered = e2.recover();
    for (let i = 0; i < 6; i++) {
      await step(e2);
      clock2.set(clock2.now() + 10 * MIN);
    }
    return { j, before, recovered, after: pipelineState(j)!.state, submits: ledger.submitted.get(j) ?? 0, fills: ledger.fills.filter((f) => f.jobId === j) };
  }

  await check('crash while writing: resumes from selected and submits exactly once', async () => {
    const r = await crashAt('write');
    assert.equal(r.before, 'writing');
    assert.equal(r.recovered[0]?.to, 'selected');
    assert.equal(r.after, 'submitted');
    assert.equal(r.submits, 1);
  });
  await check('crash during a rehearsal fill: the fill is redone (it never submits)', async () => {
    const r = await crashAt('rehearse_fill');
    assert.equal(r.before, 'filling');
    assert.equal(r.recovered[0]?.to, 'written');
    assert.equal(r.after, 'rehearsed');
    assert.equal(r.submits, 0);
    assert.ok(r.fills.every((f) => !f.submit));
  });
  await check('crash during a live fill: needs_you, never filled again', async () => {
    const r = await crashAt('live_fill');
    assert.equal(r.before, 'filling');
    assert.equal(r.recovered[0]?.to, 'needs_you');
    assert.equal(r.after, 'needs_you');
    assert.equal(r.fills.length, 0, 'engine 2 never re-opened the form');
  });
  await check('crash right after the employer received it: still exactly one submission', async () => {
    const r = await crashAt('after_submit');
    assert.equal(r.after, 'needs_you');
    assert.equal(r.submits, 1);
  });
  await check('crash mid-email: needs_you, the email is never sent twice', async () => {
    const r = await crashAt('email');
    assert.equal(r.before, 'verified');
    assert.equal(r.after, 'needs_you');
    assert.equal(r.submits, 1);
  });
  await check('crash after the outcome was journaled: recovered straight to submitted', async () => {
    const r = await crashAt('outcome_recorded');
    assert.equal(r.recovered[0]?.to, 'submitted');
    assert.equal(r.after, 'submitted');
    assert.equal(r.submits, 1);
  });
  await check('an application already sent elsewhere is recognised on restart', async () => {
    const { engine, c } = scenario();
    const j = mkJob();
    toSelected(j, c.id);
    engine.deps.fill = never;
    engine.startCampaign(c.id);
    void engine.tick();
    await flush(10);
    engine.stop();
    run("UPDATE applications SET status = 'sent' WHERE job_id = ?", j);
    const e2 = new Engine(fakeDeps(new FakeClock(MON_0800 + 2 * HOUR)).deps);
    setEngine(e2);
    e2.recover();
    assert.equal(pipelineState(j)?.state, 'submitted');
  });

  // ── Pacing ────────────────────────────────────────────────────────────────
  section('A08 campaign: pacing on a fake clock');
  await check('applications land only inside active hours, spaced by the pacing gap, within the daily cap', async () => {
    const { engine, c, ledger, clock } = scenario({ start: MON_0800 - 2 * HOUR, config: { dailyCap: 4, pacingMinutes: { min: 10, max: 20 } } });
    for (let i = 0; i < 12; i++) toSelected(mkJob({ score: 90 - i }), c.id);
    engine.startCampaign(c.id);
    engine.start();
    let awakeOutside = false;
    let awakeInside = false;
    const end = MON_0800 + 36 * HOUR;
    while (clock.now() < end) {
      await clock.advance(MIN);
      await engine.settle();
      await flush(2);
      const local = T.localParts(clock.now(), TZ).minutes;
      if (local === 7 * 60 + 30 && engine.deps.keepAwake.held) awakeOutside = true;
      if (local === 12 * 60 && engine.deps.keepAwake.held) awakeInside = true;
    }
    engine.stop();
    const at = ledger.fills.map((f) => f.at);
    assert.equal(at.length, 8, `8 over two days, got ${at.length}`);
    for (const t of at) {
      const m = T.localParts(t, TZ).minutes;
      assert.ok(m >= 9 * 60 && m < 18 * 60, `outside active hours: ${new Date(t).toISOString()}`);
    }
    const byDay = new Map<string, number[]>();
    for (const t of at) byDay.set(T.localParts(t, TZ).date, [...(byDay.get(T.localParts(t, TZ).date) ?? []), t]);
    assert.deepEqual([...byDay.values()].map((v) => v.length), [4, 4]);
    for (const day of byDay.values()) {
      for (let i = 1; i < day.length; i++) {
        const gap = (day[i] - day[i - 1]) / MIN;
        assert.ok(gap >= 10 && gap <= 21, `gap ${gap} min`);
      }
    }
    assert.equal(awakeInside, true, 'keep-awake held during active hours');
    assert.equal(awakeOutside, false, 'keep-awake released outside active hours');
  });

  // ── Dry run → live ────────────────────────────────────────────────────────
  section('A08 campaign: dry run switches to live on schedule');
  await check('two dry-run days rehearse, day three goes live, re-sends the rehearsed roles, and the digest says so', async () => {
    const { engine, c, ledger, clock } = scenario({ config: { dryRunDays: 2, dailyCap: 2, pacingMinutes: { min: 5, max: 10 } } });
    const jobs = [mkJob({ score: 90 }), mkJob({ score: 85 }), mkJob({ score: 80 })];
    for (const j of jobs) toSelected(j, c.id);
    engine.startCampaign(c.id);
    const tuesdayNight = MON_0800 + 2 * 24 * HOUR - 9 * HOUR; // Tue 23:00 local
    await runUntil(engine, clock, tuesdayNight, 5 * MIN);
    assert.ok(ledger.fills.length >= 3 && ledger.fills.every((f) => !f.submit), 'only rehearsals in the dry run');
    assert.deepEqual(jobs.map((j) => pipelineState(j)?.state), ['rehearsed', 'rehearsed', 'rehearsed']);
    assert.equal(C.campaignMeta(c.id).liveSince, null);

    const wednesdayNoon = MON_0800 + 2 * 24 * HOUR + 4 * HOUR;
    await runUntil(engine, clock, wednesdayNoon, 5 * MIN);
    const meta = C.campaignMeta(c.id);
    assert.ok(meta.liveSince && T.localParts(Date.parse(meta.liveSince), TZ).date === '2026-11-04');
    const live = ledger.fills.filter((f) => f.submit);
    assert.equal(live.length, 2, 'cap 2 per day once live');
    assert.ok(live.every((f) => T.localParts(f.at, TZ).date === '2026-11-04'));
    assert.ok(ledger.notes.some((n) => n.kind === 'info' && /live/i.test(n.title)));
    // Packets are reused: the writer ran once per job.
    assert.deepEqual(jobs.map((j) => ledger.writes.get(j)), [1, 1, 1]);
    const d = buildDigest(C.requireCampaign(c.id), clock.now());
    assert.equal(d.mode, 'live');
    assert.match(d.modeNote ?? '', /live since today/i);
    assert.equal(d.totals.sent, 2);

    const thursday = MON_0800 + 3 * 24 * HOUR + 4 * HOUR;
    await runUntil(engine, clock, thursday, 10 * MIN);
    assert.deepEqual(jobs.map((j) => pipelineState(j)?.state), ['submitted', 'submitted', 'submitted']);
    assert.deepEqual(jobs.map((j) => ledger.submitted.get(j)), [1, 1, 1]);
  });
  await check('the dry-run digest names the day and when it goes live', () => {
    const { c, clock } = scenario({ config: { dryRunDays: 2 } });
    C.setStatus(c.id, 'active', 'go', clock.now());
    const d = buildDigest(C.requireCampaign(c.id), clock.now());
    assert.equal(d.mode, 'dry_run');
    assert.match(d.modeNote ?? '', /Dry run, day 1 of 2.*Goes live Wed,? 4 Nov/);
  });

  // ── Auto-end ──────────────────────────────────────────────────────────────
  section('A08 campaign: auto-end');
  await check('at endsAt the campaign ends by itself and sends a final digest', async () => {
    const { engine, c, ledger, clock } = scenario({ config: { endsAt: new Date(MON_0800 + 6 * HOUR).toISOString() } });
    const j = mkJob();
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    await step(engine);
    clock.set(MON_0800 + 6 * HOUR + MIN);
    await step(engine);
    const after = C.requireCampaign(c.id);
    assert.equal(after.status, 'ended');
    const meta = C.campaignMeta(after.id);
    assert.ok(meta.finalDigestId);
    const stored = get<{ content: string }>('SELECT content FROM digests WHERE id = ?', meta.finalDigestId!);
    const content = JSON.parse(stored!.content) as { final: boolean; totals: { sentAllTime: number } };
    assert.equal(content.final, true);
    assert.equal(content.totals.sentAllTime, 1);
    assert.ok(ledger.notes.some((n) => n.kind === 'digest' && /Final digest/.test(n.title)));
    // Nothing runs for it any more.
    const k = mkJob();
    toSelected(k, c.id);
    clock.set(clock.now() + HOUR);
    await step(engine);
    assert.equal(pipelineState(k)?.state, 'selected');
  });

  // ── Kill switch ───────────────────────────────────────────────────────────
  section('A08 campaign: kill switch');
  function abortableFill(ledger: Ledger, seen: { aborted: boolean }) {
    return (p: ApplicationPacket, o: FillOptions) =>
      new Promise<FillOutcome>((_, reject) => {
        ledger.fills.push({ jobId: p.jobId, submit: o.submit, at: 0 });
        o.signal?.addEventListener('abort', () => {
          seen.aborted = true;
          const e = new Error('aborted');
          e.name = 'AbortError';
          setTimeout(() => reject(e), 50);
        });
      });
  }
  await check('killAll stops a running rehearsal fill within 5 seconds and pauses everything', async () => {
    const { engine, c, ledger } = scenario({ config: { dryRunDays: 3 } });
    const seen = { aborted: false };
    engine.deps.fill = abortableFill(ledger, seen);
    const j = mkJob();
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    void engine.tick();
    await flush(10);
    assert.equal(pipelineState(j)?.state, 'filling');
    const r = await campaignIndex.killAll('test kill', 'ui');
    assert.ok(r.ms < 5000, `${r.ms} ms`);
    assert.equal(r.settled, true);
    assert.equal(seen.aborted, true);
    assert.equal(pipelineState(j)?.state, 'written');
    assert.equal(C.requireCampaign(c.id).status, 'paused');
    assert.equal(killState()?.source, 'ui');
    assert.ok(ledger.closed >= 1, 'browsers closed');
    assert.equal(engine.deps.keepAwake.held, false);
    await step(engine);
    assert.equal(ledger.fills.length, 1, 'nothing runs while killed');
  });
  await check('a kill during a live fill parks the job at needs_you (it may have been sent)', async () => {
    const { engine, c, ledger } = scenario();
    const seen = { aborted: false };
    engine.deps.fill = abortableFill(ledger, seen);
    const j = mkJob();
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    void engine.tick();
    await flush(10);
    await engine.kill('test', 'telegram');
    assert.equal(pipelineState(j)?.state, 'needs_you');
  });
  await check('a fill that ignores the abort still lets the kill return within 5 seconds', async () => {
    const { engine, c } = scenario();
    engine.deps.fill = never;
    const j = mkJob();
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    void engine.tick();
    await flush(10);
    const r = await engine.kill('stuck', 'ui');
    assert.ok(r.ms < 5000, `${r.ms} ms`);
    assert.equal(r.settled, false);
    assert.equal(C.requireCampaign(c.id).status, 'paused');
  });
  await check('the data/STOP file trips the switch, blocks resume, and resume works once it is gone', async () => {
    const { engine, c } = scenario();
    engine.startCampaign(c.id);
    fs.writeFileSync(STOP_FILE(), '');
    await step(engine);
    assert.equal(killState()?.source, 'file');
    assert.equal(C.requireCampaign(c.id).status, 'paused');
    assert.throws(() => engine.resumeCampaign(c.id), /STOP/);
    fs.rmSync(STOP_FILE());
    engine.resumeCampaign(c.id);
    assert.equal(killState(), null);
    assert.equal(C.requireCampaign(c.id).status, 'active');
  });
  await check('an exhausted AI budget trips the switch; an exhausted campaign budget pauses just that campaign', async () => {
    const s1 = scenario({ over: { monthBudget: () => ({ spentUsd: 30, budgetUsd: 25 }) } });
    s1.engine.startCampaign(s1.c.id);
    await step(s1.engine);
    assert.equal(killState()?.source, 'budget');

    const s2 = scenario({ config: { budgetUsd: 5 }, over: { spendSince: () => 6 } });
    s2.engine.startCampaign(s2.c.id);
    await step(s2.engine);
    assert.equal(killState(), null);
    assert.equal(C.requireCampaign(s2.c.id).status, 'paused');
    assert.ok(s2.ledger.notes.some((n) => n.kind === 'alert' && /budget/i.test(n.body)));
  });
  await check('a BUDGET error from the writer trips the switch and keeps the job queued', async () => {
    const { engine, c } = scenario();
    engine.deps.write = () => Promise.reject(new AppError(402, 'BUDGET', 'Monthly AI budget of $25 reached.'));
    const j = mkJob();
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    await step(engine);
    assert.equal(killState()?.source, 'budget');
    assert.equal(pipelineState(j)?.state, 'selected');
  });
  await check('unknown questions answered by the owner re-queue the job', async () => {
    const { engine, c } = scenario();
    engine.deps.fill = async () => outcome('needs_you', true, 'unknown_question: "Do you hold a driving licence?"');
    const j = mkJob();
    toSelected(j, c.id);
    engine.startCampaign(c.id);
    await step(engine);
    assert.equal(pipelineState(j)?.state, 'needs_you');
    engine.start();
    bus.emit('event', { type: 'question.answered', questionId: 'q1', jobId: j });
    engine.stop();
    assert.equal(pipelineState(j)?.state, 'written');
  });

  // ── Digest ────────────────────────────────────────────────────────────────
  section('A08 campaign: daily digest');
  await check('a fixture day renders into a short, complete digest', () => {
    isolate();
    const nowMs = Date.now();
    const c = C.createCampaign({
      name: 'Digest <Day> & Co',
      config: cfg({ startsAt: new Date(nowMs - 3 * 24 * HOUR).toISOString(), endsAt: new Date(nowMs + 20 * 24 * HOUR).toISOString(), activeHours: { tz: 'UTC', start: '00:00', end: '00:00' }, budgetUsd: 20 }),
    });
    C.setStatus(c.id, 'active', 'go', nowMs - 3 * 24 * HOUR);
    const at = new Date(nowMs).toISOString();
    const sentJobs = [mkJob({ company: 'Acme <Labs>', title: 'Backend Engineer', score: 82 }), mkJob({ company: 'Globex', title: 'Full-Stack Dev', score: 77 })];
    const recordStep = (j: string, s: 'submitted' | 'rehearsed') =>
      run("INSERT INTO campaign_steps (ts, campaign_id, job_id, step, status, detail) VALUES (?, ?, ?, ?, 'ok', ?)", at, c.id, j, s, JSON.stringify({ applicationId: `app-${j}`, channel: 'form', shot: '/x.png' }));
    for (const j of sentJobs) {
      toSelected(j, c.id);
      recordStep(j, 'submitted');
    }
    const reh = mkJob({ company: 'Initech' });
    toSelected(reh, c.id);
    recordStep(reh, 'rehearsed');
    const skips = ['screen-pass 41 is below the campaign minimum of 60', 'screen-pass 52 is below the campaign minimum of 60', 'applied to Acme on 2026-10-20 (cooldown 30 days)', 'unknown_question: "Security clearance level?"'];
    for (const reason of skips) {
      const j = mkJob();
      transition(j, 'found', { campaignId: c.id });
      transition(j, 'skipped', { reason });
    }
    const ny = mkJob({ company: 'Umbrella' });
    toSelected(ny, c.id);
    for (const s of ['writing', 'written', 'filling', 'needs_you'] as const) transition(ny, s, { reason: s === 'needs_you' ? 'CAPTCHA on the last step' : undefined });
    run("INSERT INTO unknown_questions (id, question_raw, question_norm, job_id, field_kind, options, status, created_at) VALUES (?, 'Do you have a UK driving licence?', 'uk driving licence', ?, 'radio', '[\"Yes\",\"No\"]', 'open', ?)", 'qdigest-1', ny, at);
    run("INSERT INTO inbox_messages (id, message_id, from_addr, subject, received_at, class, application_id, data) VALUES ('m1', 'm1@x', 'hr@acme.test', 'Interview', ?, 'interview_invite', NULL, ?)", at, JSON.stringify({ company: 'Acme', summary: 'Pick a slot for a 30-minute call', deadline: '2026-11-06' }));
    run("INSERT INTO inbox_messages (id, message_id, from_addr, subject, received_at, class, application_id, data) VALUES ('m2', 'm2@x', 'no@globex.test', 'Update', ?, 'rejection', NULL, '{}')", at);
    run("INSERT INTO ai_usage (ts, task, model, input_tokens, output_tokens, cost_usd) VALUES (?, 'write_letter', 'claude-opus-5-5', 1, 1, 1.25)", at);
    run("INSERT INTO gap_reports (id, period, report, created_at) VALUES ('g1', '2026-W45', ?, ?)", JSON.stringify({ skills: [{ skill: 'Kubernetes', count: 7 }, { skill: 'Go', count: 5 }, { skill: 'GraphQL', count: 4 }, { skill: 'Terraform', count: 3 }, { skill: 'Kafka', count: 2 }, { skill: 'Rust', count: 1 }] }), at);
    run("INSERT INTO form_recipes (id, ats, scope, scope_key, recipe, status, created_at, updated_at) VALUES ('r1', 'greenhouse', 'ats', 'greenhouse', '{}', 'active', ?, ?)", at, at);

    const d = buildDigest(C.requireCampaign(c.id), nowMs, { sourceHealth: () => [{ id: 'linkedin', label: 'LinkedIn', status: 'failing', lastError: '429' }, { id: 'remoteok', label: 'RemoteOK', status: 'ok', lastError: null }] });
    assert.equal(d.totals.sent, 2);
    assert.equal(d.totals.rehearsed, 1);
    assert.equal(d.sent[0].score, 82);
    assert.ok(d.sent[0].shotUrl?.includes('/api/applications/'));
    assert.deepEqual(d.skipped.map((s) => [s.reason, s.count]), [['Score below the minimum', 2], ['Company cooldown', 1], ['Unknown question on the form', 1]]);
    assert.equal(d.needsYou[0].company, 'Umbrella');
    assert.match(d.needsYou[0].reason, /CAPTCHA/);
    assert.ok(d.questions.some((q) => q.id === 'qdigest-1'));
    assert.equal(d.inbox.interviews[0].company, 'Acme');
    assert.equal(d.inbox.rejections, 1);
    assert.ok(d.spend.todayUsd >= 1.25);
    assert.equal(d.gaps.length, 5);
    assert.equal(d.recipesPromoted[0].ats, 'greenhouse');
    assert.deepEqual(d.sourceWarnings.map((s) => s.source), ['LinkedIn']);

    const text = renderDigestText(d);
    assert.ok(text.length < 2500, `digest is ${text.length} chars`);
    for (const needle of ['Sent 2', 'Rehearsed 1', 'Score below the minimum: 2', 'Umbrella', 'driving licence', 'interview invite: Acme', 'Top gaps this week: Kubernetes (7)', 'greenhouse', 'LinkedIn failing', 'Spend: $']) {
      assert.ok(text.includes(needle), `missing "${needle}" in:\n${text}`);
    }
    const html = renderDigestTelegram(d);
    assert.ok(html.includes('Acme &lt;Labs&gt;') && html.includes('Digest &lt;Day&gt; &amp; Co'), 'telegram HTML escapes untrusted names');
    assert.ok(!html.includes('<Labs>'));
  });
  await check('skip reasons fold into families a phone can scan', () => {
    assert.equal(skipFamily('blocker: requires active security clearance'), 'Hard blocker (licence, clearance, citizenship…)');
    assert.equal(skipFamily('posted more than 14 days ago'), 'Posting too old');
    assert.equal(skipFamily(null), 'No reason given');
  });
  await check('the daily digest goes out once, after active hours close', async () => {
    const { engine, c, ledger, clock } = scenario();
    engine.startCampaign(c.id);
    await step(engine);
    assert.equal(ledger.notes.filter((n) => n.kind === 'digest').length, 0);
    clock.set(MON_0800 + 10 * HOUR + 20 * MIN); // 18:20 local
    await step(engine);
    clock.set(clock.now() + 30 * MIN);
    await step(engine);
    assert.equal(ledger.notes.filter((n) => n.kind === 'digest').length, 1);
    assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM digests WHERE campaign_id = ?', c.id)?.n, 1);
  });

  // ── Telegram ──────────────────────────────────────────────────────────────
  section('A08 campaign: Telegram (mocked API)');
  const TOKEN = '123456789:AAEexampleexampleexampleexample12345';
  const OWNER = '424242';
  interface Call {
    method: string;
    body: Record<string, unknown>;
  }
  function mockTelegram(updates: TgUpdate[][] = []) {
    const calls: Call[] = [];
    let mid = 100;
    const restore = setTelegramHttp(async (token, method, body) => {
      assert.equal(token, TOKEN);
      calls.push({ method, body });
      if (method === 'sendMessage') return { ok: true, result: { message_id: ++mid } };
      if (method === 'getUpdates') {
        const next = updates.shift();
        if (!next) await new Promise((r) => setTimeout(r, 25)); // a real long poll waits; never spin
        return { ok: true, result: next ?? [] };
      }
      if (method === 'getMe') return { ok: true, result: { id: 1, username: 'BureauBot' } };
      return { ok: false, description: 'unknown method' };
    });
    return { calls, restore };
  }
  const msg = (chat: string, text: string, extra: Partial<NonNullable<TgUpdate['message']>> = {}): TgUpdate => ({
    update_id: Math.floor(Math.random() * 1e9),
    message: { message_id: Math.floor(Math.random() * 1e6), date: 0, text, chat: { id: Number(chat), type: 'private' }, ...extra },
  });

  await check('commands parse with or without @botname, and other bots are ignored', () => {
    assert.deepEqual(parseCommand('/status'), { cmd: 'status', args: '', raw: '/status' });
    assert.equal(parseCommand('/pause@BureauBot  Spring push', 'BureauBot')?.args, 'Spring push');
    assert.equal(parseCommand('/pause@OtherBot x', 'BureauBot'), null);
    assert.equal(parseCommand('/STOP')?.cmd, 'stop');
    assert.equal(parseCommand('/frobnicate')?.cmd, 'unknown');
    assert.equal(parseCommand('hello there'), null);
    assert.deepEqual(splitAnswer('q3f9a2 Two weeks, negotiable'), { ref: 'q3f9a2', text: 'Two weeks, negotiable' });
    assert.equal(splitAnswer('q3f9a2'), null);
  });
  await check('only the configured chat id is obeyed; strangers get no reply at all', async () => {
    setTelegramCredentials(TOKEN, OWNER);
    const { calls, restore } = mockTelegram();
    let stops = 0;
    const handlers = { status: async () => 'ok', today: async () => 'ok', stop: async () => (stops++, 'stopped'), pause: async () => 'p', resume: async () => 'r', answer: async () => 'a' };
    try {
      const r1 = await handleUpdate(msg('999', '/stop'), handlers);
      assert.equal(r1.handled, false);
      assert.equal(r1.reason, 'other_chat');
      assert.equal(stops, 0);
      assert.equal(calls.length, 0);
      const r2 = await handleUpdate(msg(OWNER, '/stop'), handlers);
      assert.equal(r2.handled, true);
      assert.equal(stops, 1);
      assert.equal(calls[0].method, 'sendMessage');
      assert.equal(calls[0].body.chat_id, OWNER);
    } finally {
      restore();
    }
  });
  await check('/status, /pause, /resume, /today and /stop drive the real engine', async () => {
    const { engine, c } = scenario({ name: 'Telegram Campaign' });
    engine.startCampaign(c.id);
    setTelegramCredentials(TOKEN, OWNER);
    const { calls, restore } = mockTelegram();
    const h = telegramHandlers(engine);
    try {
      const status = await handleUpdate(msg(OWNER, '/status'), h);
      assert.match(status.reply ?? '', /Telegram Campaign<\/b>: live/);
      await handleUpdate(msg(OWNER, '/pause telegram campaign'), h);
      assert.equal(C.requireCampaign(c.id).status, 'paused');
      await handleUpdate(msg(OWNER, '/resume'), h);
      assert.equal(C.requireCampaign(c.id).status, 'active');
      const today = await handleUpdate(msg(OWNER, '/today'), h);
      assert.match(today.reply ?? '', /Bureau digest/);
      await handleUpdate(msg(OWNER, '/stop'), h);
      assert.equal(killState()?.source, 'telegram');
      assert.equal(C.requireCampaign(c.id).status, 'paused');
      const bad = await handleUpdate(msg(OWNER, '/pause no-such-campaign'), h);
      assert.match(bad.reply ?? '', /Could not do that/);
      assert.ok(calls.every((x) => x.body.chat_id === OWNER));
    } finally {
      restore();
    }
  });
  await check('questions go out once; /answer and a plain reply both reach the answer bank and re-queue the job', async () => {
    const { engine, c } = scenario();
    setTelegramCredentials(TOKEN, OWNER);
    const { calls, restore } = mockTelegram();
    engine.start();
    try {
      const j = mkJob({ company: 'Answerly' });
      toSelected(j, c.id);
      for (const s of ['writing', 'written', 'filling', 'needs_you'] as const) transition(j, s);
      const { savePacket } = await import('../../server/campaign/journal.ts');
      savePacket(j, c.id, packetFor(j, `app-${j}`), Date.now());
      const q1 = `q${uid('x').replace(/[^a-z0-9]/g, '')}`;
      const q2 = `r${uid('y').replace(/[^a-z0-9]/g, '')}`;
      for (const [id, text] of [[q1, 'Notice period?'], [q2, 'Do you hold a full driving licence?']]) {
        run("INSERT INTO unknown_questions (id, question_raw, question_norm, job_id, field_kind, status, created_at) VALUES (?, ?, ?, ?, 'text', 'open', ?)", id, text, text.toLowerCase(), j, dbNow());
      }
      assert.equal(await pushQuestions(10) >= 2, true);
      const sentBefore = calls.length;
      assert.equal(await pushQuestions(10), 0, 'never sent twice');
      assert.equal(calls.length, sentBefore);
      const short1 = get<{ short_id: string }>('SELECT short_id FROM campaign_question_notices WHERE question_id = ?', q1)!.short_id;
      const r = await handleUpdate(msg(OWNER, `/answer ${short1} Two weeks`), telegramHandlers(engine));
      assert.match(r.reply ?? '', /Saved/);
      assert.equal(get<{ status: string }>('SELECT status FROM unknown_questions WHERE id = ?', q1)?.status, 'answered');
      assert.ok(get("SELECT 1 FROM answer_bank WHERE answer = 'Two weeks'"));
      // Nothing re-queues while the job still has another open question.
      assert.equal(pipelineState(j)?.state, 'needs_you');

      const mid = get<{ message_id: number }>('SELECT message_id FROM campaign_question_notices WHERE question_id = ?', q2)!.message_id;
      const r2 = await handleUpdate(msg(OWNER, 'Yes, a full UK licence', { reply_to_message: { message_id: mid } }), telegramHandlers(engine));
      assert.equal(r2.handled, true);
      assert.ok(get("SELECT 1 FROM answer_bank WHERE answer = 'Yes, a full UK licence'"));
      // The packet is already written, so the job goes straight back to filling.
      assert.equal(pipelineState(j)?.state, 'written');
    } finally {
      engine.stop();
      restore();
    }
  });
  await check('the poller persists its offset and survives a stranger in the queue', async () => {
    setTelegramCredentials(TOKEN, OWNER);
    const { calls, restore } = mockTelegram([[{ ...msg('777', '/stop'), update_id: 500 }, { ...msg(OWNER, '/help'), update_id: 501 }]]);
    const ctl = new AbortController();
    let stops = 0;
    const handlers = { status: async () => 's', today: async () => 't', stop: async () => (stops++, 'x'), pause: async () => 'p', resume: async () => 'r', answer: async () => 'a' };
    try {
      const done = startTelegramPoller(handlers, { signal: ctl.signal });
      for (let i = 0; i < 50 && !calls.some((c) => c.method === 'sendMessage'); i++) await flush(2);
      ctl.abort();
      await done;
      assert.equal(stops, 0);
      assert.equal(calls.filter((c) => c.method === 'sendMessage').length, 1);
      assert.equal(get<{ value: string }>("SELECT value FROM settings WHERE key = 'telegram.offset'")?.value, '502');
    } finally {
      restore();
    }
  });
  await check('alerts and digests fan out to Telegram, ntfy and email; a dead channel does not block the others', async () => {
    setTelegramCredentials(TOKEN, OWNER);
    setNtfyTopic('bureau-test-topic-1');
    saveNotifySettings({ ...DEFAULT_NOTIFY, email: { digest: true, to: 'owner@example.com' }, ntfy: { enabled: true, server: 'https://ntfy.sh', alerts: true, digest: true } });
    const { calls, restore } = mockTelegram();
    const ntfy: string[] = [];
    const mails: string[] = [];
    const r1 = N.setNtfyHttp(async (url, m) => void ntfy.push(`${url} ${m.priority}`));
    const r2 = N.setMailSender(async (m) => {
      mails.push(m.to);
      throw new Error('SMTP down');
    });
    try {
      const a = await N.deliver('alert', { title: 'Interview: Acme', body: 'Pick a slot by Friday' });
      assert.deepEqual(a.via.sort(), ['ntfy', 'telegram']);
      assert.ok(ntfy[0].endsWith('/bureau-test-topic-1 high'));
      assert.match(String(calls[0].body.text), /Alert: Interview: Acme/);
      const d = await N.deliver('digest', { title: 'Digest', body: 'Sent 2' });
      assert.deepEqual(d.via.sort(), ['ntfy', 'telegram']);
      assert.deepEqual(mails, ['owner@example.com']);
      assert.equal(d.errors[0].channel, 'email');
    } finally {
      restore();
      r1();
      r2();
      saveNotifySettings(DEFAULT_NOTIFY);
      setNtfyTopic(null);
    }
  });
  await check('offline mode refuses to reach the real Telegram API, and long messages are chunked', async () => {
    setTelegramCredentials(TOKEN, OWNER);
    await assert.rejects(sendTelegram('hello'), /offline/i);
    const parts = chunk(Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n'));
    assert.ok(parts.length > 1 && parts.every((p) => p.length <= 3800));
  });

  // ── Keep-awake ────────────────────────────────────────────────────────────
  section('A08 campaign: keep-awake');
  await check('Windows holds one PowerShell SetThreadExecutionState helper; Linux does nothing', () => {
    const spawned: string[][] = [];
    let killed = 0;
    const k = createKeepAwake({
      platform: 'win32',
      spawner: (cmd, args) => {
        spawned.push([cmd, ...args]);
        return { pid: 9, kill: () => (killed++, true), once: () => undefined as never, stdin: null } as never;
      },
    });
    k.hold();
    k.hold();
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0][0], 'powershell.exe');
    const script = Buffer.from(spawned[0][spawned[0].length - 1], 'base64').toString('utf16le');
    assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483649\)/);
    assert.equal(spawned[0][spawned[0].length - 1], encodedCommand());
    assert.equal(k.held, true);
    k.release();
    assert.equal(killed, 1);
    assert.equal(k.held, false);
    const linux = createKeepAwake({ platform: 'linux', spawner: () => assert.fail('no spawn on linux') });
    linux.hold();
    assert.equal(linux.held, false);
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  section('A08 campaign: routes');
  {
    const { default: Fastify } = await import('fastify');
    const app = Fastify();
    app.setErrorHandler((err: Error, _req, reply) => {
      if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message });
      return reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: 'X', message: err.message });
    });
    await app.register(campaignRoutes);
    const { engine } = scenario();
    void engine;
    const inject = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
      const r = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
      return { status: r.statusCode, json: (r.body ? JSON.parse(r.body) : null) as Record<string, unknown> };
    };
    await check('campaign CRUD and lifecycle over HTTP', async () => {
      assert.equal((await inject('POST', '/api/campaigns', { name: 'x', config: cfg({ dailyCap: 9999 }) })).status, 400);
      const created = await inject('POST', '/api/campaigns', { name: 'Route Campaign', config: cfg() });
      assert.equal(created.status, 200);
      const id = created.json.id as string;
      assert.equal(created.json.status, 'draft');
      assert.ok((created.json.stats as Record<string, unknown>).today);
      const list = await inject('GET', '/api/campaigns');
      assert.ok((list.json.campaigns as { id: string }[]).some((c) => c.id === id));
      assert.equal((await inject('PUT', `/api/campaigns/${id}`, { config: { dailyCap: 7 } })).status, 200);
      assert.equal(((await inject('GET', `/api/campaigns/${id}`)).json.config as CampaignConfig).dailyCap, 7);
      assert.equal((await inject('POST', `/api/campaigns/${id}/start`)).json.status, 'active');
      assert.equal((await inject('DELETE', `/api/campaigns/${id}`)).status, 409);
      assert.equal((await inject('POST', `/api/campaigns/${id}/pause`)).json.status, 'paused');
      assert.equal((await inject('POST', `/api/campaigns/${id}/resume`)).json.status, 'active');
      const ended = await inject('POST', `/api/campaigns/${id}/end`);
      assert.equal(ended.json.status, 'ended');
      assert.ok(ended.json.finalDigestId);
      assert.equal((await inject('GET', '/api/campaigns/nope')).status, 404);
      assert.ok((await inject('GET', '/api/campaigns/defaults')).json.config);
      assert.equal((await inject('GET', '/api/campaigns/status')).status, 200);
      assert.equal((await inject('PUT', '/api/campaigns/settings', { globalDailyCap: 400 })).json.globalDailyCap, 400);
      assert.equal((await inject('PUT', '/api/campaigns/settings', { globalDailyCap: -3 })).status, 400);
    });
    await check('pipeline, steps and per-job timeline', async () => {
      const { engine: e, c } = scenario();
      setEngine(e);
      const j = mkJob();
      toSelected(j, c.id);
      e.startCampaign(c.id);
      await step(e);
      const pipe = await inject('GET', `/api/campaigns/${c.id}/pipeline?state=submitted`);
      assert.equal((pipe.json.rows as { jobId: string }[])[0].jobId, j);
      const tl = await inject('GET', `/api/campaigns/jobs/${j}/timeline`);
      const kinds = (tl.json.timeline as { kind: string; to?: string; step?: string }[]).map((x) => x.to ?? x.step);
      assert.ok(kinds.includes('submit_intent') && kinds.includes('submitted'));
      assert.equal((await inject('GET', '/api/campaigns/jobs/none/timeline')).status, 404);
      assert.ok(((await inject('GET', `/api/campaigns/${c.id}/steps`)).json.steps as unknown[]).length > 3);
    });
    await check('digests: preview, send, list, read', async () => {
      const { engine: e, c, ledger } = scenario();
      setEngine(e);
      e.startCampaign(c.id);
      const pv = await inject('POST', '/api/digests/preview', { campaignId: c.id });
      assert.match(pv.json.text as string, /Bureau digest/);
      const sent = await inject('POST', '/api/digests/send', { campaignId: c.id });
      assert.deepEqual(sent.json.via, ['test']);
      assert.equal(ledger.notes.at(-1)?.kind, 'digest');
      const list = await inject('GET', `/api/digests?campaignId=${c.id}`);
      assert.equal((list.json.digests as unknown[]).length, 1);
      const one = await inject('GET', `/api/digests/${sent.json.id as string}`);
      assert.match(one.json.text as string, /Sent 0/);
    });
    await check('notification settings never echo secrets; bad tokens are refused; the test message goes through the mock', async () => {
      clearTelegram();
      assert.equal((await inject('PUT', '/api/notify/telegram', { token: 'not-a-token' })).status, 400);
      const ok = await inject('PUT', '/api/notify/telegram', { token: TOKEN, chatId: OWNER });
      assert.equal(ok.status, 200);
      const state = await inject('GET', '/api/notify');
      const raw = JSON.stringify(state.json);
      assert.ok(!raw.includes(TOKEN) && !raw.includes(TOKEN.slice(12)) && !raw.includes(OWNER), raw);
      assert.equal((state.json.telegram as { configured: boolean }).configured, true);
      const { calls, restore } = mockTelegram();
      try {
        const t = await inject('POST', '/api/notify/test', { channel: 'telegram' });
        assert.equal(t.status, 200);
        assert.equal(calls[0].method, 'sendMessage');
      } finally {
        restore();
      }
      assert.equal((await inject('POST', '/api/notify/test', { channel: 'ntfy' })).status, 502);
      assert.equal((await inject('PUT', '/api/notify/ntfy', { topic: 'x' })).status, 400);
      assert.equal((await inject('PUT', '/api/notify/settings', { ...DEFAULT_NOTIFY, ntfy: { ...DEFAULT_NOTIFY.ntfy, server: 'http://insecure' } })).status, 400);
    });
    await check('the kill route trips and clears the switch', async () => {
      const { engine: e, c } = scenario();
      setEngine(e);
      e.startCampaign(c.id);
      const k = await inject('POST', '/api/kill', { reason: 'from the UI' });
      assert.equal(k.status, 200);
      assert.equal((k.json.kill as { source: string }).source, 'ui');
      assert.equal(C.requireCampaign(c.id).status, 'paused');
      assert.equal((await inject('POST', '/api/campaigns/run-now')).status, 409);
      assert.equal((await inject('DELETE', '/api/kill')).json.kill, null);
    });
    await app.close();
  }

  // ── /api/hunt shim ────────────────────────────────────────────────────────
  section('A08 campaign: /api/hunt compatibility');
  await check('the hunt maps onto a campaign: switching it on creates and starts one, off pauses it', async () => {
    const { engine } = scenario();
    setEngine(engine);
    run("UPDATE campaigns SET status = 'ended'");
    const hunt = await import('../../server/services/hunt.ts');
    assert.equal(hunt.huntSettings().enabled, false);
    hunt.saveHuntSettings({ ...hunt.DEFAULT_HUNT, enabled: true, mode: 'rehearse', dailyCap: 6, applyThreshold: 70 });
    const c = hunt.huntCampaign();
    assert.ok(c && c.status === 'active');
    assert.equal(C.campaignMeta(c.id).compat, true);
    const s = hunt.huntSettings();
    assert.deepEqual([s.enabled, s.mode, s.dailyCap, s.applyThreshold], [true, 'rehearse', 6, 70]);
    const status = await hunt.huntStatus();
    for (const key of ['settings', 'running', 'last', 'nextRunAt', 'today', 'needsYouTotal', 'readiness', 'costs']) assert.ok(key in status, key);
    hunt.stopHunt();
    hunt.saveHuntSettings({ ...s, enabled: false });
    assert.equal(C.requireCampaign(c.id).status, 'paused');
    assert.equal(hunt.huntSettings().enabled, false);
    run("UPDATE campaigns SET status = 'ended' WHERE id = ?", c.id);
  });

  // Leave nothing running for later check files.
  isolate();
  clearTelegram();
  setEngine(null);
  void db;
}
