import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Harness } from '../lib/harness.ts';

/**
 * A09 inbox and learning: parsing and code pre-rules on 24 fixture emails,
 * the Haiku classifier on recorded responses, linking accuracy, the whole
 * pipeline (stages, outcomes, alerts with a learning plan, drafted recruiter
 * replies, never a reply), verification codes for the form engine, follow-ups
 * (cap, never after a rejection), learning plans, the weekly gap report and
 * the routes. No mailbox, no network, no mail sent.
 */
export default async function a09Inbox({ check, section }: Harness) {
  const S = await import('../a09/scenario.ts');
  const { all, get, run, getSetting } = await import('../../server/db.ts');
  const { AppError } = await import('../../server/errors.ts');
  const { NotImplemented } = await import('../../server/contracts/stub.ts');
  const { bus } = await import('../../server/services/bus.ts');
  const { LearningPlanSchema, GapReportSchema } = await import('../../server/contracts/learning.ts');
  const { ClassifiedMessageSchema } = await import('../../server/contracts/inbox.ts');
  const { setKillState } = await import('../../server/campaign/kill.ts');
  const { parseEmail } = await import('../../server/inbox/parse.ts');
  const R = await import('../../server/inbox/rules.ts');
  const { classifyEmail, classifierContent } = await import('../../server/inbox/classify.ts');
  const { linkEmail, linkCandidates } = await import('../../server/inbox/link.ts');
  const { setA09Ai } = await import('../../server/inbox/ai.ts');
  const { setInboxDeps } = await import('../../server/inbox/deps.ts');
  const { EmlSource, setMailSourceFactory, testConnection } = await import('../../server/inbox/imap.ts');
  const inbox = await import('../../server/inbox/index.ts');
  const { pollInbox, waitForCode, setCodePollInterval } = inbox;
  const codes = await import('../../server/inbox/codes.ts');
  const { getByMessageId, listMessages } = await import('../../server/inbox/messages.ts');
  const { saveInboxSettings, inboxSettings, mailCursor, saveMailCursor } = await import('../../server/inbox/settings.ts');
  const { followUpCandidates, runFollowUps, hiringContact } = await import('../../server/inbox/followup.ts');
  const { setStageManually, recordSilence } = await import('../../server/inbox/stage.ts');
  const { setPlainSender, sendPlainEmail } = await import('../../server/services/mailer.ts');
  const { setLearningProfileSource } = await import('../../server/learning/profile.ts');
  const L = await import('../../server/learning/index.ts');
  const { planDays } = await import('../../server/learning/plan.ts');
  const { periodRange, isoWeekLabel } = await import('../../server/learning/gaps.ts');
  const { skillsIn, depthOf } = await import('../../server/learning/skills.ts');
  const { addLearning, listLearning } = await import('../../server/profile/learning.ts');
  const { inboxRoutes } = await import('../../server/inbox/routes.ts');
  const { learningRoutes } = await import('../../server/learning/routes.ts');
  type NotifyPayload = import('../../server/notify/index.ts').NotifyPayload;

  const SECRETS = ['482913', 'Xk7Pq2Mz', '905173', '9f2c1e7ab04d4e5f'];
  const read = (f: string) => fs.readFileSync(S.mailFile(f));
  /** The same email under a fresh Message-ID (so the pipeline treats it as new). */
  const fresh = (f: string, tag: string) => Buffer.from(read(f).toString('utf8').replace(/^Message-ID: <([^>]+)>/m, `Message-ID: <$1-${tag}>`));
  const parsed = new Map<string, Awaited<ReturnType<typeof parseEmail>>>();
  for (const f of S.mailFiles()) parsed.set(f, await parseEmail(read(f)));

  // ── Shared fakes ───────────────────────────────────────────────────────────
  let nowMs = Date.parse('2026-11-02T09:41:00Z');
  const notes: { kind: string; payload: NotifyPayload }[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];
  const unknowns: string[] = [];
  let drafter: (appId: string) => Promise<{ subject: string; body: string } | null> = async () => {
    throw new NotImplemented('A04', 'draftFollowUp');
  };
  const busEvents: { type: string }[] = [];
  const onBus = (e: { type: string }) => busEvents.push(e);
  bus.on('event', onBus);
  const restoreDeps = setInboxDeps({
    now: () => nowMs,
    notify: async (kind, payload) => void notes.push({ kind, payload }),
    answerFor: async (q) => (/notice period/i.test(q) ? { value: 'One month', source: 'answer_bank', confidence: 0.97, key: 'ab-notice' } : null),
    recordUnknown: async (q) => {
      unknowns.push(q);
      return `uq-${unknowns.length}`;
    },
    draftFollowUp: (id) => drafter(id),
    sendMail: async (m) => {
      sent.push(m);
      return `<fu-${sent.length}@mail.bureau.example>`;
    },
  });
  const restoreProfile = setLearningProfileSource(async () => S.PROFILE);
  setKillState(null);
  saveInboxSettings({ followUps: { enabled: true, defaultDays: 7, perDay: 3 }, draftReplies: true });
  await S.seed();

  try {
    // ════════════════════════════════════════════════════════════════════════
    section('A09 inbox: parsing and code pre-rules');

    await check(`${S.mailFiles().length} fixture emails parse, each with a Message-ID, a date and text`, () => {
      assert.ok(S.mailFiles().length >= 20);
      for (const [f, e] of parsed) {
        assert.match(e.messageId, /^<.+>$/, f);
        assert.ok(!Number.isNaN(Date.parse(e.receivedAt)), f);
        assert.ok(e.text.length > 20, f);
        assert.ok(S.EXPECTED[f], `no expectation for ${f}`);
      }
      assert.ok(parsed.get('a09-21-verify-otp-html.eml')!.text.includes('905173'), 'HTML-only body converted to text');
      assert.ok(parsed.get('a09-15-other-jobalert.eml')!.bulk, 'List-Unsubscribe → bulk');
      assert.ok(parsed.get('a09-22-other-ooo.eml')!.autoReply, 'Auto-Submitted → auto reply');
      assert.deepEqual(parsed.get('a09-18-interview-goodtime.eml')!.references, ['<gh-confirm-30201@us.greenhouse-mail.io>', '<gh-assess-40112@us.greenhouse-mail.io>']);
    });

    await check('every class in the contract is covered by the fixtures', async () => {
      const { INBOX_CLASSES } = await import('../../server/contracts/inbox.ts');
      for (const c of INBOX_CLASSES) assert.ok(Object.values(S.EXPECTED).includes(c), c);
    });

    await check('pre-rules settle the obvious mail for free, and leave only the ambiguous ones to the model', () => {
      for (const [f, e] of parsed) {
        const v = R.preClassify(e, R.extract(e));
        if (S.MODEL_CASES.includes(f)) assert.equal(v, null, `${f} should go to the model`);
        else assert.equal(v?.class, S.EXPECTED[f], f);
      }
      const ruled = [...parsed.keys()].filter((f) => !S.MODEL_CASES.includes(f)).length;
      assert.ok(ruled / parsed.size >= 0.75, `only ${ruled}/${parsed.size} settled by code`);
    });

    await check('codes are extracted from Workday, Greenhouse and HTML-only mail; years and requisition ids are not codes', () => {
      const code = (f: string) => R.extract(parsed.get(f)!).code;
      assert.equal(code('a09-01-verify-workday.eml'), '482913');
      assert.equal(code('a09-02-verify-greenhouse.eml'), 'Xk7Pq2Mz');
      assert.equal(code('a09-21-verify-otp-html.eml'), '905173');
      assert.equal(code('a09-03-verify-link-ashby.eml'), null);
      assert.deepEqual(R.extract(parsed.get('a09-03-verify-link-ashby.eml')!).verificationLinks, ['https://jobs.ashbyhq.com/tallgrass/verify-email?token=9f2c1e7ab04d4e5f']);
      assert.equal(R.extractCode('Your code is below. Requisition R-10442, posted 2026.'), null);
      assert.equal(R.extractCode('Your verification code: 7F3K-9Q2B'), '7F3K-9Q2B');
    });

    await check('dates, deadlines and scheduling links come from code', () => {
      const x8 = R.extract(parsed.get('a09-08-interview-calendly.eml')!);
      assert.equal(x8.deadline, '2026-11-06');
      assert.deepEqual(x8.dates, ['2026-11-06', '2026-11-09', '2026-11-10']);
      assert.deepEqual(x8.schedulingLinks, ['https://calendly.com/lumenpay-sara/technical-interview']);
      const x9 = R.extract(parsed.get('a09-09-interview-times.eml')!);
      assert.ok(x9.dates.includes('2026-11-12T15:00') && x9.dates.includes('2026-11-13T11:00'));
      assert.equal(x9.deadline, '2026-11-09');
      assert.equal(R.extract(parsed.get('a09-10-assessment-hackerrank.eml')!).deadline, '2026-11-03', '"within 7 days" of 27 Oct');
      assert.equal(R.extract(parsed.get('a09-18-interview-goodtime.eml')!).schedulingLinks.length, 1);
    });

    await check('the prompt-injection email is flagged, and its forged closing tag is neutralised in the prompt', () => {
      const e = parsed.get('a09-17-injection.eml')!;
      assert.ok(R.extract(e).suspicious);
      const content = classifierContent(e);
      assert.equal(content.split('</email_message>').length - 1, 1, 'only our own closing tag survives');
      assert.ok(content.includes('‹/email_message>'));
      assert.ok(!R.extract(parsed.get('a09-08-interview-calendly.eml')!).suspicious);
    });

    // ════════════════════════════════════════════════════════════════════════
    section('A09 inbox: classifier (pre-rules + recorded Haiku)');

    const classified = new Map<string, Awaited<ReturnType<typeof classifyEmail>>>();
    await check('all 24 fixtures get the right class; the model only sees the ambiguous five', async () => {
      const wrong: string[] = [];
      for (const [f, e] of parsed) {
        const c = await classifyEmail(e);
        classified.set(f, c);
        if (c.class !== S.EXPECTED[f]) wrong.push(`${f}: ${c.class}`);
        assert.equal(c.via, S.MODEL_CASES.includes(f) ? 'ai' : 'rules', `${f} via ${c.via} (a stale recording falls back: run scripts/a09/record-fixtures.ts)`);
      }
      assert.deepEqual(wrong, []);
    });

    await check('a kindly worded rejection is still a rejection; recruiter questions are extracted', () => {
      const k = classified.get('a09-07-reject-kind.eml')!;
      assert.equal(k.class, 'rejection');
      assert.ok(k.confidence >= 0.75);
      assert.deepEqual(classified.get('a09-12-recruiter-relocation.eml')!.questions, ['What is your notice period?', 'Are you open to relocating to Berlin?']);
      assert.deepEqual(classified.get('a09-13-recruiter-notice.eml')!.questions, ['What is your notice period?']);
    });

    await check('the injection email is held: class other, suspicious, low confidence, needs review', () => {
      const c = classified.get('a09-17-injection.eml')!;
      assert.equal(c.class, 'other');
      assert.ok(c.suspicious && c.needsReview);
      assert.ok(c.confidence <= 0.5);
    });

    await check('model output is checked: an ungrounded company is dropped, a "verification" with no code is downgraded', async () => {
      const restore = setA09Ai({
        structured: (async () => ({ class: 'verification_code', confidence: 0.99, company: 'Acme Megacorp', role: null, summary: 'x', deadline: '1999-01-01', dates: ['nonsense'], questions: ['q'], injection: false })) as never,
      });
      try {
        const c = await classifyEmail(parsed.get('a09-24-recruiter-agency-salary.eml')!);
        assert.equal(c.class, 'other');
        assert.notEqual(c.company, 'Acme Megacorp');
        assert.equal(c.deadline, null, 'a 1999 deadline is not plausible');
        assert.deepEqual(c.dates, []);
        assert.deepEqual(c.questions, [], 'questions only for recruiter_question');
      } finally {
        restore();
      }
    });

    await check('when the model is unavailable the code guess is used and flagged for review', async () => {
      const restore = setA09Ai({
        structured: (async () => {
          throw new AppError(412, 'NO_API_KEY', 'no key');
        }) as never,
      });
      try {
        const c = await classifyEmail(parsed.get('a09-13-recruiter-notice.eml')!);
        assert.equal(c.via, 'fallback');
        assert.equal(c.class, 'recruiter_question');
        assert.ok(c.needsReview && c.confidence < 0.5);
      } finally {
        restore();
      }
    });

    // ════════════════════════════════════════════════════════════════════════
    section('A09 inbox: linking');

    await check('linking accuracy on the fixtures is 100% (thread, domain, ATS, posting link, name, title)', () => {
      const cands = linkCandidates();
      const misses: string[] = [];
      let n = 0;
      for (const [f, expected] of Object.entries(S.EXPECTED_LINK)) {
        const e = parsed.get(f)!;
        const res = linkEmail(e, classified.get(f)!.class, cands);
        n++;
        const want = expected ? S.appId(expected) : null;
        if (res.applicationId !== want) misses.push(`${f}: got ${res.applicationId} (${res.reasons.join('; ')})`);
      }
      assert.deepEqual(misses, []);
      assert.ok(n >= 19);
    });

    await check('a reply to the email we sent links by thread; a lookalike domain is refused', () => {
      const l8 = linkEmail(parsed.get('a09-08-interview-calendly.eml')!, 'interview_invite');
      assert.deepEqual(l8.reasons, ['same thread']);
      const l17 = linkEmail(parsed.get('a09-17-injection.eml')!, 'other');
      assert.equal(l17.applicationId, null);
      assert.ok(l17.lookalike);
    });

    await check('two applications that look the same are left for the owner, not guessed', () => {
      const base = linkCandidates().find((c) => c.id === S.appId('quillstone'))!;
      const twin = { ...base, id: 'twin' };
      const res = linkEmail(parsed.get('a09-09-interview-times.eml')!, 'interview_invite', [base, twin]);
      assert.equal(res.applicationId, null);
      assert.ok(res.ambiguous);
    });

    // ════════════════════════════════════════════════════════════════════════
    section("A09 inbox: A11's shared corpus (fixtures/mail/index.json)");

    const a11 = S.a11Mail();
    const a11Parsed = new Map<string, Awaited<ReturnType<typeof parseEmail>>>();
    for (const m of a11) a11Parsed.set(m.file, await parseEmail(read(m.file)));

    await check(`all ${a11.length} labelled emails get their label; the model only sees the ${S.A11_MODEL_CASES.length} the rules leave open`, async () => {
      const wrong: string[] = [];
      for (const m of a11) {
        const c = await classifyEmail(a11Parsed.get(m.file)!);
        if (c.class !== m.class) wrong.push(`${m.file}: ${c.class} (want ${m.class})`);
        assert.equal(c.via, S.A11_MODEL_CASES.includes(m.file) ? 'ai' : 'rules', `${m.file} via ${c.via}`);
      }
      assert.deepEqual(wrong, []);
    });

    await check('codes match the labels; the lookalike Workday phish is suspicious and yields nothing for the form engine', () => {
      for (const m of a11.filter((x) => x.class === 'verification_code')) {
        const x = R.extract(a11Parsed.get(m.file)!);
        assert.equal(x.code, m.code, m.file);
      }
      const phish = R.extract(a11Parsed.get('other-phishing-lookalike-workday.eml')!);
      assert.ok(phish.suspicious, 'lookalike sender and link');
      assert.deepEqual(phish.verificationLinks, [], 'http link on a lookalike host is not a verification link');
      assert.ok(R.extract(a11Parsed.get('reject-prompt-injection-pebble-analytics.eml')!).suspicious);
      assert.ok(!R.extract(a11Parsed.get('confirm-greenhouse-lumen-ledger.eml')!).suspicious);
    });

    await check('linking on the shared corpus: every hinted email finds its application, unhinted ones stay unlinked', () => {
      const hints = [...new Set(a11.map((m) => m.applicationHint).filter((h): h is string => !!h))];
      const cands = hints.map((h, i) => {
        const [company, rest] = h.split(' — ');
        const title = rest.replace(/\s*\([^)]*\)\s*$/, '');
        return {
          id: `a11-app-${i}`,
          jobId: `a11-job-${i}`,
          stage: 'applied',
          status: 'sent',
          sentAt: '2026-10-10T00:00:00.000Z',
          createdAt: '2026-10-10T00:00:00.000Z',
          title,
          company,
          jobUrl: `https://${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.example.com/careers/${i}`,
          applyUrl: null,
          ats: null,
          applyEmail: null,
          toEmail: null,
          companyDomain: null,
          campaignId: null,
          hint: h,
        };
      });
      const misses: string[] = [];
      for (const m of a11.filter((x) => x.class !== 'verification_code')) {
        const res = linkEmail(a11Parsed.get(m.file)!, m.class as never, cands);
        const want = m.applicationHint ? cands.find((c) => c.hint === m.applicationHint)!.id : null;
        if (res.applicationId !== want) misses.push(`${m.file}: ${res.applicationId} (${res.reasons.join('; ')})`);
      }
      assert.deepEqual(misses, []);
    });

    await check('ingestRaw: 1 for new mail, 0 when seen; it feeds a waiting waitForCode; imapSettings() never shows the password', async () => {
      nowMs = Date.parse('2026-10-30T11:43:00Z');
      const wd = Buffer.from(read('verify-atlas-mutual-workday.eml').toString('utf8').replace(/^Message-ID: <([^>]+)>/im, 'Message-ID: <$1-ingest>'));
      const waiting = waitForCode('atlasmutual.wd1.myworkdayjobs.com', 2_000);
      assert.equal(await inbox.ingestRaw(wd), 1);
      assert.equal(await inbox.ingestRaw(wd), 0);
      assert.equal(await waiting, '482913', 'the waiter got the code from ingestRaw');
      const s = JSON.stringify(inbox.imapSettings());
      assert.ok(!/"pass(word)?":\s*"[^"]+"/i.test(s));
      assert.equal(typeof inbox.imapSettings().passwordSet, 'boolean');
      codes.clearCodes();
    });

    // ════════════════════════════════════════════════════════════════════════
    section('A09 inbox: verification codes for the form engine');

    let codeSrc = new EmlSource([], 'codes-1');
    setMailSourceFactory(async () => codeSrc);
    setCodePollInterval(20);

    await check('waitForCode resolves with a Workday code that arrives while it waits', async () => {
      nowMs = Date.parse('2026-11-02T09:15:00Z');
      const p = waitForCode('bluefin.wd5.myworkdayjobs.com', 5_000);
      await new Promise((r) => setTimeout(r, 60));
      codeSrc.add(fresh('a09-01-verify-workday.eml', 'w1'));
      const t0 = Date.now();
      assert.equal(await p, '482913');
      assert.ok(Date.now() - t0 < 2_000);
    });

    await check('a Greenhouse code is matched to the board by company; the Ashby magic link is returned as a link', async () => {
      nowMs = Date.parse('2026-11-02T09:31:30Z');
      codeSrc.add(fresh('a09-02-verify-greenhouse.eml', 'g1'));
      codeSrc.add(fresh('a09-03-verify-link-ashby.eml', 'a1'));
      assert.equal(await waitForCode('https://boards.greenhouse.io/northwindlabs/jobs/4411002', 3_000), 'Xk7Pq2Mz');
      assert.equal(await waitForCode('jobs.ashbyhq.com/tallgrass', 3_000), 'https://jobs.ashbyhq.com/tallgrass/verify-email?token=9f2c1e7ab04d4e5f');
    });

    await check('a code is handed out once, never to another tenant, and times out to null', async () => {
      nowMs = Date.parse('2026-11-02T09:15:10Z');
      codeSrc.add(fresh('a09-01-verify-workday.eml', 'w2'));
      assert.equal(await waitForCode('acme.wd1.myworkdayjobs.com', 250), null, 'another Workday tenant');
      assert.equal(await waitForCode('bluefin.wd5.myworkdayjobs.com', 250), '482913');
      assert.equal(await waitForCode('bluefin.wd5.myworkdayjobs.com', 150), null, 'already used');
    });

    await check('codes expire from memory after 15 minutes', () => {
      nowMs = Date.parse('2026-11-02T10:00:00Z');
      codes.holdCode({ value: '111222', kind: 'code', senderHost: 'careers-noreply@harborhealth.example.com'.split('@')[1], links: [], company: 'Harbor Health' });
      nowMs += 16 * 60_000;
      assert.equal(codes.takeCode('harborhealth.example.com', nowMs - 60_000), null);
      assert.equal(codes.heldCount(), 0);
    });

    await check('codes and magic links never reach the database, the event log or the bus', () => {
      const blob = JSON.stringify([all('SELECT * FROM inbox_messages'), all('SELECT * FROM events'), all('SELECT * FROM settings'), busEvents]);
      for (const s of SECRETS) assert.ok(!blob.includes(s), `${s} leaked`);
      const row = getByMessageId('<wd-verify-7731@myworkday.com-w1>')!;
      assert.equal(row.class, 'verification_code');
      assert.equal(row.code, null);
      assert.equal(row.preview, null);
      assert.deepEqual(row.links, []);
    });

    codes.clearCodes();
    setCodePollInterval(null);

    // ════════════════════════════════════════════════════════════════════════
    section('A09 inbox: the pipeline (24 emails through pollInbox)');

    const bulk = EmlSource.fromDir(S.A09_MAIL_DIR, (f) => f.startsWith('a09-'));
    bulk.uidValidity = 'bulk-1';
    setMailSourceFactory(async () => bulk);
    nowMs = Date.parse('2026-11-02T09:41:00Z');
    notes.length = 0;
    busEvents.length = 0;
    const firstPoll = await pollInbox();
    const row = (f: string) => getByMessageId(parsed.get(f)!.messageId)!;
    const stage = (k: string) => get<{ stage: string }>('SELECT stage FROM applications WHERE id = ?', S.appId(k))!.stage;

    await check('every message is stored with the right class and application, and the cursor advances', () => {
      assert.ok(firstPoll >= 20, `handled ${firstPoll}`);
      for (const f of S.mailFiles()) {
        const r = row(f);
        assert.ok(r, `${f} not stored`);
        assert.equal(r.class, S.EXPECTED[f], f);
        if (f in S.EXPECTED_LINK) assert.equal(r.applicationId, S.EXPECTED_LINK[f] ? S.appId(S.EXPECTED_LINK[f]!) : null, f);
        assert.ok(r.handled, `${f} effects not finished`);
        ClassifiedMessageSchema.parse(r);
      }
      assert.deepEqual(mailCursor(), { uidValidity: 'bulk-1', lastUid: 24 });
    });

    await check('polling is idempotent: nothing new on a second poll, a re-delivered copy, or a rebuilt folder', async () => {
      const before = (get<{ n: number }>('SELECT COUNT(*) AS n FROM inbox_messages')!).n;
      assert.equal(await pollInbox(), 0);
      bulk.add(read('a09-14-offer.eml'));
      assert.equal(await pollInbox(), 0);
      bulk.uidValidity = 'bulk-2';
      assert.equal(await pollInbox(), 0);
      assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM inbox_messages')!.n, before);
      assert.equal(mailCursor()?.uidValidity, 'bulk-2');
    });

    await check('replies move application stages (forward only) and the v1 job stage follows', () => {
      assert.equal(stage('northwind'), 'interview');
      assert.equal(stage('bluefin'), 'screening');
      assert.equal(stage('lumen'), 'offer');
      assert.equal(stage('corvid'), 'rejected');
      assert.equal(stage('tallgrass'), 'screening');
      assert.equal(stage('quillstone'), 'interview');
      assert.equal(stage('harbor'), 'rejected');
      assert.equal(stage('mosaic'), 'screening');
      assert.equal(stage('ferro'), 'rejected');
      assert.equal(get<{ stage: string }>('SELECT stage FROM jobs WHERE id = ?', S.jobId('lumen'))!.stage, 'offer');
      assert.equal(get<{ stage: string }>('SELECT stage FROM jobs WHERE id = ?', S.jobId('corvid'))!.stage, 'rejected');
    });

    await check('outcomes feed the bandit: replied, the furthest reply class, days to the first reply', () => {
      const o = (k: string) => get<{ replied: number; reply_class: string; days_to_reply: number }>('SELECT * FROM outcomes WHERE application_id = ?', S.appId(k));
      assert.deepEqual({ ...o('lumen') }, { ...o('lumen'), replied: 1, reply_class: 'offer', days_to_reply: 11 });
      assert.equal(o('northwind')!.reply_class, 'interview_invite');
      assert.equal(o('northwind')!.days_to_reply, 6.9, 'the assessment came first');
      assert.equal(o('corvid')!.reply_class, 'rejection');
      assert.equal(o('mosaic')!.reply_class, 'recruiter_question');
      assert.ok(busEvents.some((e) => e.type === 'application.outcome'));
    });

    await check('interviews, assessments and offers alert at once; the Lumen Pay alert links its learning plan', () => {
      const alerts = notes.filter((n) => n.kind === 'alert');
      assert.equal(alerts.length, 7, alerts.map((a) => a.payload.title).join(' | '));
      const lumen = alerts.find((a) => a.payload.title === 'Interview invite: Lumen Pay, Go Backend Developer')!;
      assert.ok(lumen, 'Lumen Pay interview alert');
      assert.match(lumen.payload.body, /Booking link: https:\/\/calendly\.com\/lumenpay-sara\/technical-interview/);
      assert.match(lumen.payload.body, /Deadline: 2026-11-06/);
      assert.match(lumen.payload.body, /Learning plan: 7 days, focus Kafka/);
      assert.match(lumen.payload.url ?? '', /\/learning\/plans\/[0-9a-f-]{36}$/);
      assert.ok(alerts.some((a) => a.payload.title.startsWith('Offer: Lumen Pay')));
      assert.ok(alerts.some((a) => a.payload.title.startsWith('Assessment: Northwind Labs')));
      const ev = busEvents.filter((e) => e.type === 'alert.interview') as unknown as { company: string; kind: string; planId: string | null; deadline: string | null }[];
      const lumenEv = ev.find((e) => e.company === 'Lumen Pay' && e.kind === 'interview_invite')!;
      assert.ok(lumenEv.planId && L.getPlan(lumenEv.planId)?.plan.days.length === 7);
      assert.equal(ev.find((e) => e.kind === 'offer')!.planId, null, 'no crash plan for an offer');
    });

    await check('interview times keep their zone: a UTC instant next to the words as written, shown in the owner’s time zone', async () => {
      const { showTime, ownerTimeZone } = await import('../../server/inbox/when.ts');
      const r = row('a09-09-interview-times.eml');
      assert.equal(r.interviewDate, '2026-11-12T15:00', 'the wall time as written is kept (the learning plan reads it)');
      assert.deepEqual(r.interviewAt, { local: '2026-11-12T15:00', at: '2026-11-12T10:00:00.000Z', zone: 'PKT', text: 'November 12, 2026 at 3:00 PM PKT' });
      assert.deepEqual(r.times.map((t) => t.at), ['2026-11-12T10:00:00.000Z', '2026-11-13T06:00:00.000Z']);
      const tz = ownerTimeZone(r.applicationId);
      const alert = notes.find((n) => n.kind === 'alert' && n.payload.title.startsWith('Interview invite: Quillstone'))!;
      assert.ok(alert.payload.body.includes(`Likely date: ${showTime(r.interviewDate!, r.interviewAt, tz)}`), alert.payload.body);
      assert.equal(showTime(r.interviewDate!, r.interviewAt, 'Europe/London'), 'Thu 12 Nov, 10:00 Europe/London (written as PKT)');
      // Daylight saving follows the date for a generic zone; a time with no zone is never guessed.
      const ref = new Date('2026-06-01T00:00:00Z');
      assert.equal(R.findDates('Can you do July 7, 2026 at 9am ET?', ref)[0].time?.at, '2026-07-07T13:00:00.000Z');
      assert.equal(R.findDates('Can you do December 7, 2026 at 9am ET?', ref)[0].time?.at, '2026-12-07T14:00:00.000Z');
      assert.equal(R.findDates('Or 16 November 2026 at 10:00 (GMT+05:30)?', ref)[0].time?.at, '2026-11-16T04:30:00.000Z');
      const bare = R.findDates('Could you do November 12, 2026 at 3 PM to talk?', ref)[0].time!;
      assert.equal(bare.at, null);
      assert.equal(showTime(bare.local, bare, 'Asia/Karachi'), '2026-11-12 15:00 (time zone not stated)');
    });

    await check('Bureau never replies: no mail sent, recruiter answers are drafted for the owner only', () => {
      assert.equal(sent.length, 0);
      const b = row('a09-13-recruiter-notice.eml');
      assert.equal(b.draft?.status, 'queued');
      assert.equal(b.draft?.to, 'hannah.cole@bluefin.example.org');
      assert.match(b.draft!.body, /^Hi Hannah,/);
      assert.match(b.draft!.body, /One month/);
      const m = row('a09-12-recruiter-relocation.eml');
      assert.equal(m.draft, null, 'relocation is not in the answer bank: no partial draft');
      assert.deepEqual(m.unanswered, ['Are you open to relocating to Berlin?']);
      assert.ok(unknowns.includes('Are you open to relocating to Berlin?'));
      assert.ok(notes.some((n) => n.kind === 'info' && n.payload.title.startsWith('Recruiter question: Bluefin Analytics')));
    });

    await check('the injection email changes nothing and is reported to the owner as suspicious', () => {
      const r = row('a09-17-injection.eml');
      assert.ok(r.suspicious && r.applicationId === null && r.stage === null);
      assert.ok(notes.some((n) => n.kind === 'info' && n.payload.title.startsWith('Suspicious email held')));
      assert.ok(!notes.some((n) => n.kind === 'alert' && /corvid/i.test(n.payload.title)));
    });

    await check('the digest gets what it reads: company, summary and deadline in data; unlinked mail is listed', () => {
      const raw = get<{ data: string }>('SELECT data FROM inbox_messages WHERE message_id = ?', parsed.get('a09-14-offer.eml')!.messageId)!;
      const d = JSON.parse(raw.data) as { company: string; summary: string; deadline: string };
      assert.equal(d.company, 'Lumen Pay');
      assert.equal(d.deadline, '2026-11-20');
      assert.ok(d.summary.length > 10);
      assert.ok(listMessages({ unlinked: true }).items.some((m) => m.messageId === parsed.get('a09-24-recruiter-agency-salary.eml')!.messageId));
      assert.equal(listMessages({ class: ['interview_invite'] }).total >= 4, true);
    });

    await check('the first Lumen Pay plan was the recorded model plan (not the fallback)', () => {
      const id = row('a09-08-interview-calendly.eml').planId!;
      assert.equal(L.getPlan(id)?.via, 'ai');
    });

    // ════════════════════════════════════════════════════════════════════════
    section('A09 inbox: follow-ups');

    const FU_SENT = '2026-10-20T09:00:00.000Z';
    const mkFu = (key: string, opts: { email?: string | null; inPosting?: boolean; stage?: string } = {}) => {
      const email = opts.email === undefined ? `hiring@${key}.example.com` : opts.email;
      const desc = `${key} is hiring a backend engineer.${email && opts.inPosting !== false ? ` Questions? Write to ${email}.` : ''}`;
      run(
        `INSERT OR REPLACE INTO jobs (id, fingerprint, source, url, title, company, category, description_text, apply_email, found_at, updated_at, stage)
         VALUES (?, ?, 'a09-fixture', ?, 'Backend Engineer', ?, 'software', ?, ?, ?, ?, 'applied')`,
        `a09-fujob-${key}`,
        `a09-fufp-${key}`,
        `https://${key}.example.com/careers/backend`,
        `${key[0].toUpperCase()}${key.slice(1)} Ltd`,
        desc,
        email,
        FU_SENT,
        FU_SENT,
      );
      run(
        `INSERT OR REPLACE INTO applications (id, job_id, status, channel, sent_at, stage, created_at, updated_at) VALUES (?, ?, 'sent', 'ats', ?, ?, ?, ?)`,
        `a09-fu-${key}`,
        `a09-fujob-${key}`,
        FU_SENT,
        opts.stage ?? 'applied',
        FU_SENT,
        FU_SENT,
      );
      return `a09-fu-${key}`;
    };
    const fu1 = mkFu('pinecone');
    const fu2 = mkFu('cedar');
    const fu3 = mkFu('larkspur');
    const fuRej = mkFu('rejectco', { stage: 'rejected' });
    const fuNone = mkFu('nocontact', { email: null });
    const fuHidden = mkFu('hiddenco', { inPosting: false });
    const fuRobot = mkFu('robotco', { email: 'no-reply@robotco.example.com' });
    nowMs = Date.parse('2026-11-02T12:00:00Z');
    saveInboxSettings({ followUps: { enabled: true, defaultDays: 7, perDay: 2 } });
    const ours = (list: { to: string }[]) => list.filter((m) => /pinecone|cedar|larkspur|rejectco|nocontact|hiddenco|robotco/.test(m.to));

    await check('only addresses published in the posting count as hiring contacts, never no-reply robots', () => {
      assert.equal(hiringContact({ toEmail: null, applyEmail: 'jobs@a.example.com', description: 'mail jobs@a.example.com', jobUrl: 'https://a.example.com', companyDomain: null }), 'jobs@a.example.com');
      assert.equal(hiringContact({ toEmail: null, applyEmail: 'jobs@a.example.com', description: 'apply on our site', jobUrl: 'https://a.example.com', companyDomain: null }), null);
      assert.equal(hiringContact({ toEmail: null, applyEmail: 'no-reply@a.example.com', description: 'no-reply@a.example.com', jobUrl: 'https://a.example.com', companyDomain: null }), null);
      const c = followUpCandidates().filter((x) => x.applicationId.startsWith('a09-fu-'));
      const why = Object.fromEntries(c.map((x) => [x.applicationId, x.blocked]));
      assert.equal(why[fu1], null);
      assert.equal(why[fuRej], 'rejected');
      assert.equal(why[fuNone], 'no published hiring contact');
      assert.equal(why[fuHidden], 'no published hiring contact');
      assert.equal(why[fuRobot], 'no published hiring contact');
    });

    await check('no draft from A04 yet means no follow-up today (and nothing sent)', async () => {
      const r = await runFollowUps();
      assert.ok(r.writerUnavailable);
      assert.equal(r.sent, 0);
      assert.equal(sent.length, 0);
    });

    drafter = async (id) => ({ subject: 'Following up on my application', body: `Hello, I wanted to follow up on my application (${id}). Thank you for your time.` });

    await check('follow-ups respect the daily cap and go only to published contacts', async () => {
      const r = await runFollowUps();
      assert.equal(r.sent, 2);
      assert.ok(r.capReached);
      assert.equal(ours(sent).length, 2);
      assert.ok(ours(sent).every((m) => /^hiring@(pinecone|cedar|larkspur)\.example\.com$/.test(m.to)));
      assert.equal((await runFollowUps()).sent, 0, 'cap already used today');
      const row1 = get<{ status: string; message_id: string }>('SELECT status, message_id FROM inbox_followups WHERE application_id = ?', fu1)!;
      assert.equal(row1.status, 'sent');
      assert.match(row1.message_id, /^<fu-\d+@mail\.bureau\.example>$/);
    });

    await check('the next day the rest go out, each application gets exactly one, never after a rejection', async () => {
      nowMs += 86_400_000;
      await runFollowUps();
      await runFollowUps();
      const to = ours(sent).map((m) => m.to);
      assert.equal(to.length, 3);
      assert.equal(new Set(to).size, 3, 'one per application');
      assert.ok(!to.some((t) => /rejectco|nocontact|hiddenco|robotco/.test(t)));
      void fu2;
      void fu3;
    });

    await check('a rejection that lands before the follow-up blocks it; a journaled intent is never re-sent', async () => {
      const late = mkFu('latecomer');
      const intent = mkFu('crashco');
      run("INSERT INTO inbox_followups (application_id, status, to_addr, attempts, created_at) VALUES (?, 'intent', 'hiring@crashco.example.com', 1, ?)", intent, '2026-10-30T00:00:00.000Z');
      setStageManually(late, 'rejected');
      nowMs += 86_400_000;
      const before = sent.length;
      await runFollowUps();
      assert.equal(sent.length, before);
    });

    await check('the kill switch stops follow-ups; offline mode never sends real mail', async () => {
      mkFu('killco');
      setKillState({ at: new Date().toISOString(), reason: 'test', source: 'system' });
      try {
        const before = sent.length;
        await runFollowUps({ force: true });
        assert.equal(sent.length, before);
      } finally {
        setKillState(null);
      }
      setPlainSender(null);
      await assert.rejects(() => sendPlainEmail({ to: 'someone@example.com', subject: 'x', text: 'y' }), /offline/i);
    });

    await check('silence is an outcome too: old applications with no reply get replied = 0', () => {
      run("INSERT OR REPLACE INTO jobs (id, fingerprint, source, url, title, company, category, found_at, updated_at) VALUES ('a09-silent-job', 'a09-silent-fp', 'a09-fixture', 'https://silent.example.com', 'Dev', 'Silentco', 'software', ?, ?)", FU_SENT, FU_SENT);
      run("INSERT OR REPLACE INTO applications (id, job_id, status, sent_at, created_at, updated_at) VALUES ('a09-silent', 'a09-silent-job', 'sent', '2026-09-01T00:00:00.000Z', ?, ?)", FU_SENT, FU_SENT);
      recordSilence(21, Date.parse('2026-11-02T00:00:00Z'));
      assert.equal(get<{ replied: number }>("SELECT replied FROM outcomes WHERE application_id = 'a09-silent'")!.replied, 0);
      assert.equal(get<{ replied: number }>('SELECT replied FROM outcomes WHERE application_id = ?', S.appId('lumen'))!.replied, 1, 'a reply is never overwritten');
    });

    // ════════════════════════════════════════════════════════════════════════
    section('A09 learning: crash plans');

    await check('a learning plan is generated from the recorded response, checked and stored', async () => {
      const { id, plan } = await L.buildLearningPlan(S.appId('lumen'), S.LUMEN_PLAN.interviewDate, { startAt: S.LUMEN_PLAN.startAt, force: true });
      LearningPlanSchema.parse(plan);
      assert.equal(plan.days.length, 7);
      assert.deepEqual(plan.gaps, [
        'Kafka or another event streaming platform in production',
        'Kubernetes basics for deploying services',
        'gRPC service design',
        'Observability with Prometheus and OpenTelemetry',
      ]);
      const urls = plan.days.flatMap((d) => d.resources.map((r) => r.url));
      assert.ok(urls.every((u) => u.startsWith('https://')), 'http dropped');
      assert.ok(!urls.some((u) => u.includes('udemy.com')), 'paywalled dropped');
      assert.ok(plan.days.every((d) => d.resources.every((r) => r.free)));
      assert.ok(plan.days.some((d) => d.miniProject?.includes('ledger-events')));
      assert.ok(plan.likelyQuestions.length >= 8 && plan.talkingPoints.length >= 4);
      assert.equal(L.getPlan(id)?.plan.company, 'Lumen Pay');
      const again = await L.buildLearningPlan(S.appId('lumen'), S.LUMEN_PLAN.interviewDate);
      assert.equal(again.id, id, 'a recent plan for the same date is reused');
    });

    await check('without the model a plan is still built from code (one gap a day, official docs, review day)', async () => {
      const restore = setA09Ai({ structured: (async () => { throw new AppError(402, 'BUDGET', 'budget'); }) as never });
      try {
        const { id, plan } = await L.buildLearningPlan(S.appId('lumen'), '2026-11-05', { startAt: '2026-11-02T00:00:00Z', force: true });
        assert.equal(plan.days.length, 3);
        assert.equal(plan.days.at(-1)!.focus, 'Review and mock interview');
        assert.equal(plan.days[0].resources[0]?.url, 'https://kafka.apache.org/quickstart');
        assert.equal(L.getPlan(id)?.via, 'fallback');
      } finally {
        restore();
      }
    });

    await check('plan length follows the interview date (1–14 days, default when unknown)', () => {
      assert.equal(planDays('2026-11-02T10:00:00Z', '2026-11-09', 5), 7);
      assert.equal(planDays('2026-11-02T10:00:00Z', '2026-11-02', 5), 1);
      assert.equal(planDays('2026-11-02T10:00:00Z', '2027-03-01', 5), 14);
      assert.equal(planDays('2026-11-02T10:00:00Z', null, 5), 5);
    });

    // ════════════════════════════════════════════════════════════════════════
    section('A09 learning: weekly gap report');

    await check('skills are counted by code from requirement text', () => {
      assert.deepEqual(skillsIn('3+ years with Kafka in production'), ['Kafka']);
      assert.deepEqual(skillsIn('Kubernetes and Helm'), ['Kubernetes']);
      assert.ok(skillsIn('Production experience with Go').includes('Go'));
      assert.ok(!skillsIn('go above and beyond for the rest of the team').includes('Go'));
      assert.ok(!skillsIn('the rest of the team').includes('REST APIs'));
      assert.equal(depthOf('3+ years with Kafka'), '3+ years');
      assert.equal(isoWeekLabel(Date.parse('2026-11-02T08:00:00Z')), '2026-W45');
      assert.equal(periodRange('2026-W40').from, '2026-09-28T00:00:00.000Z');
    });

    await check('the gap report merges, ranks by weight, ignores invented ids and non-skills, and is stored for the digest', async () => {
      const { id, report } = await L.buildGapReport(S.GAP_PERIOD);
      GapReportSchema.parse(report);
      assert.equal(report.jobsConsidered, 5);
      const names = report.skills.map((s) => s.skill);
      assert.deepEqual(names.slice(0, 2), ['Kafka', 'Kubernetes']);
      const kafka = report.skills[0];
      assert.equal(kafka.count, 3, 'Kafka (2 jobs) merged with "an event streaming platform" (1 job)');
      assert.equal(kafka.weighted, 2.62);
      assert.ok(!names.includes('Blockchain'), 'made-up id ignored');
      assert.ok(!names.some((n) => /communication|degree|years/i.test(n)));
      assert.ok(report.skills.every((s) => s.suggestedProject.length > 20));
      const stored = get<{ report: string }>('SELECT report FROM gap_reports WHERE id = ?', id)!;
      assert.equal((JSON.parse(stored.report) as { skills: { skill: string; count: number }[] }).skills[0].count, 3, 'shape A08 digest reads');
      await L.buildGapReport(S.GAP_PERIOD);
      assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM gap_reports WHERE period = ?', S.GAP_PERIOD)!.n, 1, 'a rebuild replaces the period');
    });

    await check('auto-queue is off by default; when on, the top 3 are queued and nothing being learned is demoted', async () => {
      const before = listLearning().length;
      await L.buildGapReport(S.GAP_PERIOD);
      assert.equal(listLearning().length, before);
      addLearning({ skill: 'Kubernetes', status: 'learning' });
      L.saveLearningSettings({ autoQueueTopGaps: true });
      try {
        await L.buildGapReport(S.GAP_PERIOD);
        const items = listLearning();
        assert.equal(items.find((i) => i.skill === 'Kubernetes')?.status, 'learning');
        assert.equal(items.find((i) => i.skill === 'Kafka')?.status, 'queued');
        assert.ok(items.some((i) => i.skill === 'gRPC' || i.skill === 'Terraform' || i.skill === 'AWS'));
      } finally {
        L.saveLearningSettings({ autoQueueTopGaps: false });
      }
    });

    await check('Telegram /learning marks a skill as learning (adds it when new)', async () => {
      assert.match(await L.learningCommand('Terraform'), /Marked Terraform as learning/);
      assert.equal(listLearning().find((i) => i.skill === 'Terraform')?.status, 'learning');
      assert.match(await L.learningCommand(''), /Learning: .*Terraform/);
    });

    // ════════════════════════════════════════════════════════════════════════
    section('A09 routes and mailbox settings');

    const { default: Fastify } = await import('fastify');
    const app = Fastify();
    app.setErrorHandler((err: Error, _req, reply) => {
      if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message });
      return reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: 'X', message: err.message });
    });
    await app.register(inboxRoutes);
    await app.register(learningRoutes);
    const inject = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
      const r = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
      return { status: r.statusCode, json: r.json() as Record<string, unknown>, raw: r.body };
    };

    await check('mailbox settings: the app password goes to the vault and never comes back out', async () => {
      const put = await inject('PUT', '/api/inbox/settings', { host: 'imap.example.com', user: 'ayesha.jobs@example.com', password: 'app-pass-1234-5678', enabled: false });
      assert.equal(put.status, 200);
      const got = await inject('GET', '/api/inbox/settings');
      assert.ok(!got.raw.includes('app-pass-1234-5678'));
      assert.equal((got.json.settings as { password: { set: boolean } }).password.set, true);
      assert.equal((await inject('PUT', '/api/inbox/settings', { host: 'not a host!' })).status, 400);
      assert.ok(!JSON.stringify(all('SELECT * FROM settings')).includes('app-pass-1234-5678'));
      assert.equal(inboxSettings().host, 'imap.example.com');
    });

    await check('test-connection reports folders and counts, and maps auth failures to a plain message (fake IMAP)', async () => {
      const fake = { list: async () => [{ path: 'INBOX' }, { path: 'Jobs' }], status: async () => ({ messages: 42 }), logout: async () => {}, close: () => {} };
      const ok = await testConnection(inboxSettings(), 'pw', async () => fake as never);
      assert.ok(ok.ok);
      assert.equal(ok.messages, 42);
      assert.deepEqual(ok.folders, ['INBOX', 'Jobs']);
      const bad = await testConnection(inboxSettings(), 'pw', async () => {
        throw Object.assign(new Error('AUTHENTICATIONFAILED pw=secret'), { authenticationFailed: true });
      });
      assert.equal(bad.ok, false);
      assert.equal(bad.message, 'The mail server rejected the username or app password.');
      assert.equal((await testConnection(inboxSettings(), null)).ok, false);
      const viaRoute = await inject('POST', '/api/inbox/test', {});
      assert.equal(viaRoute.status, 503, 'offline mode never dials a real server');
    });

    await check('inbox routes: list and filter, owner corrections, drafts, follow-ups, manual stage', async () => {
      const list = await inject('GET', '/api/inbox/messages?class=interview_invite,assessment&limit=50');
      assert.equal(list.status, 200);
      assert.ok((list.json.items as { class: string }[]).every((m) => ['interview_invite', 'assessment'].includes(m.class)));
      assert.equal((await inject('GET', '/api/inbox/messages?class=bogus')).status, 400);
      const agency = getByMessageId(parsed.get('a09-24-recruiter-agency-salary.eml')!.messageId)!;
      const fix = await inject('PUT', `/api/inbox/messages/${agency.id}`, { applicationId: S.appId('lumen') });
      assert.equal((fix.json.message as { via: string; company: string }).via, 'owner');
      assert.equal((fix.json.message as { company: string }).company, 'Lumen Pay');
      const drafts = await inject('GET', '/api/inbox/drafts');
      const bluefin = (drafts.json.items as { id: string; subject: string }[]).find((m) => m.subject.startsWith('Quick question'))!;
      assert.ok(bluefin);
      assert.equal((await inject('POST', `/api/inbox/drafts/${bluefin.id}/done`)).status, 200);
      const fus = await inject('GET', '/api/inbox/followups');
      assert.ok((fus.json.log as unknown[]).length >= 3);
      const st = await inject('PUT', `/api/inbox/stage/${S.appId('mosaic')}`, { stage: 'interview' });
      assert.equal((st.json as { to: string }).to, 'interview');
      const status = await inject('GET', '/api/inbox/status');
      assert.equal(status.status, 200);
      assert.ok(!status.raw.includes('482913'));
    });

    await check('learning routes: plans, gap reports, settings and learning-list status changes', async () => {
      const plans = await inject('GET', `/api/learning/plans?applicationId=${S.appId('lumen')}`);
      const first = (plans.json.items as { id: string }[])[0];
      assert.equal((await inject('GET', `/api/learning/plans/${first.id}`)).status, 200);
      assert.equal((await inject('GET', '/api/learning/plans/nope')).status, 404);
      assert.equal((await inject('POST', '/api/learning/plans', { applicationId: 'nope' })).status, 404);
      const latest = await inject('GET', '/api/learning/gaps/latest');
      assert.equal(((latest.json.report as { period: string }) ?? { period: '' }).period.length > 0, true);
      const q = await inject('POST', '/api/learning/list/queue', { skill: 'Kubernetes' });
      assert.equal(q.json.added, false, 'already on the list: not demoted');
      run("DELETE FROM learning_list WHERE lower(skill) = 'zig'");
      const added = await inject('POST', '/api/learning/list/queue', { skill: 'Zig' });
      assert.equal((added.json.item as { status: string }).status, 'queued');
      const rid = (added.json.item as { id: string }).id;
      assert.equal(((await inject('PUT', `/api/learning/list/${rid}/status`, { status: 'learning' })).json.item as { status: string }).status, 'learning');
      assert.equal((await inject('PUT', '/api/learning/settings', { defaultPlanDays: 4 })).status, 200);
      assert.equal(L.learningSettings().defaultPlanDays, 4);
      L.saveLearningSettings({ defaultPlanDays: 5 });
    });

    await app.close();
    void getSetting;
    void saveMailCursor;
  } finally {
    restoreDeps();
    restoreProfile();
    setMailSourceFactory(null);
    setCodePollInterval(null);
    codes.clearCodes();
    bus.off('event', onBus);
  }
}
