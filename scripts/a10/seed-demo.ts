/**
 * Fills a throwaway data dir with fictional demo data for UI screenshots and
 * smoke runs. Everything here is made up (example.net domains, a fictional
 * candidate from the writer's fixture scenario). Never point it at real data.
 *
 *   BUREAU_DATA_DIR=<temp dir> npx tsx scripts/a10/seed-demo.ts [--live]
 *
 * Runs offline: replay mode for Claude, hash embeddings, no network. The one
 * real writer run uses A04's recorded responses, so the Studio and the job
 * timeline show a genuine evidence map, variants, lint and truth lock.
 * With --live the demo campaign's active hours include "now" (the sash shows
 * it applying soon); without it the campaign rests until its window opens.
 */
import crypto from 'node:crypto';

if (!process.env.BUREAU_DATA_DIR) {
  console.error('Set BUREAU_DATA_DIR to a temporary folder first.');
  process.exit(1);
}
process.env.BUREAU_REPLAY = '1';
process.env.BUREAU_EMBED ??= 'hash';

export interface DemoSeed {
  campaignId: string;
  questionIds: string[];
  showcaseJobId: string;
}

export async function seedDemo(opts: { live?: boolean } = {}): Promise<DemoSeed> {
  const { run, get, setSetting } = await import('../../server/db.ts');
  const F = await import('../../server/writer/fixtures.ts');
  const { writeApplicationRun } = await import('../../server/writer/pipeline.ts');
  const { seededRng } = await import('../../server/writer/text.ts');
  const { transition } = await import('../../server/campaign/pipeline.ts');
  const { createCampaign, setStatus, setMeta } = await import('../../server/campaign/campaigns.ts');
  const { recordStep } = await import('../../server/campaign/journal.ts');
  const { buildDigest, saveDigest, markDigestSent } = await import('../../server/campaign/digest.ts');
  const { recordUnknown } = await import('../../server/profile/unknown.ts');
  const { listAnswers, updateAnswer, upsertAnswer } = await import('../../server/profile/answers.ts');
  const { setLinks } = await import('../../server/profile/links.ts');
  const { saveAutopilotSettings } = await import('../../server/campaign/settings.ts');
  const { createApiKey } = await import('../../server/api/keys.ts');
  const { writeAudit } = await import('../../server/api/audit.ts');
  const { CONNECTORS } = await import('../../server/sources/index.ts');

  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const H = 3_600_000;
  const D = 24 * H;

  // ── Nothing may reach the network: every source off, no keep-awake helper.
  setSetting('sources', { enabled: Object.fromEntries(CONNECTORS.map((c) => [c.id, false])), boards: { greenhouse: [], lever: [], ashby: [] }, extraKeywords: [], maxAgeDays: 30 });
  saveAutopilotSettings({ keepAwake: false });

  // ── The fictional candidate, facts, voice bank, learning list and one real writer run.
  F.seedScenario();
  const written = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { rng: seededRng(F.SEED) });
  setLinks({ github: 'https://github.com/ayesha-dev', portfolio: 'https://ayesha.example.com', linkedin: 'https://www.linkedin.com/in/ayesha-example', socials: [{ label: 'Blog', url: 'https://ayesha.example.com/notes' }] });
  const answers = listAnswers();
  const fill: Record<string, string> = {
    work_authorization: 'Pakistani citizen; authorised to work in Pakistan. Would need sponsorship elsewhere.',
    sponsorship: 'Yes, outside Pakistan',
    start_date: 'Two weeks after an offer',
    expected_salary: 'PKR 350,000 a month',
    relocation: 'Open to relocating within Pakistan or to the Gulf',
    remote: 'Yes, remote or hybrid both work',
    years_experience: '1.5',
    referral_source: 'Company careers page',
    highest_education: "Bachelor's in Computer Science",
  };
  for (const a of answers) if (a.intent && fill[a.intent] && !a.answer) updateAnswer(a.id, { answer: fill[a.intent] });
  upsertAnswer({ question: 'Are you comfortable with on-call rotations?', answer: 'Yes, with a fair rota' });

  // ── Campaigns.
  const hour = new Date().getHours();
  const window = opts.live ? { start: '00:00', end: '23:59' } : { start: `${String((hour + 3) % 24).padStart(2, '0')}:00`, end: `${String((hour + 11) % 24).padStart(2, '0')}:00` };
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* UTC */
  }
  const cfg = {
    startsAt: iso(D),
    endsAt: new Date(now + 27 * D).toISOString(),
    roles: ['Backend Engineer', 'Junior Software Engineer', 'Platform Engineer'],
    categories: ['software', 'devops_cloud'],
    locations: ['Lahore', 'Karachi', 'Remote'],
    remoteOnly: false,
    stretchLevel: 'balanced',
    minScore: 60,
    dailyCap: 8,
    companyCooldownDays: 30,
    activeHours: { tz, ...window },
    pacingMinutes: { min: 12, max: 25 },
    budgetUsd: 15,
    dryRunDays: 2,
    channels: { email: true, forms: true, agent: true },
    sources: Object.fromEntries(CONNECTORS.map((c) => [c.id, false])),
    maxAgeDays: 14,
    followUpDays: 7,
    onUnknownQuestion: 'skip',
    scoutEveryHours: 3,
  };
  const camp = createCampaign({ name: 'Backend roles, November', config: cfg });
  setStatus(camp.id, 'active', null, now - D);
  setMeta(camp.id, { firstActiveAt: iso(D) });
  const later = createCampaign({ name: 'Gulf platform roles', config: { ...cfg, roles: ['Platform Engineer', 'DevOps Engineer'], locations: ['Dubai', 'Riyadh'], startsAt: new Date(now + 10 * D).toISOString(), endsAt: new Date(now + 40 * D).toISOString(), stretchLevel: 'aggressive' } });
  void later;
  run('UPDATE pipeline SET campaign_id = ? WHERE campaign_id = ?', camp.id, F.CAMPAIGN_ID);
  run('UPDATE applications SET campaign_id = ? WHERE campaign_id = ?', camp.id, F.CAMPAIGN_ID);

  // ── A spread of fictional jobs through every pipeline state.
  type S = 'found' | 'scored' | 'selected' | 'writing' | 'written' | 'needs_you' | 'rehearsed' | 'submitted' | 'failed' | 'skipped';
  const PATH: Record<S, string[]> = {
    found: ['found'],
    scored: ['found', 'filtered', 'scored'],
    selected: ['found', 'filtered', 'scored', 'selected'],
    writing: ['found', 'filtered', 'scored', 'selected', 'writing'],
    written: ['found', 'filtered', 'scored', 'selected', 'writing', 'written'],
    needs_you: ['found', 'filtered', 'scored', 'selected', 'writing', 'written', 'filling', 'needs_you'],
    rehearsed: ['found', 'filtered', 'scored', 'selected', 'writing', 'written', 'filling', 'verified', 'rehearsed'],
    submitted: ['found', 'filtered', 'scored', 'selected', 'writing', 'written', 'filling', 'verified', 'submitted'],
    failed: ['found', 'filtered', 'scored', 'selected', 'writing', 'written', 'filling', 'failed'],
    skipped: ['found', 'filtered', 'scored', 'skipped'],
  };
  const JOBS: [string, string, string, S, number | null, string, string | null][] = [
    ['Backend Engineer', 'Tessellate Labs', 'Remote', 'submitted', 84, 'greenhouse', null],
    ['Junior Platform Engineer', 'Saffron Cloud', 'Karachi', 'submitted', 79, 'lever', null],
    ['Software Engineer, Payments API', 'Indus Ledger', 'Lahore (hybrid)', 'rehearsed', 81, 'ashby', null],
    ['Backend Developer (Go)', 'Kestrel Freight', 'Remote', 'rehearsed', 74, 'workable', null],
    ['Associate Software Engineer', 'Minaret Health', 'Islamabad', 'rehearsed', 70, 'smartrecruiters', null],
    ['Platform Engineer I', 'Northwind Retail', 'Dubai', 'needs_you', 77, 'workday', 'The form shows a CAPTCHA. Everything else is filled; finish it in a browser.'],
    ['Backend Engineer, Search', 'Paper Crane', 'Remote', 'needs_you', 72, 'greenhouse', 'Could not verify the phone field after two tries.'],
    ['Junior Backend Engineer', 'Lattice Schools', 'Lahore', 'written', 76, 'lever', null],
    ['Site Reliability Engineer, Junior', 'Orbital Maps', 'Remote', 'written', 69, 'ashby', null],
    ['Software Engineer', 'Quill Analytics', 'Karachi', 'writing', 73, 'greenhouse', null],
    ['Backend Engineer', 'Bramble Commerce', 'Remote', 'selected', 80, 'recruitee', null],
    ['Graduate Software Engineer', 'Harbor Grid', 'Remote', 'selected', 71, 'personio', null],
    ['API Engineer', 'Cobalt Rail', 'Lahore', 'selected', 66, 'teamtailor', null],
    ['DevOps Engineer, Entry Level', 'Juniper Telecom', 'Riyadh', 'failed', 68, 'bamboohr', 'The application page stopped responding (attempt 1 of 3).'],
    ['Senior Backend Engineer', 'Atlas Ledger', 'Remote', 'skipped', 41, 'greenhouse', 'Below the campaign minimum (41 < 60)'],
    ['Security Engineer (clearance)', 'Granite Defense', 'Washington, DC', 'skipped', 35, 'workday', 'Hard blocker: Secret clearance and U.S. citizenship'],
    ['Backend Engineer', 'Tessellate Labs', 'Remote', 'skipped', 78, 'greenhouse', 'Company cooldown: applied to Tessellate Labs recently'],
    ['Data Engineer', 'Pebble Insights', 'Remote', 'scored', 58, 'lever', null],
    ['Backend Engineer, Growth', 'Marigold Media', 'Karachi', 'scored', 63, 'ashby', null],
    ['Cloud Support Engineer', 'Fenwick Systems', 'Remote', 'scored', 55, 'workable', null],
    ['Junior Developer', 'Olive Street Studio', 'Lahore', 'found', null, 'breezy', null],
    ['Software Engineer II', 'Kite Logistics', 'Remote', 'found', null, 'greenhouse', null],
    ['Backend Engineer (Node.js)', 'Sable Finance', 'Dubai', 'found', null, 'lever', null],
  ];
  const grade = (s: number | null) => (s === null ? null : s >= 85 ? 'S' : s >= 78 ? 'A' : s >= 68 ? 'B' : s >= 55 ? 'C' : 'D');
  const ids: Record<string, string> = {};
  JOBS.forEach(([title, company, loc, state, score, ats, err], i) => {
    const id = `demo-${i + 1}`;
    ids[`${company}|${title}|${i}`] = id;
    const found = iso((JOBS.length - i) * 3 * H);
    const slug = company.toLowerCase().replace(/[^a-z]+/g, '');
    run(
      `INSERT INTO jobs (id, fingerprint, source, url, title, company, location, remote, category, description_text, tags, found_at, updated_at, ai_score, ai_grade, ats, apply_url_canonical, legitimacy, sources, stage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'software', ?, '[]', ?, ?, ?, ?, ?, ?, 'ok', ?, ?)`,
      id,
      `fp-${id}`,
      ats,
      `https://jobs.${slug}.example.net/${i + 1}`,
      title,
      company,
      loc,
      loc === 'Remote' ? 1 : 0,
      `${company} is hiring a ${title}. Fictional demo posting.`,
      found,
      found,
      score,
      grade(score),
      ats,
      `https://jobs.${slug}.example.net/${i + 1}/apply`,
      JSON.stringify([ats, 'jobspy']),
      state === 'submitted' ? 'applied' : 'found',
    );
    const steps = PATH[state];
    steps.forEach((s, k) => transition(id, s as never, { campaignId: camp.id, reason: k === steps.length - 1 && err ? err : undefined }));
    if (err) run('UPDATE pipeline SET last_error = ? WHERE job_id = ?', err, id);
    if (state === 'failed') run('UPDATE pipeline SET attempts = 1, next_action_at = ? WHERE job_id = ?', new Date(now + 40 * 60_000).toISOString(), id);
    if (state === 'submitted' || state === 'rehearsed' || state === 'needs_you') {
      const appId = crypto.randomUUID();
      const answersJson = JSON.stringify([
        { label: 'First name', value: 'Ayesha', source: 'profile' },
        { label: 'Email', value: 'ayesha@example.com', source: 'profile' },
        { label: 'Will you require sponsorship?', value: 'No', source: 'answer_bank' },
        { label: 'Why do you want to work here?', value: `I have built ledger-backed APIs in Go and want to do it at ${company}'s scale.`, source: 'writer' },
        { label: 'Resume', value: 'cv.pdf', source: 'file' },
      ]);
      run(
        `INSERT INTO applications (id, job_id, subject, status, channel, sent_at, created_at, updated_at, answers, campaign_id, auto, stage, reason)
         VALUES (?, ?, ?, ?, 'ats', ?, ?, ?, ?, ?, 1, ?, ?)`,
        appId,
        id,
        `${title} application`,
        state === 'submitted' ? 'sent' : state === 'rehearsed' ? 'rehearsed' : 'needs_you',
        state === 'submitted' ? iso((JOBS.length - i) * H) : null,
        found,
        found,
        answersJson,
        camp.id,
        state === 'submitted' && i === 0 ? 'interview' : 'applied',
        err,
      );
      const t = now - (JOBS.length - i) * H;
      recordStep(t - 6 * 60_000, { campaignId: camp.id, jobId: id, step: 'claim', status: 'ok' });
      recordStep(t - 5 * 60_000, { campaignId: camp.id, jobId: id, step: 'write', status: 'done', detail: { applicationId: appId } });
      recordStep(t - 4 * 60_000, { campaignId: camp.id, jobId: id, step: 'route', status: 'form' });
      recordStep(t - 3 * 60_000, { campaignId: camp.id, jobId: id, step: 'fill', status: 'started', detail: { live: state === 'submitted' } });
      recordStep(t - 60_000, { campaignId: camp.id, jobId: id, step: 'outcome', status: state === 'needs_you' ? 'needs_you' : state, detail: { verified: state !== 'needs_you', reason: err ?? 'All 14 fields read back as intended.', via: 'adapter' } });
      recordStep(t, { campaignId: camp.id, jobId: id, step: state === 'needs_you' ? 'release' : (state as 'submitted' | 'rehearsed'), status: 'ok', detail: { applicationId: appId, channel: 'form' } });
      if (state === 'submitted' && i === 0) {
        run(
          `INSERT INTO inbox_messages (id, message_id, from_addr, subject, received_at, class, application_id, data, handled) VALUES (?, ?, ?, ?, ?, 'interview_invite', ?, ?, 0)`,
          crypto.randomUUID(),
          `<demo-${i}@tessellate.example.net>`,
          'talent@tessellate.example.net',
          'Next steps: a call with the backend team',
          iso(3 * H),
          appId,
          JSON.stringify({ summary: 'They would like a 45-minute technical call this week; pick a slot with the link.', deadline: new Date(now + 3 * D).toISOString(), company }),
        );
        run(`INSERT INTO outcomes (application_id, replied, reply_class, days_to_reply, updated_at) VALUES (?, 1, 'interview_invite', 2, ?)`, appId, iso(3 * H));
      }
    }
    if (state === 'skipped') recordStep(now - (JOBS.length - i) * H, { campaignId: camp.id, jobId: id, step: 'skip', status: 'match', detail: { reason: err } });
  });

  // ── Questions a form asked that the answer bank can't cover.
  const questionIds = [
    recordUnknown({ question: 'Do you hold a valid UAE driving licence?', jobId: 'demo-6', fieldKind: 'radio', options: ['Yes', 'No'] }),
    recordUnknown({ question: 'Describe your experience with event-driven systems (Kafka, NATS or similar).', jobId: 'demo-7', fieldKind: 'textarea' }),
    recordUnknown({ question: 'Which shift pattern can you work?', jobId: 'demo-14', fieldKind: 'select', options: ['Day', 'Night', 'Rotating', 'Weekend only'] }),
  ];

  // ── Digests: yesterday's sent one and a final one from an older campaign.
  const c = (await import('../../server/campaign/campaigns.ts')).requireCampaign(camp.id);
  const y = buildDigest(c, now - 2 * H, { sourceHealth: () => [] });
  const yId = saveDigest({ ...y, date: new Date(now - D).toISOString().slice(0, 10) });
  markDigestSent(yId, ['telegram', 'email'], camp.id);
  const t2 = buildDigest(c, now, { sourceHealth: () => [] });
  saveDigest({ ...t2, date: new Date(now - 2 * D).toISOString().slice(0, 10) });

  // ── An external agent key with a little history.
  const key = await createApiKey({ name: 'Muse (browser agent)', scopes: ['jobs:read', 'packets:read', 'answers:read', 'recipes:read', 'applications:write'] });
  writeAudit({ keyId: key.info.id, route: 'GET /api/v1/jobs', status: 200, detail: { count: 3 } });
  writeAudit({ keyId: key.info.id, route: 'POST /api/v1/jobs/:id/claim', status: 200, detail: { jobId: 'demo-11' } });
  writeAudit({ keyId: key.info.id, route: 'POST /api/v1/answers', status: 200, detail: { source: 'answer_bank' } });
  writeAudit({ keyId: null, route: 'GET /api/v1/jobs', status: 401, detail: { error: 'NO_KEY' } });

  // ── Setup is finished, so the wizard doesn't open by itself.
  setSetting('ui.onboarding', { current: 'campaign', completed: ['cv', 'links', 'voice', 'answers', 'learning', 'campaign'], skipped: ['github', 'apikey', 'mailbox', 'telegram'], done: true, updatedAt: new Date().toISOString() });

  const showcase = get<{ job_id: string }>('SELECT job_id FROM pipeline WHERE job_id = ?', F.JOB_ID)?.job_id ?? 'demo-1';
  console.log(`Seeded: campaign ${camp.id}, ${JOBS.length + 1} jobs, writer run ${'skipped' in written.result ? 'skipped' : 'written'}.`);
  return { campaignId: camp.id, questionIds, showcaseJobId: showcase };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1]?.endsWith('seed-demo.ts')) {
  await seedDemo({ live: process.argv.includes('--live') });
  const { db } = await import('../../server/db.ts');
  db.close();
}
