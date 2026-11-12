import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Harness } from '../lib/harness.ts';

/**
 * A04: the writer. Lint rules one by one, the truth lock's catches, the
 * humanizer's span-only edits, the critic's score rules, the full pipeline on
 * the recorded fixture job (replayed through the real structured()), the gates
 * rejecting bad letters end to end, the CV PDF round trip, answers, follow-up,
 * the bandit on synthetic outcomes, the routes and the quality report.
 */
export default async function a04({ check, section }: Harness) {
  const { all, get, run } = await import('../../server/db.ts');
  const { AppError } = await import('../../server/errors.ts');
  const F = await import('../../server/writer/fixtures.ts');
  const R = await import('../../server/writer/recorded.ts');
  const { invalidateMasterProfile, loadMasterProfile } = await import('../../server/profile/index.ts');
  const { refreshStyle } = await import('../../server/profile/voice.ts');
  const { transition, pipelineState } = await import('../../server/campaign/pipeline.ts');
  const { ApplicationPacketSchema } = await import('../../server/contracts/writer.ts');
  const W = await import('../../server/writer/index.ts');
  const { writeApplicationRun } = await import('../../server/writer/pipeline.ts');
  const { lintLetter, lintShort, ruleOfThree, closingSummary, openingNames } = await import('../../server/writer/lint.ts');
  const { codeTruth, truthResult, titleInflation } = await import('../../server/writer/truth.ts');
  const { findTells, HUMANIZER_RULES } = await import('../../server/writer/humanizer.ts');
  const { applyEdits, humanizeTargets } = await import('../../server/writer/humanize.ts');
  const { normalizeCritic, CRITIC_BAR } = await import('../../server/writer/critic.ts');
  const { subjectProblems } = await import('../../server/writer/letters.ts');
  const { loadContext } = await import('../../server/writer/context.ts');
  const { fitToPage, sanitizeCv } = await import('../../server/writer/cv.ts');
  const { answerQuestionTraced, prewrittenKey } = await import('../../server/writer/answers.ts');
  const { chooseVariant } = await import('../../server/writer/choose.ts');
  const B = await import('../../server/writer/bandit.ts');
  const { seededRng } = await import('../../server/writer/text.ts');
  const { recentRuns, applicationQuality } = await import('../../server/writer/quality.ts');
  const { formatRuns, formatDetail } = await import('../../server/writer/report.ts');
  const { renderCvPdfWithPages } = await import('../../server/services/cvPdf.ts');
  const { cvPdfFor, loadApplication } = await import('../../server/services/applications.ts');
  const tailor = await import('../../server/ai/tailor.ts');
  const prompts = await import('../../server/ai/prompts.ts');
  const { extractText } = await import('unpdf');
  type WriterAi = import('../../server/writer/ai.ts').WriterAi;
  type TailoredCv = import('../../server/writer/cvSchema.ts').TailoredCv;

  // ── Save what this module overwrites; restored at the end ──────────────────
  const saved = {
    profile: all('SELECT * FROM profile'),
    facts: all('SELECT * FROM profile_facts'),
    voice: all('SELECT * FROM voice_bank'),
    learning: all('SELECT * FROM learning_list'),
    settings: all("SELECT * FROM settings WHERE key IN ('profile.links', 'profile.hiddenFacts', 'profile.style')"),
    outcomes: all('SELECT * FROM outcomes'),
  };
  run('DELETE FROM outcomes');

  F.seedScenario();
  const canned = R.cannedResponses(F.factIdOf);
  const master = loadMasterProfile()!;
  const fp = master.style!;
  const voice = master.voiceBank.map((v) => ({ id: v.id, text: v.text }));
  const lintCtx = { fingerprint: fp, voice, company: F.COMPANY, role: 'Backend Engineer, Payments', specifics: F.BRIEF.recent.map((r) => r.text) };
  const lintOf = (text: string) => lintLetter(text, lintCtx);
  const checkOf = (text: string, id: string) => lintOf(text).checks.find((c) => c.id === id)!;
  const GOOD = R.LETTER_STORY;

  /** A Claude client built from the canned responses, with per-step overrides (undefined = canned, Error = throw). */
  const fakeAi = (over: Record<string, unknown> = {}, calls: string[] = []): WriterAi => ({
    async ask(opts) {
      calls.push(opts.label);
      const v = opts.label in over ? over[opts.label] : canned[opts.label];
      if (v instanceof Error) throw v;
      if (v === undefined) throw new Error(`fake AI has no response for ${opts.label}`);
      return opts.schema.parse(typeof v === 'function' ? (v as (o: unknown) => unknown)(opts) : v);
    },
  });
  const noAi: WriterAi = {
    async ask(opts) {
      throw new Error(`Claude was called (${opts.label}) but should not have been`);
    },
  };

  // ── Lint ──────────────────────────────────────────────────────────────────
  section('A04 writer: stylometric lint (each rule measured)');
  await check('the recorded final letter passes every lint check', () => {
    const r = lintOf(GOOD);
    assert.ok(r.pass, JSON.stringify(r.checks.filter((c) => !c.pass)));
    assert.equal(r.checks.length, 15);
    assert.ok(r.checks.every((c) => typeof c.value === 'number' || typeof c.value === 'string'));
  });
  await check('"Jr." in a role title does not end the opening sentence', async () => {
    const { splitSentences } = await import('../../server/profile/voice.ts');
    assert.deepEqual(splitSentences('Your Jr. UI Developer role centres on UI components. I rebuilt a clinic app.'), ['Your Jr. UI Developer role centres on UI components.', 'I rebuilt a clinic app.']);
  });
  await check('a bundled keyword ("Git and GitHub") is backed only when every tool in it is', async () => {
    const { factBacks } = await import('../../server/writer/truth.ts');
    const facts = 'Skills: Git, GitHub, React, HTML5/CSS3';
    assert.ok(factBacks('Git and GitHub', facts));
    assert.ok(factBacks('React/Git', facts));
    assert.ok(!factBacks('Git and Kubernetes', facts));
  });
  await check('volume mode tolerates style measures only; a hard check still blocks', async () => {
    const { tolerateStyle } = await import('../../server/writer/pipeline.ts');
    const base = lintOf(GOOD);
    const soft = { ...base, pass: false, checks: base.checks.map((c) => (c.id === 'burstiness' || c.id === 'rule_of_three' ? { ...c, pass: false } : c)) };
    assert.equal(tolerateStyle(soft).pass, true);
    const hard = { ...soft, checks: soft.checks.map((c) => (c.id === 'banned_phrases' ? { ...c, pass: false } : c)) };
    assert.equal(tolerateStyle(hard).pass, false);
    const long = (words: number) => ({ ...soft, checks: soft.checks.map((c) => (c.id === 'length' ? { ...c, pass: false, value: words, target: '180–280 words' } : c)) });
    assert.equal(tolerateStyle(long(290)).pass, true, '10 words over is within 10%');
    assert.equal(tolerateStyle(long(323)).pass, true, '323 words is within 20%');
    assert.equal(tolerateStyle(long(360)).pass, false);
  });
  await check('length: under 180 words fails', () => {
    const c = checkOf(GOOD.split('\n\n').slice(0, 2).join('\n\n'), 'length');
    assert.equal(c.pass, false);
    assert.ok((c.value as number) < 180);
  });
  await check('burstiness: uniform sentence lengths fail against the fingerprint spread', () => {
    const uniform = Array.from({ length: 18 }, (_, i) => `I built the ledger service in Go for the store number ${i % 2 ? 'one' : 'two'} branch.`).join(' ');
    const c = checkOf(`Dear team,\n\n${uniform}\n\nBest,\nAyesha Khan`, 'burstiness');
    assert.equal(c.pass, false);
    assert.ok((c.value as number) < fp.sentenceLenStd * 0.8);
  });
  await check('lexical diversity: a repetitive letter falls below the ±15% band', () => {
    const rep = Array.from({ length: 30 }, () => 'I fixed the ledger and the ledger was fixed.').join(' ');
    const c = checkOf(rep, 'lexical_diversity');
    assert.equal(c.pass, false);
    assert.ok((c.value as number) < fp.typeTokenRatio * 0.85);
  });
  await check('contractions: a letter with every contraction expanded fails (±50% of the fingerprint)', () => {
    const formal = GOOD.replace(/I'm/g, 'I am').replace(/I'd/g, 'I would').replace(/wasn't/g, 'was not').replace(/haven't/g, 'have not').replace(/family's/g, 'family’s');
    const c = checkOf(formal, 'contractions');
    assert.equal(c.pass, false);
    assert.ok(checkOf(GOOD, 'contractions').pass);
  });
  await check('nominalisations: noun-heavy prose fails', () => {
    const heavy = GOOD.replace(
      'My uncle checks the balance sheet on his phone.',
      'The implementation of reconciliation automation enabled the optimization of documentation, configuration management and the standardization of administration.',
    );
    assert.equal(checkOf(heavy, 'nominalizations').pass, false);
  });
  await check('banned phrases: every word the brief names is caught', () => {
    const words = ['delve into', 'a testament to', 'a rich tapestry', 'a pivotal moment', 'the fintech landscape', 'leverage my skills', 'a seamless handover', 'a robust system', 'elevate your team', 'foster growth', 'navigate the complexities'];
    for (const w of words) {
      const c = checkOf(GOOD.replace('My uncle checks the balance sheet on his phone.', `I want to ${w} here.`), 'banned_phrases');
      assert.equal(c.pass, false, w);
    }
  });
  await check('humanizer rules: significance, promotional, vague attribution, parallelism, sycophancy, hedging and transitions are caught', () => {
    const cases: [string, string][] = [
      ['significance-inflation', 'This role plays a pivotal role in payments.'],
      ['promotional', 'Your world-class team builds groundbreaking tools.'],
      ['vague-attribution', 'Experts agree that ledgers are hard.'],
      ['negative-parallelism', "It's not just a ledger, but a promise."],
      ['sycophancy', 'I would be honoured to join your esteemed company.'],
      ['hedging-density', 'Perhaps I might be somewhat useful, arguably.'],
      ['ai-transitions', 'I fixed it. Additionally, I tested it.'],
      ['opener-stock', 'Please accept this letter as my application.'],
      ['closer-stock', 'Thank you for considering my application.'],
      ['title-case-heading', 'Relevant Experience And Skills\nI built a ledger.'],
      ['markdown', 'I built **a ledger** in Go.'],
      ['placeholder', 'I admire [Company Name] a lot.'],
    ];
    for (const [rule, text] of cases) assert.ok(findTells(text).some((t) => t.rule === rule), `${rule}: ${text}`);
    assert.equal(findTells(GOOD.split('\n\nBest,')[0]).length, 0);
    assert.ok(HUMANIZER_RULES.length >= 15);
  });
  await check('em dashes: one is allowed, two fail', () => {
    const one = GOOD.replace('He still prints it out, though.', 'He still prints it out — every week.');
    assert.ok(checkOf(one, 'em_dashes').pass);
    const two = one.replace('It wasn\'t pretty code.', 'It wasn\'t pretty — at all.');
    assert.equal(checkOf(two, 'em_dashes').pass, false);
  });
  await check('rule of three: an adjective triad fails; a list of named tools does not', () => {
    assert.ok(ruleOfThree('I want my code to be fast, reliable and simple.').length);
    assert.equal(ruleOfThree('I used Go, PostgreSQL and Docker.').length, 0);
    const c = checkOf(GOOD.replace('My uncle checks the balance sheet on his phone.', 'The ledger is fast, clean, and reliable.'), 'rule_of_three');
    assert.equal(c.pass, false);
  });
  await check('openers: "I am writing to" and "I\'m excited to apply" fail; "passionate" fails', () => {
    assert.equal(checkOf(GOOD.replace('The week before Eid', 'I am writing to apply. The week before Eid'), 'no_writing_to').pass, false);
    assert.equal(checkOf(GOOD.replace('The week before Eid', "I'm thrilled to apply. The week before Eid"), 'no_excited_to_apply').pass, false);
    assert.equal(checkOf(GOOD.replace('which is the part of this work I like most', "which I'm passionate about"), 'no_passionate').pass, false);
  });
  await check('closing summary: a restating last paragraph fails (stock phrase or recycled words)', () => {
    const stock = GOOD.replace('Could we find half an hour next week to talk about your ledger?', 'In short, my ledger experience would make me a strong fit for your team.');
    assert.equal(checkOf(stock, 'closing_summary').pass, false);
    const recycled = closingSummary('I built LedgerLite in Go and PostgreSQL for the store ledger at both branches.\n\nLedgerLite in Go and PostgreSQL runs the store ledger for both branches.');
    assert.equal(recycled.pass, false);
  });
  await check('specific opening: a generic first sentence fails; naming the company passes', () => {
    const generic = GOOD.replace(
      "The week before Eid, the busiest week of the year, my family's hardware store lost its spreadsheet, and that week is the reason I'm applying to work on Daftar Pay's ledger.",
      'I have always liked building software for people.',
    );
    assert.equal(checkOf(generic, 'specific_opening').pass, false);
    assert.equal(checkOf(GOOD, 'specific_opening').value, 'Daftar Pay');
    // People shorten a company to its distinctive first word; a common one does not count.
    assert.equal(openingNames("Copperline's post on idempotency keys is why I'm writing.", { company: 'Copperline Payments', role: 'Backend Engineer' }), 'Copperline');
    assert.equal(openingNames('Global teams need good tooling.', { company: 'Global Payments Inc', role: 'Backend Engineer' }), null);
  });
  await check('formatting: markdown and placeholders fail', () => {
    assert.equal(checkOf(GOOD.replace('Dear Daftar Pay Payments team,', 'Dear [Hiring Manager],'), 'formatting').pass, false);
    assert.equal(checkOf(GOOD.replace('He still prints it out, though.', 'He **still** prints it out.'), 'formatting').pass, false);
  });
  await check('voice adaptation: a letter written from nothing fails; the measured passages are stored', () => {
    const fresh = `Dear Daftar Pay team,\n\nDaftar Pay's Backend Engineer, Payments role fits what I do. ${'I write backend services in Go and care about correct ledgers. '.repeat(1)}My work at a hardware store taught me reconciliation. I built an API there that replaced paper books. Since then I have kept it running and improved its queries. I would like to bring the same care to your payments services. I read about your replication work and it made sense to me. My background is small but real, and I learn quickly when a real problem is in front of me. I keep notes on every incident and fix the cause, not the symptom. That habit came from running one system for a family business where nobody else could. ${'I also test what I ship before anyone asks. '.repeat(1)}Your team writes design docs first, which I like, because writing forces the hard questions early. I would enjoy doing that with people who know more than me. I am in Lahore and can come to the office. I can start soon and would be glad to talk through any part of my work in detail with your engineers whenever it suits them.\n\nCould we talk next week?\n\nBest,\nAyesha Khan`;
    const r = lintOf(fresh);
    assert.equal(r.checks.find((c) => c.id === 'voice_adaptation')!.pass, false);
    assert.ok(lintOf(GOOD).adaptedPassages.length >= 2);
  });
  await check('short lint: answers and notes get phrases, formatting, dashes, triads and length', () => {
    assert.ok(lintShort(R.OUTREACH, { minChars: 400, maxChars: 600, company: F.COMPANY }).pass);
    assert.equal(lintShort('I would leverage my robust skills.', {}).pass, false);
    assert.equal(lintShort('x'.repeat(700), { maxChars: 600 }).pass, false);
  });

  // ── Truth lock (code) ─────────────────────────────────────────────────────
  section('A04 writer: truth lock');
  const ctx = await loadContext(F.JOB_ID, { brief: F.BRIEF });
  const cleanCv: TailoredCv = sanitizeCv((canned.cv as { cv: TailoredCv }).cv, ctx, null).cv;
  const truthOf = (texts: string[], cv: TailoredCv | null = null) => codeTruth({ cv, texts: texts.map((text) => ({ label: 'Letter', text })) }, ctx.source);
  const high = <T extends { severity: string }>(issues: T[]) => issues.filter((i) => i.severity === 'high');
  await check('the recorded letter, answers, outreach, follow-up and CV are clean', () => {
    const issues = truthOf([R.LETTER_STORY, R.LETTER_HOOK, R.LETTER_PROOF, R.OUTREACH, R.FOLLOW_UP, ...R.SHORT_ANSWERS.map((a) => a.answer), ...R.SUBJECTS], cleanCv);
    assert.deepEqual(issues, []);
  });
  await check('catches an invented metric (digits and number words)', () => {
    assert.ok(high(truthOf(['I cut posting latency by 40% at the store.'])).some((i) => i.claim.includes('40%')));
    assert.ok(high(truthOf(['It took nine months to ship.'])).length);
    assert.ok(high(truthOf(['It now posts about 4,000 entries a day.'])).some((i) => i.claim.includes('4,000')));
    assert.equal(high(truthOf(['It posts about 400 entries a day and closing takes 2 hours instead of 3 days.'])).length, 0);
  });
  await check('a tool the letter already says the candidate has not used is not a claim when mentioned again', () => {
    assert.equal(high(truthOf(["I haven't used Terraform yet. Terraform should go the same way, since I've built backends before."])).filter((i) => i.claim === 'Terraform').length, 0);
    assert.ok(high(truthOf(["Terraform should go the same way, since I've built backends before."])).some((i) => i.claim === 'Terraform'));
  });
  await check('catches an invented skill, in the CV and in prose', () => {
    const cv = structuredClone(cleanCv);
    cv.skills[0].items.push('Terraform');
    assert.ok(high(truthOf([], cv)).some((i) => i.claim === 'Terraform' && /none of your profile facts/.test(i.reason)));
    assert.ok(high(truthOf(["I've built CI pipelines with Terraform and Jenkins."])).some((i) => i.claim === 'Terraform'));
  });
  await check('catches a gap skill listed as a skill (learning-list skill outside "Currently learning")', () => {
    const cv = structuredClone(cleanCv);
    cv.skills[1].items.push('Kubernetes');
    assert.ok(high(truthOf([], cv)).some((i) => i.claim === 'Kubernetes' && /gap skill/.test(i.reason)));
  });
  await check('catches a learning-list skill presented as experience in prose', () => {
    assert.ok(high(truthOf(['I deployed LedgerLite on Kubernetes in production.'])).some((i) => i.claim === 'Kubernetes' && /learning list/.test(i.reason)));
    assert.equal(high(truthOf(["I'm learning Kubernetes on a small k3s cluster at home."])).length, 0);
  });
  await check('"Currently learning" may only hold learning-list items (a queued skill is not learning)', () => {
    const cv = structuredClone(cleanCv);
    cv.skills.find((g) => g.group === 'Currently learning')!.items.push('Kafka');
    assert.ok(high(truthOf([], cv)).some((i) => i.claim === 'Kafka'));
  });
  await check('catches an inflated title, changed dates and an invented employer', () => {
    const cv = structuredClone(cleanCv);
    cv.experience[0].role = 'Senior Backend Engineer';
    cv.experience[1].start = 'Jan 2023';
    cv.experience.push({ role: 'Engineer', company: 'Google', location: 'Remote', start: '2023', end: '2024', bullets: [] });
    const issues = high(truthOf([], cv));
    assert.ok(issues.some((i) => /Title differs/.test(i.reason) && /senior/.test(i.reason)));
    assert.ok(issues.some((i) => /Dates differ/.test(i.reason)));
    assert.ok(issues.some((i) => /employer is not in your source CV/.test(i.reason)));
    assert.deepEqual(titleInflation('Backend Developer', 'Backend Developer'), []);
    assert.deepEqual(titleInflation('Lead Backend Developer', 'Backend Developer'), ['lead']);
  });
  await check('catches inflated scope, years of experience, self-described seniority and an invented employer in prose', () => {
    assert.ok(high(truthOf(['At the store I led a team of developers.'])).some((i) => /overstates your scope/.test(i.reason)));
    assert.ok(high(truthOf(['I have 3 years of backend experience.'])).some((i) => /years of experience/.test(i.reason)));
    assert.ok(high(truthOf(['As a senior engineer I care about ledgers.'])).some((i) => /none of your titles/.test(i.reason)));
    assert.ok(high(truthOf(['When I worked at Stripe I built payouts.'])).some((i) => /Stripe/.test(i.reason)));
    assert.equal(high(truthOf(['When I worked at Khan Hardware I built the ledger.'])).length, 0);
    // "lead" as a noun and honest gap sentences are not claims.
    assert.equal(high(truthOf(['My lead asked me to write up what happened.'])).length, 0);
    assert.equal(high(truthOf(["I haven't worked with CRDTs yet."])).length, 0);
  });
  await check("naming the employer's own stack is allowed; claiming it is not", () => {
    assert.equal(high(truthOf(['Your posting asks for OpenTelemetry and Prometheus.'])).length, 0);
    assert.ok(high(truthOf(["I've used OpenTelemetry for years."])).some((i) => i.claim === 'OpenTelemetry'));
  });
  await check('catches an invented certification and an evidence-map claim with no real fact', () => {
    const cv = structuredClone(cleanCv);
    cv.certifications.push('AWS Certified Developer');
    assert.ok(high(truthOf([], cv)).some((i) => /certification/.test(i.reason)));
    const ev = { jobId: F.JOB_ID, priorities: [], mustWins: [], tone: '', seniority: '', hooks: [], biggestGap: null, items: [{ requirement: 'Kafka', importance: 'nice' as const, factIds: ['cv_fake'], evidence: '', framing: 'direct' as const, phrasing: '' }] };
    assert.ok(high(codeTruth({ texts: [], evidence: ev }, ctx.source)).some((i) => /cites no profile fact/.test(i.reason)));
    assert.equal(truthResult([{ claim: 'x', reason: 'y', severity: 'low', origin: 'code' }]).pass, true);
  });
  await check('the CV assembler pins verbatim fields and drops what facts do not back', () => {
    const raw = structuredClone((canned.cv as { cv: TailoredCv }).cv);
    raw.experience[0].role = 'Senior Backend Engineer';
    raw.skills[0].items.push('Terraform');
    raw.certifications.push('CKA');
    const { cv, changes } = sanitizeCv(raw, ctx, null);
    assert.equal(cv.experience[0].role, 'Backend Developer');
    assert.ok(!cv.skills.flatMap((g) => g.items).includes('Terraform'));
    assert.ok(cv.skills.find((g) => g.group === 'Currently learning')!.items.includes('Kubernetes'));
    assert.deepEqual(cv.certifications, []);
    assert.ok(changes.length >= 3);
    assert.deepEqual(high(truthOf([], cv)), []);
  });

  // ── Humanizer, critic, subjects ───────────────────────────────────────────
  section('A04 writer: humanizer, critic and subject lines');
  await check('the humanizer applies edits only inside flagged sentences', () => {
    const targets = humanizeTargets(R.LETTER_STORY_DRAFT);
    assert.equal(targets.length, 1);
    const res = applyEdits(R.LETTER_STORY_DRAFT, [
      { find: R.HUMANIZE_FIND, replace: R.HUMANIZE_REPLACE, reason: 'ok' },
      { find: 'My uncle checks the balance sheet', replace: 'My uncle reads the balance sheet', reason: 'outside' },
      { find: 'not in the text at all', replace: 'x', reason: 'missing' },
    ], targets);
    assert.equal(res.applied.length, 1);
    assert.equal(res.rejected.length, 2);
    assert.equal(res.text, R.LETTER_STORY);
  });
  await check('critic score is held to its sub-scores: any sub-score under 6 caps it at 7.5', () => {
    assert.equal(normalizeCritic({ score: 9.5, scores: { specificity: 9, evidence: 9, voice: 9, clarity: 9, ask: 9, aiTells: 5 }, demands: [] }).score, 7.5);
    assert.equal(normalizeCritic({ score: 10, scores: { specificity: 8, evidence: 8, voice: 8, clarity: 8, ask: 8, aiTells: 8 }, demands: [] }).score, 8.5);
    assert.equal(CRITIC_BAR, 5);
  });
  await check('subject lines: under 70 characters, no clickbait, caps, emoji or "!"', () => {
    for (const s of R.SUBJECTS) assert.deepEqual(subjectProblems(s), [], s);
    assert.ok(subjectProblems('URGENT: hire me now!').length >= 2);
    assert.ok(subjectProblems('x'.repeat(70)).length);
    assert.ok(subjectProblems('Backend role 🚀').includes('emoji'));
  });

  // ── Full pipeline on the recorded fixture job (replay) ────────────────────
  section('A04 writer: full pipeline on the recorded fixture job');
  F.seedScenario();
  const events: string[] = [];
  const { bus } = await import('../../server/services/bus.ts');
  const onEvent = (e: { type: string; to?: string }) => {
    if (e.type === 'pipeline.state') events.push(e.to!);
  };
  bus.on('event', onEvent);
  const first = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { rng: seededRng(F.SEED) });
  bus.off('event', onEvent);
  const appId = first.applicationId!;
  const packet = 'skipped' in first.result ? null : first.result;
  await check('writes a packet that passes every gate (critic ≥ 5, lint, truth lock)', () => {
    assert.ok(packet, JSON.stringify(first.result));
    ApplicationPacketSchema.parse(packet);
    assert.ok(packet!.quality.critic!.score >= CRITIC_BAR);
    assert.equal(packet!.mode, 'quality');
    assert.ok(packet!.quality.lint.pass);
    assert.ok(packet!.quality.truth.pass);
    // Story (8.3, drafted with "crucial") and the revised hook (8.8) both clear the bar; the hook already passes the lint, so it wins.
    assert.equal(packet!.coverLetter, R.LETTER_HOOK);
    assert.equal(packet!.subject, R.SUBJECTS[1]);
    assert.equal(packet!.outreach, R.OUTREACH);
    assert.equal(packet!.followUp, R.FOLLOW_UP);
    assert.deepEqual(Object.keys(packet!.shortAnswers).sort(), ['tell us about a project', 'why this role', 'why us']);
  });
  await check('moves the pipeline selected → writing → written through transition()', () => {
    assert.deepEqual(events, ['writing', 'written']);
    assert.equal(pipelineState(F.JOB_ID)?.state, 'written');
    const log = all<{ to_state: string; reason: string }>('SELECT to_state, reason FROM pipeline_log WHERE job_id = ? ORDER BY id', F.JOB_ID).map((r) => r.to_state);
    assert.deepEqual(log.slice(-2), ['writing', 'written']);
  });
  await check('persists the application with campaign_id and variant_id, and two variants with passages, critic, lint and style tags', () => {
    const app = get<{ campaign_id: string; variant_id: string; status: string; cover_letter: string }>('SELECT campaign_id, variant_id, status, cover_letter FROM applications WHERE id = ?', appId)!;
    assert.equal(app.campaign_id, F.CAMPAIGN_ID);
    assert.equal(app.status, 'draft');
    const rows = all<{ id: string; variant: string; text: string; passages_used: string; critic: string; lint: string; style_tags: string; chosen: number }>('SELECT * FROM letter_variants WHERE application_id = ?', appId);
    // Quality mode drafts two strategies (the bandit's picks), not three.
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((r) => r.variant)).size, 2);
    assert.ok(rows.every((r) => ['hook', 'proof', 'story'].includes(r.variant)));
    const chosen = rows.filter((r) => r.chosen === 1);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].id, app.variant_id);
    assert.equal(chosen[0].text, app.cover_letter);
    for (const r of rows) {
      const passages = JSON.parse(r.passages_used) as string[];
      assert.ok(passages.length >= 2, `${r.variant} adapted ${passages.length} passages`);
      for (const p of passages) assert.ok(voice.some((v) => v.id === p));
      assert.ok(JSON.parse(r.critic).score >= CRITIC_BAR);
      assert.ok(JSON.parse(r.lint).checks.length >= 10);
      const tags = JSON.parse(r.style_tags) as string[];
      assert.ok(tags.includes(`strategy:${r.variant}`) && tags.includes('len:medium'));
    }
  });
  await check('the evidence map is sanitised in code (unread hook and unknown fact id dropped) and stored', () => {
    const q = applicationQuality(appId)!;
    assert.equal(q.writer.evidence!.hooks.length, 2);
    assert.ok(q.writer.evidence!.items.every((i) => i.framing === 'omit' || i.factIds.length > 0));
    assert.ok(!q.writer.evidence!.items.flatMap((i) => i.factIds).includes('cv_0000000000000000'));
    assert.ok(q.writer.evidenceAdjustments.some((a) => /unread source/.test(a)));
    // The chosen letter was lint-clean, so the humanizer had nothing to do (its edits are checked on the story letter below).
    assert.ok(q.writer.steps.some((s) => s.step === 'humanize' && /no tells found/.test(s.detail)));
    assert.ok(q.writer.cvChanges.some((c) => /Kubernetes/.test(c)));
  });
  await check('the CV PDF is one page and round-trips through text extraction with every section intact', async () => {
    assert.ok(fs.existsSync(packet!.cvPdfPath) && fs.existsSync(packet!.letterPdfPath));
    const buf = fs.readFileSync(packet!.cvPdfPath);
    const { text } = await extractText(new Uint8Array(buf), { mergePages: true });
    const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
    const got = flat(text as string);
    const cv = applicationQuality(appId)!.cv as TailoredCv;
    for (const h of ['SUMMARY', 'SKILLS', 'CURRENTLY LEARNING', 'EXPERIENCE', 'PROJECTS', 'EDUCATION']) assert.ok(got.includes(h), `heading ${h}`);
    for (const s of [cv.name, cv.contact.email, cv.contact.phone, cv.summary, ...cv.experience.flatMap((e) => [e.role, e.company, ...e.bullets]), ...cv.projects.flatMap((p) => [p.name, p.description, ...p.highlights]), ...cv.skills.flatMap((g) => g.items), cv.education[0].degree]) {
      assert.ok(got.includes(flat(s)), `missing from PDF text: ${s}`);
    }
    assert.ok(got.indexOf('SUMMARY') < got.indexOf('EXPERIENCE') && got.indexOf('EXPERIENCE') < got.indexOf('EDUCATION'), 'reading order');
    assert.equal(applicationQuality(appId)!.writer.cvPages, 1);
    const letter = flat((await extractText(new Uint8Array(fs.readFileSync(packet!.letterPdfPath)), { mergePages: true })).text as string);
    assert.ok(letter.includes(flat(R.LETTER_HOOK.split('\n\n')[1])));
  });
  await check('long CVs are trimmed until the rendered PDF measures one page', async () => {
    const long = structuredClone(cleanCv);
    for (let i = 0; i < 6; i++) long.projects.push({ ...long.projects[0], name: `Project ${i}`, highlights: [...long.projects[0].highlights, 'Another real line about it.', 'And one more.'] });
    long.experience[0].bullets = [...long.experience[0].bullets, ...long.experience[0].bullets];
    assert.ok((await renderCvPdfWithPages(long)).pages > 1);
    const fitted = await fitToPage(long, 1.5, 'A4');
    assert.equal(fitted.pages, 1);
    assert.ok(fitted.trimmed.length > 0);
  });
  await check('v1 surfaces still work: loadPacket, packetForJob, cvPdfFor, tailor and prompt exports', async () => {
    assert.equal(W.loadPacket(appId)!.applicationId, appId);
    assert.equal(W.packetForJob(F.JOB_ID)!.applicationId, appId);
    const pdf = await cvPdfFor(loadApplication(appId));
    assert.equal(pdf.content.subarray(0, 5).toString(), '%PDF-');
    assert.equal(typeof tailor.draftApplication, 'function');
    tailor.TailoredCvSchema.parse(cleanCv);
    assert.ok(prompts.TAILOR_RULES.includes('TRUTH LOCK') && prompts.FACT_AUDITOR.length > 100);
  });

  await check('a letter edited after writing must pass the gates again before the packet is handed out', () => {
    const set = (t: string) => run('UPDATE applications SET cover_letter = ? WHERE id = ?', t, appId);
    set(R.LETTER_STORY.replace('which is the part of this work I like most', "which I'm passionate about"));
    assert.equal(W.loadPacket(appId), null);
    set(R.LETTER_STORY.replace('He still prints it out, though.', 'He still prints it out, mind you.'));
    const p = W.loadPacket(appId);
    assert.ok(p && p.quality.lint.pass && p.quality.truth.pass);
    set(R.LETTER_STORY.replace('It posts about 400 entries a day', 'It posts about 4,000 entries a day'));
    assert.equal(W.loadPacket(appId), null);
    set(R.LETTER_STORY);
    assert.ok(W.loadPacket(appId));
  });

  section('A04 writer: answers and follow-up');
  await check('pre-written answers serve "why us", "why this role" and "tell us about a project" without a Claude call', async () => {
    assert.equal(prewrittenKey('Why do you want to work at Daftar Pay?', F.COMPANY), 'why us');
    assert.equal(prewrittenKey('Why are you interested in this role?'), 'why this role');
    assert.equal(prewrittenKey('Tell us about a project you are proud of'), 'tell us about a project');
    const a = await W.answerQuestion(F.JOB_ID, 'Why do you want to work at Daftar Pay?', { ai: noAi });
    assert.equal(a?.value, R.SHORT_ANSWERS[0].answer);
    assert.equal(a?.source, 'writer');
  });
  await check('any other question is written from the evidence map and passes the short lint and truth lock (replayed)', async () => {
    const t = await answerQuestionTraced(F.JOB_ID, 'Describe a time you debugged a hard production issue.');
    assert.ok(t.answered, JSON.stringify(t));
    assert.ok(t.lint?.pass && t.truth?.pass);
  });
  await check('an answer that fails its gates twice returns null; option questions return an exact option', async () => {
    const bad = { answer: 'I led a team of 9 engineers and I am passionate about payments.', option: null };
    const t = await answerQuestionTraced(F.JOB_ID, 'What is your leadership style?', { ai: fakeAi({ answer: bad, answer_retry: bad }), context: { brief: null } });
    assert.equal(t.answered, null);
    assert.equal(t.attempts, 2);
    const o = await W.answerQuestion(F.JOB_ID, 'Are you comfortable working in Go?', { options: ['Yes', 'No'], ai: fakeAi({ answer: { answer: '', option: 'yes' } }) });
    assert.equal(o?.value, 'Yes');
    const none = await W.answerQuestion(F.JOB_ID, 'Pick a shift', { options: ['Night'], ai: fakeAi({ answer: { answer: '', option: 'Morning' } }) });
    assert.equal(none, null);
  });
  await check('draftFollowUp returns the gated follow-up with a reply subject', async () => {
    const f = await W.draftFollowUp(appId);
    assert.equal(f?.body, R.FOLLOW_UP);
    assert.equal(f?.subject, `Re: ${R.SUBJECTS[1]}`);
    assert.equal(await W.draftFollowUp('nope'), null);
  });

  section('A04 writer: variants and regenerate');
  await check('choosing another variant re-runs the gates and switches the packet', async () => {
    const before = W.loadVariants(appId);
    const was = before.find((v) => v.chosen)!;
    const other = before.find((v) => !v.chosen)!;
    // The other variant is the story draft, still holding its "crucial": the lint refuses it and nothing changes.
    await assert.rejects(() => chooseVariant(appId, other.id, fakeAi({ audit_choose: { issues: [] } })), (e: unknown) => e instanceof AppError && e.code === 'GATE_LINT');
    assert.equal(get<{ variant_id: string }>('SELECT variant_id FROM applications WHERE id = ?', appId)!.variant_id, was.id);
    // Once the variant reads as the humanized letter, the gates pass and the packet switches.
    run('UPDATE letter_variants SET text = ? WHERE id = ?', R.LETTER_STORY, other.id);
    other.text = R.LETTER_STORY;
    const res = await chooseVariant(appId, other.id, fakeAi({ audit_choose: { issues: [] } }));
    assert.equal(res.changed, true);
    assert.equal(get<{ variant_id: string }>('SELECT variant_id FROM applications WHERE id = ?', appId)!.variant_id, other.id);
    assert.equal(W.loadPacket(appId)!.coverLetter, other.text);
    // A variant under the critic bar can't be chosen.
    run("UPDATE letter_variants SET critic = json_set(critic, '$.score', 4) WHERE id = ?", was.id);
    await assert.rejects(() => chooseVariant(appId, was.id, fakeAi({ audit_choose: { issues: [] } })), (e: unknown) => e instanceof AppError && e.code === 'GATE_CRITIC');
  });
  await check('regenerating a written job goes written → selected → writing → written and replaces the variants', async () => {
    const again = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { rng: seededRng(F.SEED) });
    assert.ok(!('skipped' in again.result));
    assert.equal(again.applicationId, appId);
    assert.equal(pipelineState(F.JOB_ID)?.state, 'written');
    assert.equal(all('SELECT id FROM letter_variants WHERE application_id = ?', appId).length, 2);
  });

  // ── The gates reject bad letters end to end ───────────────────────────────
  section('A04 writer: gates reject bad letters');
  const fixed = (letter: string) => ({ letter, subject: R.SUBJECTS[1], outreach: R.OUTREACH, followUp: R.FOLLOW_UP, shortAnswers: R.SHORT_ANSWERS });
  const withStory = (text: string) => ({ ...(canned.letters as object), variants: (canned.letters as { variants: { strategy: string }[] }).variants.map((v) => (v.strategy === 'story' ? { ...v, text } : v)) });
  const skippedRun = async (over: Record<string, unknown>, expect: RegExp) => {
    F.seedScenario();
    const calls: string[] = [];
    const r = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { ai: fakeAi(over, calls), rng: seededRng(F.SEED) });
    assert.ok('skipped' in r.result, `expected a skip, got a packet (calls: ${calls.join(', ')})`);
    assert.match((r.result as { skipped: string }).skipped, expect);
    assert.equal(pipelineState(F.JOB_ID)?.state, 'skipped');
    assert.match(pipelineState(F.JOB_ID) ? (get<{ reason: string }>('SELECT reason FROM pipeline_log WHERE job_id = ? ORDER BY id DESC LIMIT 1', F.JOB_ID)?.reason ?? '') : '', /writer:/);
    const app = get<{ status: string; notes: string }>('SELECT status, notes FROM applications WHERE id = ?', r.applicationId!)!;
    assert.equal(app.status, 'skipped');
    assert.equal(W.loadPacket(r.applicationId!), null);
    assert.ok((JSON.parse(app.notes) as { issues: { claim: string }[] }).issues.some((i) => i.claim === 'Quality gate'));
    return { r, calls };
  };
  const allLow = { variants: ['hook', 'proof', 'story'].map((strategy) => ({ strategy, score: 4.4, scores: { specificity: 4, evidence: 5, voice: 4, clarity: 5, ask: 4, aiTells: 4 }, demands: [] })), bestSubject: 0 };
  // Only the story letter clears the critic, so the gates below run on it (a lint-clean hook would otherwise be preferred).
  const storyCritic = (canned.critic as { variants: { strategy: string }[] }).variants.find((v) => v.strategy === 'story')!;
  const storyOnly = { variants: allLow.variants.map((v) => (v.strategy === 'story' ? storyCritic : v)), bestSubject: 1 };
  await check('critic under 5 for every letter → skipped with the reason', async () => {
    const { calls } = await skippedRun({ critic: allLow }, /^critic: best letter scored 4\.4/);
    assert.ok(!calls.includes('revise') && !calls.includes('audit'));
  });
  await check('critic demands applied once but still under 5 → skipped', async () => {
    const lowAgain = { variants: allLow.variants.slice(0, 2), bestSubject: 0 };
    const { calls } = await skippedRun({ critic: { ...allLow, variants: allLow.variants.map((v) => ({ ...v, demands: ['Be specific.'] })) }, revise: canned.revise, critic_rescore: lowAgain }, /^critic/);
    assert.equal(calls.filter((c) => c === 'revise').length, 1);
  });
  await check('a lint failure the targeted rewrite cannot fix → skipped', async () => {
    const bad = R.LETTER_STORY.replace('which is the part of this work I like most', "which I'm passionate about").replace('He still prints it out, though.', 'He still prints it out — every week — on paper.');
    const { calls } = await skippedRun({ critic: storyOnly, letters: withStory(bad), humanize: { edits: [] }, lint_fix: { edits: [] } }, /^lint: .*no_passionate/);
    assert.ok(calls.includes('lint_fix'));
  });
  await check('a lint failure the targeted rewrite fixes → written', async () => {
    F.seedScenario();
    const bad = R.LETTER_STORY.replace('which is the part of this work I like most', "which I'm passionate about");
    const r = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, {
      ai: fakeAi({ critic: storyOnly, letters: withStory(bad), humanize: { edits: [] }, lint_fix: { edits: [{ find: "which I'm passionate about", replace: 'which is the part of this work I like most', reason: 'passionate' }] } }),
      rng: seededRng(F.SEED),
    });
    assert.ok(!('skipped' in r.result), JSON.stringify(r.result));
  });
  const invented = R.LETTER_STORY_DRAFT.replace('It posts about 400 entries a day', 'It posts about 4,000 entries a day');
  await check('an invented metric the rewrite does not remove → truth lock skips the job', async () => {
    const inventedFinal = invented.replace(R.HUMANIZE_FIND, R.HUMANIZE_REPLACE);
    const { calls } = await skippedRun({ critic: storyOnly, letters: withStory(invented), truth_fix: fixed(inventedFinal), audit_recheck: canned.audit }, /^truth lock: 4,000/);
    assert.deepEqual(calls.filter((c) => c.startsWith('audit')), ['audit', 'audit_recheck']);
  });
  await check('an invented metric fixed by the one rewrite → re-audited, re-scored and written', async () => {
    F.seedScenario();
    const calls: string[] = [];
    const r = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { ai: fakeAi({ critic: storyOnly, letters: withStory(invented), truth_fix: fixed(R.LETTER_STORY), audit_recheck: canned.audit }, calls), rng: seededRng(F.SEED) });
    assert.ok(!('skipped' in r.result), JSON.stringify(r.result));
    assert.ok(calls.includes('truth_fix') && calls.includes('critic_final'));
    assert.equal((r.result as { coverLetter: string }).coverLetter, R.LETTER_STORY);
  });
  await check('an auditor-only finding (code clean) still blocks the job', async () => {
    const auditorHigh = { issues: [{ claim: 'balance sheet on his phone', reason: 'Not supported by any fact.', severity: 'high' }] };
    await skippedRun({ audit: auditorHigh, truth_fix: fixed(R.LETTER_STORY), audit_recheck: auditorHigh }, /^truth lock: balance sheet/);
  });
  await check('a final critic score under 5 after edits → skipped (the gate holds on the saved text)', async () => {
    await skippedRun({ critic: storyOnly, critic_final: { variants: [{ strategy: 'story', score: 4.2, scores: { specificity: 4, evidence: 5, voice: 4, clarity: 5, ask: 4, aiTells: 4 }, demands: [] }], bestSubject: 1 } }, /^critic: final letter scored 4\.2/);
  });
  await check('volume mode: one letter, no critic or paid auditor, and one CV per role reused across jobs', async () => {
    F.seedScenario();
    const opts = (calls: string[]) => ({ ai: fakeAi({}, calls), rng: seededRng(F.SEED), mode: 'volume' as const, roles: ['Backend Engineer'] });
    const calls: string[] = [];
    const r = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, opts(calls));
    assert.ok(!('skipped' in r.result), JSON.stringify(r.result));
    const p = r.result as { mode?: string; quality: { critic: unknown; lint: { pass: boolean }; truth: { pass: boolean } } };
    assert.equal(p.mode, 'volume');
    assert.equal(p.quality.critic, null);
    assert.ok(p.quality.lint.pass && p.quality.truth.pass);
    assert.ok(!calls.some((c) => /critic|revise|audit/.test(c)), calls.join(', '));
    assert.equal(calls.filter((c) => c === 'cv').length, 1);
    assert.equal(get<{ n: number }>('SELECT count(*) AS n FROM letter_variants WHERE application_id = ?', r.applicationId!)?.n, 1);
    assert.equal(pipelineState(F.JOB_ID)?.state, 'written');
    // Jobs map to the campaign role by a distinctive word, never by "engineer" alone.
    const { roleKey } = await import('../../server/writer/roleCv.ts');
    const roles = ['Full Stack Developer (Junior)', 'Junior AI Engineer', 'Flutter Developer'];
    assert.equal(roleKey('Senior AI Engineer (LLM)', roles), roleKey('AI Engineer', roles));
    assert.equal(roleKey('Full-Stack Engineer (MERN)', roles), roleKey('Full Stack Developer', roles));
    assert.notEqual(roleKey('Backend Engineer', roles), roleKey('AI Engineer', roles));
    // The next job of the same role reuses the tailored CV: no CV call at all.
    const again: string[] = [];
    const r2 = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, opts(again));
    assert.ok(!('skipped' in r2.result), JSON.stringify(r2.result));
    assert.ok(!again.includes('cv'), again.join(', '));
  });
  await check('fewer than two voice-bank passages → skipped (letters are built from the candidate\'s writing)', async () => {
    F.seedScenario();
    run("DELETE FROM voice_bank WHERE id != 'vb-why-build'");
    refreshStyle();
    invalidateMasterProfile();
    const r = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { ai: noAi, rng: seededRng(F.SEED) });
    assert.match((r.result as { skipped: string }).skipped, /voice bank/);
  });
  await check('retryable errors return the job to selected; others mark it failed; unselected jobs are refused', async () => {
    F.seedScenario();
    await assert.rejects(() => writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { ai: fakeAi({ evidence: new AppError(402, 'BUDGET', 'budget') }), rng: seededRng(1) }));
    assert.equal(pipelineState(F.JOB_ID)?.state, 'selected');
    assert.equal(pipelineState(F.JOB_ID)?.attempts, 1);
    await assert.rejects(() => writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { ai: fakeAi({ evidence: new Error('boom') }), rng: seededRng(1) }));
    assert.equal(pipelineState(F.JOB_ID)?.state, 'failed');
    F.seedScenario({ state: 'none' });
    for (const s of ['found', 'filtered', 'scored'] as const) transition(F.JOB_ID, s, { campaignId: F.CAMPAIGN_ID });
    await assert.rejects(() => writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { ai: noAi }), (e: unknown) => e instanceof AppError && e.code === 'NOT_SELECTED');
  });

  // ── Letter only where the form has a field for it ─────────────────────────
  section('A04 writer: cover letter skipped only when the form is known to have no field for it');
  {
    const LN = await import('../../server/writer/letterNeed.ts');
    const jobUrl = 'https://jobs.daftarpay.example.net/backend-payments';
    const recipe = (id: string, scope: 'url' | 'company', key: string, steps: Record<string, unknown>[]) =>
      run(
        `INSERT OR REPLACE INTO form_recipes (id, ats, scope, scope_key, version, recipe, status, created_at, updated_at) VALUES (?, 'greenhouse', ?, ?, 1, ?, 'active', '2026-10-01', '2026-10-01')`,
        id,
        scope,
        key,
        JSON.stringify({ ats: 'greenhouse', scope, scopeKey: key, version: 1, status: 'active', match: {}, steps, hooks: [] }),
      );
    const fill = (labelNorm: string, valueKey: string, action = 'fill') => ({ action, fieldSignature: `sig-${valueKey}`, selectors: ['#x'], widget: 'text', valueSource: 'profile', valueKey, labelNorm });
    const GH_NO_LETTER = {
      questions: [
        { label: 'First Name', required: true, fields: [{ name: 'first_name', type: 'input_text' }] },
        { label: 'Resume/CV', required: true, fields: [{ name: 'resume', type: 'input_file' }, { name: 'resume_text', type: 'textarea' }] },
        { label: 'Why do you want to work here?', required: false, fields: [{ name: 'question_1', type: 'textarea' }] },
      ],
    };
    const GH_LETTER = { questions: [...GH_NO_LETTER.questions, { label: 'Cover Letter', required: false, fields: [{ name: 'cover_letter', type: 'input_file' }, { name: 'cover_letter_text', type: 'textarea' }] }] };
    const clean = () => {
      LN.forgetFormFacts(F.JOB_ID);
      run("DELETE FROM form_recipes WHERE id LIKE 'a04-ln-%'");
    };
    F.seedScenario();
    clean();

    await check('unknown form, email applications and "apply by email/DM" postings always get a letter', async () => {
      assert.deepEqual(await LN.letterNeed(F.JOB_ID), { needed: true, reason: 'the form is not known yet', source: null });
      LN.recordFormFacts(F.JOB_ID, LN.formFactsFromGreenhouse(GH_NO_LETTER)!);
      run("UPDATE jobs SET apply_email = 'jobs@daftarpay.example.net' WHERE id = ?", F.JOB_ID);
      assert.match((await LN.letterNeed(F.JOB_ID)).reason, /email application/);
      run('UPDATE jobs SET apply_email = NULL WHERE id = ?', F.JOB_ID);
      const m = get<{ match: string }>('SELECT match FROM jobs WHERE id = ?', F.JOB_ID)!.match;
      run('UPDATE jobs SET match = ? WHERE id = ?', JSON.stringify({ ...JSON.parse(m), explain: { applyChannel: 'dm' } }), F.JOB_ID);
      assert.equal((await LN.letterNeed(F.JOB_ID)).needed, true);
      run('UPDATE jobs SET match = ? WHERE id = ?', m, F.JOB_ID);
      clean();
    });
    await check('Greenhouse questions (?questions=true): no cover_letter field → skip; cover_letter / cover_letter_text → write', async () => {
      LN.recordFormFacts(F.JOB_ID, LN.formFactsFromGreenhouse(GH_NO_LETTER)!);
      const skip = await LN.letterNeed(F.JOB_ID);
      assert.equal(skip.needed, false);
      assert.equal(skip.source, 'greenhouse_api');
      LN.recordFormFacts(F.JOB_ID, LN.formFactsFromGreenhouse(GH_LETTER)!);
      assert.equal((await LN.letterNeed(F.JOB_ID)).needed, true);
      assert.equal(LN.formFactsFromGreenhouse({}), null);
      assert.equal(LN.formFactsFromGreenhouse({ questions: [] }), null);
      for (const label of ['Cover letter', 'Covering letter', 'Motivation letter', 'Anschreiben', 'Lettre de motivation']) assert.ok(LN.isLetterField({ label }), label);
      for (const label of ['Resume/CV', 'Why do you want to work here?', 'LinkedIn profile', 'Letter grade (GPA)']) assert.ok(!LN.isLetterField({ label }), label);
      clean();
    });
    await check("the form engine's proven recipe for this posting's URL counts; company-wide recipes do not", async () => {
      recipe('a04-ln-company', 'company', 'daftarpay', [fill('first name', 'firstName')]);
      assert.equal((await LN.letterNeed(F.JOB_ID)).needed, true, 'a company recipe is not knowledge of this form');
      recipe('a04-ln-url', 'url', jobUrl, [fill('first name', 'firstName'), fill('resume', 'cv', 'upload')]);
      const skip = await LN.letterNeed(F.JOB_ID);
      assert.equal(skip.needed, false);
      assert.equal(skip.source, 'recipe:a04-ln-url');
      recipe('a04-ln-url', 'url', jobUrl, [fill('first name', 'firstName'), fill('upload', 'letter', 'upload')]);
      assert.equal((await LN.letterNeed(F.JOB_ID)).needed, true);
      // Any source showing a letter field wins over one that does not.
      recipe('a04-ln-url', 'url', jobUrl, [fill('first name', 'firstName')]);
      LN.recordFormFacts(F.JOB_ID, LN.formFactsFromGreenhouse(GH_LETTER)!);
      assert.equal((await LN.letterNeed(F.JOB_ID)).needed, true);
      clean();
    });
    await check('off by default: without letter "auto" the writer writes the letter even when the form has no field', async () => {
      F.seedScenario();
      LN.recordFormFacts(F.JOB_ID, LN.formFactsFromGreenhouse(GH_NO_LETTER)!);
      const calls: string[] = [];
      const r = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { ai: fakeAi({}, calls), rng: seededRng(F.SEED) });
      assert.ok(!('skipped' in r.result), JSON.stringify(r.result));
      assert.ok(calls.includes('letters'));
      assert.ok((r.result as { coverLetter: string }).coverLetter.length > 200);
      clean();
    });
    await check('letter "auto", form known to have none: CV and short answers only, no letter calls, packet hands out', async () => {
      F.seedScenario();
      LN.recordFormFacts(F.JOB_ID, LN.formFactsFromGreenhouse(GH_NO_LETTER)!);
      const calls: string[] = [];
      const r = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { ai: fakeAi({}, calls), rng: seededRng(F.SEED), letter: 'auto' });
      assert.ok(!('skipped' in r.result), JSON.stringify(r.result));
      assert.ok(!calls.some((c) => /^(letters|critic|revise|humanize|lint_fix|critic_final|outreach_fix|follow_up_fix)/.test(c)), calls.join(', '));
      assert.ok(calls.includes('cv') && calls.includes('short_answers'), calls.join(', '));
      const p = ApplicationPacketSchema.parse(r.result);
      assert.equal(p.coverLetter, '');
      assert.equal(p.letterPdfPath, '');
      assert.equal(p.subject, '');
      assert.equal(p.outreach, '');
      assert.ok(fs.existsSync(p.cvPdfPath));
      assert.equal(p.quality.critic, null);
      assert.equal(p.quality.lint.checks[0].id, 'letter_not_needed');
      assert.ok(p.quality.truth.pass);
      assert.deepEqual(Object.keys(p.shortAnswers).sort(), ['tell us about a project', 'why this role', 'why us']);
      assert.equal(W.loadPacket(r.applicationId!)?.applicationId, r.applicationId);
      assert.equal(pipelineState(F.JOB_ID)?.state, 'written');
      const q = applicationQuality(r.applicationId!)!;
      assert.ok(q.writer.steps.some((s) => s.step === 'letter_need' && /^skip: the form has no cover-letter field/.test(s.detail)));
      assert.equal(get<{ n: number }>('SELECT count(*) AS n FROM letter_variants WHERE application_id = ?', r.applicationId!)?.n, 0);
      clean();
    });
    await check('letter "auto", form unknown: the letter is written exactly as before', async () => {
      F.seedScenario();
      clean();
      const calls: string[] = [];
      const r = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { ai: fakeAi({}, calls), rng: seededRng(F.SEED), letter: 'auto' });
      assert.ok(!('skipped' in r.result), JSON.stringify(r.result));
      assert.ok(calls.includes('letters') && calls.includes('critic'));
      assert.equal((r.result as { coverLetter: string }).coverLetter, R.LETTER_HOOK);
    });
  }

  // ── Unicode PDFs ──────────────────────────────────────────────────────────
  section('A04 writer: CV and letter PDFs in any script (embedded Noto Sans; Helvetica for Latin)');
  {
    const PT = await import('../../server/writer/pdfText.ts');
    const { renderLetterPdf } = await import('../../server/services/cvPdf.ts');
    const path = await import('node:path');
    const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
    const fontsOf = (buf: Buffer) => [...buf.toString('latin1').matchAll(/\/BaseFont \/([A-Za-z0-9+_-]+)/g)].map((m) => m[1]);
    await check('Latin CVs are unchanged: Helvetica only, nothing embedded, same one-page fit', async () => {
      assert.ok(PT.winAnsiSafe(JSON.stringify(cleanCv)), 'the fixture CV is plain WinAnsi');
      assert.ok(PT.winAnsiSafe('Café – “quoted” • €5 Œuvre š'));
      assert.ok(!PT.winAnsiSafe('Łukasz') && !PT.winAnsiSafe('محمد'));
      const r = await renderCvPdfWithPages(cleanCv);
      assert.equal(r.pages, 1);
      assert.deepEqual([...new Set(fontsOf(r.buffer))].sort(), ['Helvetica', 'Helvetica-Bold']);
      assert.ok(!r.buffer.toString('latin1').includes('/FontFile'), 'no embedded font in a Latin CV');
    });
    const intl = structuredClone(cleanCv);
    intl.name = 'محمد علی Łukasz Ωmega Дмитрий';
    intl.headline = 'Backend Engineer – Lahore / لاہور';
    intl.contact.location = 'لاہور, Pakistan';
    intl.skills[0].items = [...intl.skills[0].items.slice(0, 2), 'Ελληνικά', 'Tiếng Việt', 'Türkçe'];
    await check('a CV with an Urdu name and Polish, Greek, Cyrillic, Vietnamese and Turkish text renders with embedded Noto Sans and extracts', async () => {
      const r = await renderCvPdfWithPages(intl);
      assert.equal(r.pages, 1);
      const fonts = fontsOf(r.buffer);
      assert.ok(fonts.some((f) => /NotoSansArabic/.test(f)) && fonts.some((f) => /NotoSans-/.test(f)), fonts.join(', '));
      assert.ok(r.buffer.toString('latin1').includes('/FontFile2'), 'subset embedded');
      const got = flat((await extractText(new Uint8Array(r.buffer), { mergePages: true })).text as string);
      for (const s of ['Łukasz', 'Ωmega', 'Дмитрий', 'Ελληνικά', 'Tiếng Việt', 'Türkçe', 'Pakistan', 'SUMMARY', cleanCv.summary.slice(0, 40)]) assert.ok(got.includes(s), `missing: ${s}`);
      for (const word of ['محمد', 'علی', 'لاہور']) assert.ok(got.includes(word), `Arabic-script word not extracted: ${word}`);
      const letter = await renderLetterPdf('محمد علی', 'Dear team,\n\nسلام and hello.', 'm@example.com');
      const lt = flat((await extractText(new Uint8Array(letter), { mergePages: true })).text as string);
      assert.ok(lt.includes('Dear team') && lt.includes('سلام') && lt.includes('hello'));
    });
    await check('Arabic script: joined letter forms from the font, one-line runs in right-to-left word order, licences bundled', async () => {
      const fontkit = createRequire(import.meta.url)('fontkit') as { create(b: Buffer): { layout(s: string): { glyphs: { name: string }[] } } };
      const ar = fontkit.create(fs.readFileSync(path.join(PT.FONT_DIR, 'noto-sans-arabic-arabic-400-normal.woff')));
      const names = ar.layout('محمد').glyphs.map((g) => g.name);
      assert.ok(names.some((n) => /\.init$/.test(n)) && names.some((n) => /\.fina$/.test(n)), names.join(','));
      assert.deepEqual(PT.splitRuns('Ali (محمد علی) Khan').map((r) => [r.face, r.text]), [['latin', 'Ali ('], ['arabic', 'محمد علی'], ['latin', ') Khan']]);
      assert.equal(PT.visualOrder(' محمد علی '), ' علی محمد ');
      assert.equal(PT.splitRuns('Łódź').map((r) => r.face).join(','), 'latin-ext,latin,latin-ext');
      for (const f of ['LICENSE-NotoSans.txt', 'LICENSE-NotoSansArabic.txt']) assert.match(fs.readFileSync(path.join(PT.FONT_DIR, f), 'utf8'), /SIL Open Font License, Version 1\.1/);
    });
  }

  // ── Bandit ────────────────────────────────────────────────────────────────
  section('A04 writer: bandit learns from outcomes');
  F.seedScenario();
  const synth: string[] = [];
  const addOutcome = (i: number, strategy: string, len: string, replied: boolean, cls: string | null) => {
    const app = `a04-bandit-app-${i}`;
    const lv = `a04-bandit-lv-${i}`;
    synth.push(app);
    run("INSERT INTO applications (id, job_id, status, created_at, updated_at, variant_id) VALUES (?, ?, 'sent', '2026-10-01', '2026-10-01', ?)", app, F.JOB_ID, lv);
    run('INSERT INTO letter_variants (id, application_id, variant, style_tags, chosen) VALUES (?, ?, ?, ?, 1)', lv, app, strategy, JSON.stringify([`strategy:${strategy}`, `len:${len}`]));
    run('INSERT INTO outcomes (application_id, replied, reply_class, days_to_reply, updated_at) VALUES (?, ?, ?, ?, ?)', app, replied ? 1 : 0, cls, replied ? 3 : null, '2026-10-10');
  };
  await check('with no outcomes every arm is Beta(1,1)', () => {
    const s = B.banditStats();
    assert.ok(s.strategy.every((a) => a.alpha === 1 && a.beta === 1));
    assert.equal(s.outcomes, 0);
  });
  await check('arm stats update from outcome rows (a rejection is a reply but not a win)', () => {
    let i = 0;
    for (let k = 0; k < 20; k++) addOutcome(i++, 'story', 'short', k < 9, k < 9 ? 'interview_invite' : null);
    for (let k = 0; k < 20; k++) addOutcome(i++, 'hook', 'long', k < 4, k < 2 ? 'interview_invite' : k < 4 ? 'rejection' : null);
    for (let k = 0; k < 20; k++) addOutcome(i++, 'proof', 'medium', k < 2, k < 2 ? 'recruiter_question' : null);
    const s = B.banditStats();
    const arm = (n: string) => s.strategy.find((a) => a.arm === n)!;
    assert.deepEqual([arm('story').alpha, arm('story').beta], [10, 12]);
    assert.deepEqual([arm('hook').alpha, arm('hook').beta], [3, 19]);
    assert.deepEqual([arm('proof').alpha, arm('proof').beta], [3, 19]);
    assert.equal(s.length.find((a) => a.arm === 'short')!.successes, 9);
    assert.equal(s.outcomes, 60);
  });
  await check('choices favour the winning strategy and length while exploring about 20% of the time', () => {
    const rng = seededRng(99);
    const stats = B.banditStats();
    let story = 0;
    let explored = 0;
    let short = 0;
    const N = 3000;
    for (let k = 0; k < N; k++) {
      const p = B.pickStrategy([{ strategy: 'hook', score: 8.6 }, { strategy: 'proof', score: 8.5 }, { strategy: 'story', score: 8.4 }], rng, stats);
      if (p.choice === 'story') story++;
      if (p.explored) explored++;
      if (B.pickLength(rng, stats).choice === 'short') short++;
    }
    assert.ok(Math.abs(explored / N - 0.2) < 0.03, `explore rate ${explored / N}`);
    assert.ok(story / N > 0.75, `story chosen ${story / N}`);
    assert.ok(short / N > 0.7, `short chosen ${short / N}`);
  });
  await check('a variant far below the best critic score is never chosen, even by exploration', () => {
    const rng = seededRng(5);
    for (let k = 0; k < 500; k++) assert.notEqual(B.pickStrategy([{ strategy: 'hook', score: 9.5 }, { strategy: 'story', score: 8.0 }], rng).choice, 'story');
  });

  // ── Routes and report ─────────────────────────────────────────────────────
  section('A04 writer: routes and report');
  F.seedScenario();
  const done = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { rng: seededRng(F.SEED) });
  const id = done.applicationId!;
  const Fastify = (await import('fastify')).default;
  const { writerRoutes } = await import('../../server/writer/routes.ts');
  const app = Fastify();
  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message });
    return reply.status(500).send({ error: 'X', message: err.message });
  });
  await app.register(writerRoutes);
  await check('GET /api/writer/applications lists runs with critic, lint and truth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/writer/applications?limit=5' });
    assert.equal(res.statusCode, 200);
    const b = res.json() as { runs: { applicationId: string; critic: number; lintPass: boolean; truthPass: boolean }[]; totals: { written: number } };
    const r = b.runs.find((x) => x.applicationId === id)!;
    assert.ok(r.critic >= CRITIC_BAR && r.lintPass && r.truthPass);
  });
  await check('GET /api/writer/applications/:id, /variants, /cv.pdf and /letter.pdf', async () => {
    assert.equal((await app.inject({ method: 'GET', url: `/api/writer/applications/${id}` })).statusCode, 200);
    const v = (await app.inject({ method: 'GET', url: `/api/writer/applications/${id}/variants` })).json() as { variants: unknown[] };
    assert.equal(v.variants.length, 2);
    const pdf = await app.inject({ method: 'GET', url: `/api/writer/applications/${id}/cv.pdf` });
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await app.inject({ method: 'GET', url: `/api/writer/applications/${id}/letter.pdf` })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/writer/applications/nope' })).statusCode, 404);
  });
  await check('GET /api/writer/jobs/:jobId/packet, /bandit and /meta; POST /lint', async () => {
    const p = (await app.inject({ method: 'GET', url: `/api/writer/jobs/${F.JOB_ID}/packet` })).json() as { packet: { applicationId: string } };
    assert.equal(p.packet.applicationId, id);
    assert.equal((await app.inject({ method: 'GET', url: '/api/writer/jobs/nope/packet' })).statusCode, 404);
    const b = (await app.inject({ method: 'GET', url: '/api/writer/bandit' })).json() as { strategy: unknown[]; exploreRate: number };
    assert.equal(b.strategy.length, 3);
    assert.equal(b.exploreRate, 0.2);
    const m = (await app.inject({ method: 'GET', url: '/api/writer/meta' })).json() as { rules: unknown[]; criticBar: number };
    assert.equal(m.criticBar, 5);
    assert.ok(m.rules.length >= 15);
    const l = (await app.inject({ method: 'POST', url: '/api/writer/lint', payload: { text: R.LETTER_STORY, company: F.COMPANY, role: 'Backend Engineer, Payments' } })).json() as { lint: { pass: boolean } };
    assert.equal(l.lint.pass, true);
    assert.equal((await app.inject({ method: 'POST', url: '/api/writer/lint', payload: {} })).statusCode, 400);
  });
  await check('the quality report shows the run, its gates and the skip reasons', () => {
    const text = formatRuns(recentRuns(10));
    assert.match(text, /Daftar Pay/);
    assert.match(text, /written/);
    const d = formatDetail(applicationQuality(id)!);
    assert.match(d, /Evidence map:/);
    assert.match(d, /Lint \(chosen letter\):/);
    assert.match(d, /Truth lock: clean/);
  });
  await app.close();

  // ── Restore ───────────────────────────────────────────────────────────────
  for (const a of synth) run('DELETE FROM letter_variants WHERE application_id = ?', a);
  const myApps = all<{ id: string }>('SELECT id FROM applications WHERE job_id = ?', F.JOB_ID).map((r) => r.id);
  for (const a of myApps) run('DELETE FROM letter_variants WHERE application_id = ?', a);
  run('DELETE FROM outcomes');
  run('DELETE FROM jobs WHERE id = ?', F.JOB_ID);
  const restore = (table: string, rows: Record<string, unknown>[]) => {
    run(`DELETE FROM ${table}`);
    for (const r of rows) {
      const cols = Object.keys(r);
      run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...(Object.values(r) as never[]));
    }
  };
  restore('profile', saved.profile);
  restore('profile_facts', saved.facts);
  restore('voice_bank', saved.voice);
  restore('learning_list', saved.learning);
  restore('outcomes', saved.outcomes);
  run("DELETE FROM settings WHERE key IN ('profile.links', 'profile.hiddenFacts', 'profile.style')");
  for (const s of saved.settings) run('INSERT INTO settings (key, value) VALUES (?, ?)', s.key as string, s.value as string);
  invalidateMasterProfile();
}
