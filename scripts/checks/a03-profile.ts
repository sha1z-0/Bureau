import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Harness } from '../lib/harness.ts';

/**
 * A03: master profile (facts and sync diff, GitHub, portfolio, LinkedIn), voice
 * bank and style fingerprint, answer bank (20 paraphrases), unknown question →
 * answer → bank → re-queue, learning list, company research, and the routes.
 * Offline: recorded fetchers (fixtures/github, portfolio, research, linkedin)
 * and replayed Claude responses (fixtures/claude/profile_sync, research).
 */
export default async function a03({ check, section }: Harness) {
  const S = await import('../a03/scenario.ts');
  const { db, get, now, run } = await import('../../server/db.ts');
  const { bus } = await import('../../server/services/bus.ts');
  const { saveProfile, DEFAULT_PREFERENCES } = await import('../../server/services/profileStore.ts');
  type Profile = import('../../server/services/profileStore.ts').Profile;
  const { MasterProfileSchema, StyleFingerprintSchema } = await import('../../server/contracts/profile.ts');
  const { ResearchBriefSchema } = await import('../../server/contracts/research.ts');
  const { transition, pipelineState } = await import('../../server/campaign/pipeline.ts');
  const P = await import('../../server/profile/index.ts');
  const { invalidateMasterProfile } = await import('../../server/profile/master.ts');
  const facts = await import('../../server/profile/facts.ts');
  const { syncCvFacts } = await import('../../server/profile/cv.ts');
  const { recordedFetcher } = await import('../../server/profile/fetch.ts');
  const { syncGithub, storedGithub, readmeText } = await import('../../server/profile/github.ts');
  const { crawlSite, parseRobots, syncPortfolio } = await import('../../server/profile/portfolio.ts');
  const { importLinkedInExport, importLinkedInText, parseCsv } = await import('../../server/profile/linkedin.ts');
  const { setLinks, githubLogin, linksFromProfile } = await import('../../server/profile/links.ts');
  const answers = await import('../../server/profile/answers.ts');
  const { normalizeQuestion, detectIntent } = await import('../../server/profile/questions.ts');
  const voice = await import('../../server/profile/voice.ts');
  const learning = await import('../../server/profile/learning.ts');
  const { isNearVerbatim } = await import('../../server/profile/text.ts');
  const { researchCompany, cachedBrief, companyKey, cleanDomain } = await import('../../server/research/index.ts');
  const { parseResearch, finalizeBrief, extractJson } = await import('../../server/research/parse.ts');
  const { defaultAi } = await import('../../server/profile/ai.ts');
  type AiClient = import('../../server/profile/ai.ts').AiClient;
  const { zipSync, strToU8 } = await import('fflate');

  /** A Claude client that must not be called (proves a path is cached or offline). */
  const noAi: AiClient = {
    structured: (async () => {
      throw new Error('Claude was called but should not have been');
    }) as AiClient['structured'],
    research: (async () => {
      throw new Error('Claude was called but should not have been');
    }) as AiClient['research'],
  };

  // Other check modules may have saved a profile: set it aside and restore it at the end.
  const savedProfile = get<{ data: string; updated_at: string }>('SELECT data, updated_at FROM profile WHERE id = 1');
  run('DELETE FROM profile');
  invalidateMasterProfile();

  const baseProfile = (over: Partial<Profile> = {}): Profile => ({
    name: 'Ayesha Khan',
    headline: 'Backend developer',
    email: 'ayesha@example.com',
    phone: '+92 300 0000000',
    location: 'Lahore, Pakistan',
    links: [
      { label: 'GitHub', url: 'https://github.com/ayesha-dev' },
      { label: 'Portfolio', url: 'https://ayesha.example.com/' },
      { label: 'LinkedIn', url: 'https://www.linkedin.com/in/ayesha-example' },
    ],
    summary: 'Backend developer who builds bookkeeping software.',
    yearsExperience: 1.5,
    seniority: 'junior',
    categories: ['web'],
    targetRoles: ['Backend Engineer'],
    coreStack: ['Go', 'PostgreSQL', 'TypeScript'],
    skills: ['Docker'],
    experience: [
      {
        role: 'Backend Developer',
        company: 'Khan Hardware',
        location: 'Lahore',
        start: 'Jan 2025',
        end: 'Present',
        bullets: ["Built the store's bookkeeping API in Go and PostgreSQL.", 'Cut month-end closing from 3 days to 2 hours.', 'Wrote the deployment scripts.'],
      },
    ],
    projects: [{ name: 'LedgerLite', link: 'https://github.com/ayesha-dev/ledgerlite', description: 'Double-entry bookkeeping API.', highlights: ['Runs a two-branch store.'] }],
    education: [{ school: 'FAST NUCES Lahore', degree: 'BS Computer Science', start: '2023', end: '2027', details: '' }],
    certifications: ['AWS Certified Cloud Practitioner'],
    languages: ['English', 'Urdu'],
    achievements: [],
    voice: '',
    cvMarkdown: '# Ayesha Khan',
    portfolioNotes: '',
    preferences: { ...DEFAULT_PREFERENCES },
    ...over,
  });

  // ── Master profile ─────────────────────────────────────────────────────────
  section('A03 master profile');
  await check('loadMasterProfile() is null before a CV is uploaded', () => assert.equal(P.loadMasterProfile(), null));

  const profileA = baseProfile();
  saveProfile(profileA);
  syncCvFacts(profileA, 'CV: ayesha-v1.pdf');
  const manual = facts.addManualFact({ kind: 'achievement', text: 'Organised the campus Go meetup for a year.' });

  await check('a CV becomes sourced facts, one per line, each citing the CV', () => {
    const cv = facts.listFacts({ source: 'cv' });
    assert.ok(cv.length >= 12, `only ${cv.length} cv facts`);
    assert.ok(cv.every((f) => f.sourceRef.startsWith('CV: ayesha-v1.pdf')));
    assert.ok(cv.some((f) => f.text === 'Cut month-end closing from 3 days to 2 hours.' && f.kind === 'metric'));
  });

  await check('sync diff: a new CV adds facts and removed bullets deactivate; manual facts untouched', async () => {
    const kept = facts.listFacts({ source: 'cv' }).find((f) => f.text === "Built the store's bookkeeping API in Go and PostgreSQL.")!;
    const profileB = baseProfile({
      skills: ['Docker', 'Kafka'],
      experience: [
        {
          ...profileA.experience[0],
          bullets: ["Built the store's bookkeeping API in Go and PostgreSQL.", 'Cut month-end closing from 3 days to 2 hours.', 'Added VAT reporting used for quarterly filings.'],
        },
      ],
    });
    saveProfile(profileB);
    const report = await P.syncProfile({ parts: ['cv'], reextract: false });
    assert.equal(report.parts.cv?.status, 'ok');
    assert.equal(report.added, 2, 'Kafka and the VAT bullet');
    assert.equal(report.deactivated, 1, 'the deployment-scripts bullet');
    const all = facts.listFacts({ source: 'cv' });
    assert.equal(all.find((f) => f.text === 'Wrote the deployment scripts.')?.active, false);
    assert.equal(all.find((f) => f.text === 'Added VAT reporting used for quarterly filings.')?.active, true);
    const same = all.find((f) => f.id === kept.id)!;
    assert.equal(same.addedAt, kept.addedAt, 'unchanged facts keep their id and date');
    assert.equal(facts.getFact(manual.id)?.active, true);
  });

  await check('re-syncing an unchanged CV changes nothing', async () => {
    const report = await P.syncProfile({ parts: ['cv'], reextract: false });
    assert.equal(report.added + report.deactivated + report.reactivated, 0);
  });

  await check('a fact the owner hides stays hidden through later syncs; rewording a synced fact makes a manual one', async () => {
    const target = facts.listFacts({ source: 'cv' }).find((f) => f.text === 'Kafka')!;
    facts.updateFact(target.id, { active: false });
    await P.syncProfile({ parts: ['cv'], reextract: false });
    assert.equal(facts.getFact(target.id)?.active, false);
    assert.equal(facts.getFact(target.id)?.hidden, true);
    const vat = facts.listFacts({ source: 'cv' }).find((f) => f.text.startsWith('Added VAT'))!;
    const edited = facts.updateFact(vat.id, { text: 'Added VAT reporting for quarterly tax filings.' });
    assert.equal(edited.source, 'manual');
    assert.equal(facts.getFact(vat.id)?.active, false);
    await P.syncProfile({ parts: ['cv'], reextract: false });
    assert.equal(facts.getFact(edited.id)?.active, true, 'the owner’s edit survives the sync');
    assert.equal(facts.getFact(vat.id)?.active, false);
  });

  await check('every fact carries its source and source reference for the UI', () => {
    const list = facts.listFacts();
    assert.ok(list.length > 0);
    for (const f of list) {
      assert.ok(['cv', 'github', 'portfolio', 'manual', 'linkedin'].includes(f.source), f.id);
      assert.ok(f.sourceRef.length > 0, `${f.id} has no sourceRef`);
    }
  });

  await check('loadMasterProfile() validates against the contract and reflects writes immediately', () => {
    const mp = P.loadMasterProfile();
    assert.ok(mp);
    MasterProfileSchema.parse(mp);
    assert.ok(mp.facts.every((f) => f.active));
    assert.equal(mp.links.github, 'https://github.com/ayesha-dev');
    const before = mp.facts.length;
    facts.addManualFact({ kind: 'skill', text: 'gRPC' });
    assert.equal(P.loadMasterProfile()!.facts.length, before + 1);
  });

  await check('loadMasterProfile() is cheap enough to call per job (cached)', () => {
    P.loadMasterProfile();
    const t = performance.now();
    for (let i = 0; i < 300; i++) P.loadMasterProfile();
    const ms = performance.now() - t;
    assert.ok(ms < 1500, `300 calls took ${ms.toFixed(0)} ms`);
  });

  await check('links: derived from the CV, owner overrides win; GitHub logins parse', () => {
    const l = linksFromProfile(profileA);
    assert.equal(l.portfolio, 'https://ayesha.example.com/');
    assert.equal(l.linkedin, 'https://www.linkedin.com/in/ayesha-example');
    assert.equal(githubLogin('https://github.com/ayesha-dev/'), 'ayesha-dev');
    assert.equal(githubLogin('github.com/octo-cat'), 'octo-cat');
    assert.equal(githubLogin('https://github.com/-bad-'), null);
    setLinks({ portfolio: S.PORTFOLIO_URL });
    assert.equal(P.loadMasterProfile()!.links.portfolio, S.PORTFOLIO_URL);
  });

  await check('the verbatim guard keeps quotes and drops embellishment', () => {
    const src = 'I cut month-end closing from 3 days to 2 hours using Go.';
    assert.ok(isNearVerbatim('Cut month-end closing from 3 days to 2 hours.', src));
    assert.ok(!isNearVerbatim('Cut month-end closing from 3 days to 1 hour.', src));
    assert.ok(!isNearVerbatim('Led a team of engineers to cut closing time using Kubernetes.', src));
  });

  // ── GitHub ─────────────────────────────────────────────────────────────────
  section('A03 GitHub sync');
  await check('README markdown is reduced to prose (no code, badges, HTML comments)', () => {
    const t = readmeText(fs.readFileSync(path.join(S.GITHUB_DIR, 'readme-ledgerlite.md'), 'utf8'));
    assert.ok(t.includes('double-entry bookkeeping API'));
    assert.ok(!t.includes('go install') && !t.includes('shields.io') && !t.includes('Kubernetes'));
  });

  const ghFetch = recordedFetcher(S.GITHUB_DIR);
  await check('own repos and meaningful forks become project facts with links; fabricated README claims are dropped', async () => {
    const r = await syncGithub({ login: S.GITHUB_LOGIN, fetcher: ghFetch, ai: defaultAi, now: S.NOW, token: null });
    assert.equal(r.status, 'ok', r.message);
    assert.match(r.message, /1 unverifiable/);
    const gh = facts.listFacts({ source: 'github', active: true });
    const texts = gh.map((f) => f.text);
    assert.ok(texts.includes('ledgerlite: Double-entry bookkeeping API for small shops, built with Go and PostgreSQL'));
    assert.ok(texts.includes('tokio-tracing-fix: Fork of tracing with a fix for span leaks across await points'), 'fork with 4 own commits counts');
    assert.ok(!texts.some((t) => t.startsWith('react:')), 'fork with 1 docs commit does not');
    assert.ok(!texts.some((t) => /dotfiles|empty-idea/.test(t)), 'stale and empty repos are not notable');
    assert.ok(texts.includes('Handles 3 years of transactions for 2 shops with sub-50ms queries on a $5 VPS'));
    assert.ok(!texts.some((t) => /10,000/.test(t)), 'the fabricated claim is gone');
    assert.ok(!texts.some((t) => /Kubernetes/.test(t)), 'the README prompt injection never became a fact');
    assert.ok(texts.includes('Go') && texts.includes('Rust') && texts.includes('TypeScript'), 'languages become skills');
    assert.ok(gh.filter((f) => f.kind === 'project').every((f) => f.sourceRef.startsWith('https://github.com/ayesha-dev/')));
  });

  await check('the GitHub summary keeps languages, topics, stars and recent commit activity', () => {
    const s = storedGithub()!;
    assert.equal(s.login, 'ayesha-dev');
    const ledger = s.repos.find((r) => r.name === 'ledgerlite')!;
    assert.deepEqual(ledger.languages.slice(0, 2), ['Go', 'PLpgSQL']);
    assert.equal(ledger.stars, 42);
    assert.equal(ledger.recentCommits, 3);
    assert.ok(ghFetch.requests.every((u) => u.startsWith('https://api.github.com/')));
    assert.ok(!ghFetch.requests.some((u) => u.includes('/repos/ayesha-dev/react/readme')), 'excluded fork READMEs are not even fetched');
  });

  await check('a second sync with unchanged READMEs makes no Claude call', async () => {
    const r = await syncGithub({ login: S.GITHUB_LOGIN, fetcher: recordedFetcher(S.GITHUB_DIR), ai: noAi, now: S.NOW, token: null });
    assert.equal(r.status, 'ok', r.message);
    assert.equal(r.added + r.deactivated, 0);
  });

  await check('a rate-limited GitHub fails that part only and keeps yesterday’s facts', async () => {
    const before = facts.listFacts({ source: 'github', active: true }).length;
    const limited = async (url: string) => ({ ok: false, status: 403, url, contentType: 'application/json', text: () => '{"message":"API rate limit exceeded"}', json: <T>() => ({}) as T });
    await assert.rejects(syncGithub({ login: S.GITHUB_LOGIN, fetcher: limited, ai: noAi, now: S.NOW, token: null }), /rate limit/);
    assert.equal(facts.listFacts({ source: 'github', active: true }).length, before);
  });

  // ── Portfolio ──────────────────────────────────────────────────────────────
  section('A03 portfolio crawl');
  await check('robots.txt groups and longest-match rules', () => {
    const ok = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /drafts/\nAllow: /drafts/public\n');
    assert.equal(ok('/projects'), true);
    assert.equal(ok('/drafts/x'), false);
    assert.equal(ok('/drafts/public/y'), true);
  });

  await check('the crawl stays on the site, honours robots.txt, skips assets and drops tracking params', async () => {
    const f = recordedFetcher(S.PORTFOLIO_DIR);
    const crawl = await crawlSite(S.PORTFOLIO_URL, f);
    const urls = crawl.pages.map((p) => p.url);
    assert.deepEqual(urls.sort(), ['https://ayesha.example.com/', 'https://ayesha.example.com/about', 'https://ayesha.example.com/blog/span-leak', 'https://ayesha.example.com/projects', 'https://ayesha.example.com/projects/ledgerlite']);
    assert.ok(!f.requests.some((u) => u.includes('/drafts/')), 'disallowed by robots.txt');
    assert.ok(!f.requests.some((u) => /resume\.pdf|style\.css|github\.com|mailto/.test(u)));
    assert.deepEqual(crawl.gone, ['https://ayesha.example.com/old-talk']);
    assert.equal(crawl.disallowed, 1);
    const about = crawl.pages.find((p) => p.url.endsWith('/about'))!;
    assert.ok(!/principal engineer/i.test(about.text), 'hidden text is stripped before Claude sees it');
  });

  await check('portfolio pages become near-verbatim facts citing their page; unsourced claims are dropped', async () => {
    const r = await syncPortfolio({ url: S.PORTFOLIO_URL, fetcher: recordedFetcher(S.PORTFOLIO_DIR), ai: defaultAi });
    assert.equal(r.status, 'ok', r.message);
    const pf = facts.listFacts({ source: 'portfolio', active: true });
    assert.ok(pf.some((f) => f.text.startsWith('Won first place at the FAST NUCES') && f.sourceRef === 'https://ayesha.example.com/projects'));
    assert.ok(pf.some((f) => f.sourceRef === 'https://ayesha.example.com/about' && f.kind === 'education'));
    assert.ok(!pf.some((f) => /GopherCon/.test(f.text)), 'claim citing an unread page dropped');
    assert.ok(!pf.some((f) => /principal engineer/i.test(f.text)));
  });

  await check('an unchanged site re-syncs without Claude', async () => {
    const r = await syncPortfolio({ url: S.PORTFOLIO_URL, fetcher: recordedFetcher(S.PORTFOLIO_DIR), ai: noAi });
    assert.equal(r.added + r.deactivated, 0, r.message);
  });

  // ── LinkedIn ───────────────────────────────────────────────────────────────
  section('A03 LinkedIn import');
  await check('CSV parsing handles quotes, commas and newlines in fields', () => {
    const rows = parseCsv('a,b\n"x, y","line1\nline2 ""q"""\n');
    assert.deepEqual(rows, [['a', 'b'], ['x, y', 'line1\nline2 "q"']]);
  });

  await check('the official export zip becomes facts; files about other people are ignored', () => {
    const csv = (n: string) => strToU8(fs.readFileSync(path.join(S.LINKEDIN_DIR, n), 'utf8'));
    const zip = Buffer.from(
      zipSync({
        'Basic_LinkedInDataExport/Positions.csv': csv('Positions.csv'),
        'Basic_LinkedInDataExport/Education.csv': csv('Education.csv'),
        'Basic_LinkedInDataExport/Skills.csv': csv('Skills.csv'),
        'Basic_LinkedInDataExport/Certifications.csv': csv('Certifications.csv'),
        'Basic_LinkedInDataExport/Connections.csv': csv('Connections.csv'),
      }),
    );
    const r = importLinkedInExport(zip, 'export.zip');
    assert.ok(r.added >= 10, r.message);
    assert.ok(!r.files.includes('Connections.csv'));
    const li = facts.listFacts({ source: 'linkedin', active: true });
    assert.ok(li.some((f) => f.text === 'Backend Developer (part-time) at Khan Hardware, Lahore, Pakistan (Jan 2025 – Present)'));
    assert.ok(li.some((f) => f.text === 'Wrote integration tests for a payments SDK, raising coverage from 41% to 78%.' && f.kind === 'metric'));
    assert.ok(li.some((f) => f.text === 'BS Computer Science, FAST NUCES Lahore (2023 – 2027)'));
    assert.ok(!li.some((f) => /private/i.test(f.text)), 'no connection data');
  });

  await check('re-importing one CSV only retires facts from that file', () => {
    const before = facts.listFacts({ source: 'linkedin', active: true }).length;
    const r = importLinkedInExport(Buffer.from('Name\nGo\nPostgreSQL\nTypeScript\n'), 'Skills.csv');
    assert.equal(r.deactivated, 1, 'Docker left Skills.csv');
    assert.equal(facts.listFacts({ source: 'linkedin', active: true }).length, before - 1);
  });

  await check('pasted profile text becomes verified facts (embellished numbers dropped)', async () => {
    const r = await importLinkedInText(fs.readFileSync(path.join(S.LINKEDIN_DIR, 'paste.txt'), 'utf8'), defaultAi);
    assert.equal(r.added, 4, r.message);
    assert.match(r.message, /1 unverifiable/);
    assert.ok(facts.listFacts({ source: 'linkedin' }).every((f) => !/4 hours/.test(f.text)));
  });

  // ── Full daily sync ────────────────────────────────────────────────────────
  section('A03 daily sync');
  await check('syncProfile runs every part; one failing source never blocks the others; manual facts survive', async () => {
    const manualBefore = facts.listFacts({ source: 'manual', active: true }).length;
    const report = await P.syncProfile({ fetcher: recordedFetcher(S.GITHUB_DIR, S.PORTFOLIO_DIR), ai: noAi, now: S.NOW, reextract: false });
    assert.equal(report.parts.cv?.status, 'ok');
    assert.equal(report.parts.github?.status, 'ok', report.parts.github?.message ?? '');
    assert.equal(report.parts.portfolio?.status, 'ok', report.parts.portfolio?.message ?? '');
    assert.equal(facts.listFacts({ source: 'manual', active: true }).length, manualBefore);
    assert.deepEqual(P.lastSync()?.finishedAt, report.finishedAt);
    // Portfolio offline today: GitHub and CV still sync, portfolio facts are kept.
    const portfolioFacts = facts.listFacts({ source: 'portfolio', active: true }).length;
    const broken = await P.syncProfile({ fetcher: recordedFetcher(S.GITHUB_DIR), ai: noAi, now: S.NOW, reextract: false });
    assert.equal(broken.parts.github?.status, 'ok');
    assert.equal(broken.parts.portfolio?.status, 'error');
    assert.equal(facts.listFacts({ source: 'portfolio', active: true }).length, portfolioFacts);
  });

  // ── Voice bank ─────────────────────────────────────────────────────────────
  section('A03 voice bank and style fingerprint');
  await check('eight suggested prompts ship', () => assert.equal(voice.SUGGESTED_PROMPTS.length, 8));

  await check('the fingerprint measures sentence length, contractions, first person and connectives', () => {
    const fp = voice.fingerprintOf(["I started building things because our shop's ledger kept losing money. So I wrote a tiny app. It wasn't pretty, but it worked, and my dad still uses it."]);
    StyleFingerprintSchema.parse(fp);
    assert.equal(fp.words, 29);
    assert.equal(fp.sentenceLenMean, 9.67);
    assert.ok(fp.sentenceLenStd > 2.5 && fp.sentenceLenStd < 3);
    assert.equal(fp.contractionRate, 0.0345, 'wasn’t counts, shop’s (possessive) does not');
    assert.equal(fp.firstPersonRate, 0.1034);
    for (const c of ['because', 'so', 'but', 'still']) assert.ok(fp.connectives.includes(c), c);
  });

  await check('voice CRUD keeps the stored fingerprint current and exposes it to the writer', () => {
    assert.equal(P.styleFingerprint(), null);
    const a = voice.addVoice({ prompt: voice.SUGGESTED_PROMPTS[0].prompt, text: "I build because I like seeing a shop run smoother. It's that simple, honestly." });
    const fp1 = P.styleFingerprint()!;
    assert.equal(fp1.passages, 1);
    voice.addVoice({ prompt: voice.SUGGESTED_PROMPTS[2].prompt, text: 'The bug only showed up after midnight. Turns out the timezone offset flipped, so totals drifted by a day.' });
    assert.equal(P.styleFingerprint()!.passages, 2);
    voice.updateVoice(a.id, { text: 'I build because I like seeing a shop run smoother.' });
    assert.notDeepEqual(P.styleFingerprint(), fp1);
    assert.equal(P.loadMasterProfile()!.style?.passages, 2);
    assert.equal(P.loadMasterProfile()!.voiceBank.length, 2);
  });

  // ── Learning list ──────────────────────────────────────────────────────────
  section('A03 learning list');
  await check('only `learning` items may be listed as currently learning', () => {
    const k = learning.addLearning({ skill: 'Kubernetes' });
    learning.addLearning({ skill: 'Rust', status: 'queued' });
    const done = learning.addLearning({ skill: 'Docker', status: 'learning' });
    learning.updateLearning(done.id, { status: 'done' });
    assert.deepEqual(P.learningSkills(), ['Kubernetes']);
    assert.ok(k.startedAt);
    assert.equal(learning.addLearning({ skill: 'kubernetes', notes: 'CKA prep' }).id, k.id, 'no duplicates');
    learning.updateLearning(learning.listLearning().find((i) => i.skill === 'Rust')!.id, { status: 'learning' });
    assert.deepEqual(P.learningSkills(), ['Kubernetes', 'Rust']);
  });

  // ── Answer bank ────────────────────────────────────────────────────────────
  section('A03 answer bank');
  await check('seeded with 25+ common questions plus years-of-experience per core skill', () => {
    const list = answers.listAnswers();
    const placeholders = list.filter((a) => a.placeholder);
    assert.ok(placeholders.length >= 25, `${placeholders.length} placeholders`);
    assert.ok(list.some((a) => a.questionRaw === 'How many years of experience do you have with Go?'));
    assert.equal(new Set(list.map((a) => `${a.questionNorm}|${JSON.stringify(a.scope)}`)).size, list.length, 'no duplicate questions');
  });

  await check('preference fields seed derived answers (and the owner overrides them)', async () => {
    saveProfile(baseProfile({ preferences: { ...DEFAULT_PREFERENCES, workAuthorization: 'Yes', needsSponsorship: false, noticePeriod: '1 month' } }));
    assert.equal((await P.answerFor('When could you start?'))?.value, '1 month');
    const sp = await P.answerFor('Will you need visa sponsorship?', { options: ['Yes', 'No'] });
    assert.equal(sp?.value, 'No');
    assert.ok(sp!.confidence >= 0.7 && sp!.confidence < 0.9, 'derived answers are a notch less certain');
  });

  const bank: [string, string][] = [
    ['What is your notice period?', 'Two weeks'],
    ['Will you now or in the future require visa sponsorship?', 'No'],
    ['Are you legally authorized to work in the country where this job is located?', 'Yes'],
    ['What are your salary expectations?', 'USD 60,000 per year'],
    ['Expected salary in PKR', 'PKR 450,000 per month'],
    ['Are you willing to relocate?', 'Yes'],
    ['How many years of experience do you have with React?', '3'],
    ['How many years of experience do you have with Python?', '2'],
    ['How did you hear about this position?', 'Company careers page'],
    ['Are you open to working on-site or hybrid?', 'Yes, hybrid works for me'],
    ['When will you complete your degree?', 'June 2027'],
    ['Tell us about a project you are proud of.', 'LedgerLite, the bookkeeping API that runs my family’s store.'],
    ['Why are you interested in this role?', 'I want to build payments software that small shops can rely on.'],
    ['What is your greatest strength?', 'Patience with messy legacy data.'],
    ['How many hours of overlap can you offer with US time zones?', '4 hours'],
  ];
  for (const [question, answer] of bank) answers.upsertAnswer({ question, answer });

  const paraphrases: [string, string][] = [
    ['Notice period (in weeks)', 'Two weeks'],
    ['When can you start?', 'Two weeks'],
    ['What is the earliest date you could join us?', 'Two weeks'],
    ['Do you need sponsorship for an employment visa?', 'No'],
    ['Will you require H-1B sponsorship now or in the future?', 'No'],
    ['Are you eligible to work in this country?', 'Yes'],
    ['Do you have the legal right to work where this role is based?', 'Yes'],
    ['What are your compensation expectations?', 'USD 60,000 per year'],
    ['Desired salary (PKR) *', 'PKR 450,000 per month'],
    ['Would you consider relocating for this job?', 'Yes'],
    ['Years of experience with React.js', '3'],
    ['How long have you worked with Python?', '2'],
    ['Where did you first learn about this opening?', 'Company careers page'],
    ['Is working from our office or a hybrid schedule okay for you?', 'Yes, hybrid works for me'],
    ['Expected graduation date', 'June 2027'],
    ["Describe a project you're proud of", 'LedgerLite, the bookkeeping API that runs my family’s store.'],
    ['Why are you interested in this position?', 'I want to build payments software that small shops can rely on.'],
    ['What would you say is your greatest strength?', 'Patience with messy legacy data.'],
    ['How much overlap can you have with US working hours?', '4 hours'],
    ["What's your notice period? *", 'Two weeks'],
  ];
  await check(`fuzzy match: ${paraphrases.length} paraphrases resolve to the right stored answer`, async () => {
    const misses: string[] = [];
    for (const [q, expected] of paraphrases) {
      const a = await P.answerFor(q);
      if (a?.value !== expected) misses.push(`"${q}" → ${a ? `"${a.value}"` : 'null'} (norm: ${normalizeQuestion(q)})`);
      else if (a.confidence < 0.7) misses.push(`"${q}" matched with confidence ${a.confidence}`);
    }
    assert.deepEqual(misses, []);
  });

  await check('different questions are never answered with a near-miss', async () => {
    for (const q of [
      'How many years of experience do you have with Java?',
      'Are you a US citizen?',
      'What is your favourite colour?',
      'Desired salary (EUR)',
      'Are you authorized to work in the US without sponsorship?',
      'Have you previously worked for this company?',
    ]) {
      const a = await P.answerFor(q);
      assert.equal(a, null, `"${q}" answered with "${a?.value}"`);
    }
  });

  await check('answers map onto select options (yes/no, numeric ranges) or decline', async () => {
    assert.equal((await P.answerFor('Will you require sponsorship?', { options: ['Yes', 'No'] }))?.value, 'No');
    assert.equal((await P.answerFor('Years of React experience', { options: ['0-1 years', '2-3 years', '4-5 years', '6+ years'] }))?.value, '2-3 years');
    assert.equal((await P.answerFor('Are you willing to relocate?', { options: ['Yes, I am willing to relocate', 'No'] }))?.value, 'Yes, I am willing to relocate');
    assert.equal((await P.answerFor('Can you work on-site?', { options: ['Yes', 'No'] }))?.value, 'Yes');
    assert.equal(await P.answerFor('How did you hear about us?', { options: ['LinkedIn', 'Indeed', 'Referral'] }), null);
    assert.equal(answers.matchOption('5', ['Less than 1 year', '1 to 3 years', 'More than 3 years']), 'More than 3 years');
  });

  await check('a scope typed as a country code matches; a date field never gets "two weeks"', async () => {
    const pk = answers.upsertAnswer({ question: 'Are you authorized to work in Pakistan?', answer: 'Yes', scope: { countries: ['PK'] } });
    assert.deepEqual(pk.scope.countries, ['pakistan']);
    assert.equal((await P.answerFor('Are you legally authorized to work in Pakistan?', { options: ['Yes', 'No'] }))?.key, pk.id);
    answers.deleteAnswer(pk.id);
    // The bank's start answer is a duration, so a date picker gets nothing rather than a non-date.
    assert.ok((await P.answerFor('When can you start?'))?.value);
    assert.equal(await P.answerFor('When can you start?', { fieldKind: 'date' }), null);
  });

  const jobIn = (location: string) => {
    const id = crypto.randomUUID();
    run(
      `INSERT INTO jobs (id, fingerprint, source, url, title, company, location, category, found_at, updated_at) VALUES (?, ?, 'test', ?, 'Backend Engineer', 'Acme', ?, 'web', ?, ?)`,
      id,
      id,
      `https://example.com/jobs/${id}`,
      location,
      now(),
      now(),
    );
    return id;
  };

  await check('scope: a country-specific answer wins where it applies and nowhere else', async () => {
    answers.upsertAnswer({ question: 'Are you authorized to work in the UK?', answer: 'No' });
    answers.upsertAnswer({ question: 'What is your notice period?', answer: 'One month', scope: { countries: ['Germany'] } });
    const london = jobIn('London, UK');
    const berlin = jobIn('Berlin, Germany');
    assert.equal((await P.answerFor('Are you legally authorized to work in the country where this job is located?', { jobId: london }))?.value, 'No');
    assert.equal((await P.answerFor('Are you legally authorized to work in the country where this job is located?', { jobId: berlin }))?.value, 'Yes');
    assert.equal((await P.answerFor('Do you have the right to work in the UK?'))?.value, 'No');
    assert.equal((await P.answerFor('When can you start?', { jobId: berlin }))?.value, 'One month');
    assert.equal((await P.answerFor('When can you start?', { jobId: london }))?.value, 'Two weeks');
  });

  await check('the profile answers links, location and overall years', async () => {
    const li = await P.answerFor('LinkedIn profile URL');
    assert.equal(li?.value, 'https://www.linkedin.com/in/ayesha-example');
    assert.equal(li?.source, 'profile');
    assert.equal((await P.answerFor('Link to your GitHub'))?.value, 'https://github.com/ayesha-dev');
    assert.equal((await P.answerFor('Portfolio or personal website'))?.value, S.PORTFOLIO_URL);
    assert.equal((await P.answerFor('Where are you currently located?'))?.value, 'Lahore, Pakistan');
    assert.equal((await P.answerFor('How many years of professional experience do you have?'))?.value, '1.5');
  });

  await check('intent detection keeps opposite-meaning questions apart', () => {
    assert.equal(detectIntent('Do you require sponsorship?')?.key, 'sponsorship');
    assert.equal(detectIntent('Are you authorised to work in Germany?')?.countries?.[0], 'germany');
    assert.equal(detectIntent('Current and expected CTC'), null);
    assert.equal(detectIntent('Years of Node.js experience')?.skill, 'node');
    assert.equal(detectIntent('What programming languages do you know?'), null);
    assert.notEqual(normalizeQuestion('What is your notice period?'), normalizeQuestion('When can you start? *'));
  });

  await check('notice period and start date are separate answers; a start-date question falls back to the notice period in words', async () => {
    for (const q of ['Notice period (in weeks)', 'How much notice do you need to give?', 'How soon could you join us? Notice period', 'What is your notice period / earliest start date?'])
      assert.equal(detectIntent(q)?.key, 'notice_period', q);
    for (const q of ['When can you start?', 'Earliest start date', 'What is the earliest date you could join us?']) assert.equal(detectIntent(q)?.key, 'start_date', q);
    assert.ok(answers.COMMON_QUESTIONS.includes('What is your notice period?') && answers.COMMON_QUESTIONS.includes('What is your earliest start date?'));
    const start = answers.upsertAnswer({ question: 'What is your earliest start date?', answer: '2026-12-01' });
    try {
      assert.equal((await P.answerFor('What is your notice period?'))?.value, 'Two weeks', 'saving a start date keeps the notice period');
      assert.equal((await P.answerFor('When can you start?'))?.value, '2026-12-01');
      assert.equal((await P.answerFor('Earliest start date', { fieldKind: 'date' }))?.value, '2026-12-01');
    } finally {
      answers.updateAnswer(start.id, { answer: '' }); // back to the seeded placeholder
    }
    const fallback = await P.answerFor('When can you start?');
    assert.equal(fallback?.value, 'Two weeks', 'no start date saved: the notice period, in words');
    assert.ok(fallback!.confidence >= 0.7 && fallback!.confidence < 0.92, 'a notch less certain than a real start-date answer');
    assert.equal(await P.answerFor('Earliest start date', { fieldKind: 'date' }), null, 'a date field never gets the notice period');
  });

  await check('a notice period saved under the old shared key ("start date") is re-keyed and keeps resolving', async () => {
    const dublin = jobIn('Dublin, Ireland');
    const id = crypto.randomUUID();
    run("INSERT INTO answer_bank (id, question_norm, question_raw, answer, scope, source, created_at, updated_at) VALUES (?, 'start date', 'What is your notice period?', 'Six weeks', ?, 'owner', ?, ?)", id, JSON.stringify({ countries: ['ireland'] }), now(), now());
    const setNormVersion = (v: number) => run("INSERT INTO settings (key, value) VALUES ('profile.answerNormVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(v));
    setNormVersion(1);
    try {
      answers.migrateNorms(true);
      assert.equal(get<{ question_norm: string }>('SELECT question_norm FROM answer_bank WHERE id = ?', id)?.question_norm, 'notice period');
      assert.equal(get<{ value: string }>("SELECT value FROM settings WHERE key = 'profile.answerNormVersion'")?.value, '2');
      // Saving a start date for the same scope no longer replaces it.
      const start = answers.upsertAnswer({ question: 'When can you start?', answer: '2027-01-11', scope: { countries: ['Ireland'] } });
      assert.ok(answers.getAnswer(id), 'the old notice-period row survives a start-date save');
      assert.equal((await P.answerFor('What is your notice period?', { jobId: dublin }))?.value, 'Six weeks');
      assert.equal((await P.answerFor('When can you start?', { jobId: dublin }))?.value, '2027-01-11');
      run('DELETE FROM answer_bank WHERE id = ?', start.id);
    } finally {
      run('DELETE FROM answer_bank WHERE id = ?', id);
      setNormVersion(2);
    }
  });

  // ── Unknown questions, end to end ──────────────────────────────────────────
  section('A03 unknown questions → answer → bank → re-queue');
  const events: { type: string; questionId?: string; jobId?: string | null }[] = [];
  const onEvent = (e: { type: string }) => events.push(e);
  bus.on('event', onEvent);
  try {
    await check('recordUnknown → owner answers → saved to the bank → job back to selected → event emitted', async () => {
      const jobId = jobIn('Lahore, Pakistan');
      transition(jobId, 'found');
      transition(jobId, 'skipped', { reason: 'unknown_question' });
      const question = 'Do you have experience with PCI DSS compliance?';
      assert.equal(await P.answerFor(question, { jobId }), null);
      const qid = P.recordUnknown({ question, jobId, fieldKind: 'select', options: ['Yes', 'No'] });
      assert.equal(P.recordUnknown({ question, jobId, fieldKind: 'select' }), qid, 'recording twice is one question');
      assert.ok(P.listUnknown('open').some((q) => q.id === qid && q.job?.company === 'Acme'));
      const res = await P.answerUnknown(qid, { answer: 'No' });
      assert.deepEqual(res.requeued, [jobId]);
      assert.equal(pipelineState(jobId)?.state, 'selected');
      assert.ok(events.some((e) => e.type === 'question.answered' && e.questionId === qid && e.jobId === jobId));
      const a = await P.answerFor('Do you have any experience with PCI DSS compliance?', { jobId, options: ['Yes', 'No'] });
      assert.equal(a?.value, 'No');
      assert.ok(a!.confidence >= 0.9);
      assert.equal(P.listUnknown('open').some((q) => q.id === qid), false);
    });

    await check('a job waits until all its questions are answered; the same question on other jobs is answered together', async () => {
      const j1 = jobIn('Lahore');
      const j2 = jobIn('Karachi');
      for (const j of [j1, j2]) {
        transition(j, 'found');
        transition(j, 'skipped');
      }
      const q1 = P.recordUnknown({ question: 'Are you comfortable with on-call rotations?', jobId: j1, fieldKind: 'radio' });
      const q2 = P.recordUnknown({ question: 'What is your typing speed?', jobId: j1, fieldKind: 'text' });
      const q3 = P.recordUnknown({ question: 'What is your typing speed (wpm)?', jobId: j2, fieldKind: 'text' });
      void q3;
      const r1 = await P.answerUnknown(q1, { answer: 'Yes, one week in four' });
      assert.deepEqual(r1.requeued, [], 'j1 still has an open question');
      assert.equal(pipelineState(j1)?.state, 'skipped');
      const r2 = await P.answerUnknown(q2, { answer: '70 wpm' });
      assert.deepEqual(r2.requeued.sort(), [j1, j2].sort());
      assert.equal(pipelineState(j2)?.state, 'selected');
    });

    await check('a job that is mid-flight is never yanked back', async () => {
      const j = jobIn('Lahore');
      for (const s of ['found', 'filtered', 'scored', 'selected', 'writing'] as const) transition(j, s);
      const q = P.recordUnknown({ question: 'Do you hold a Series 7 licence?', jobId: j, fieldKind: 'radio' });
      const r = await P.answerUnknown(q, { answer: 'No' });
      assert.deepEqual(r.requeued, []);
      assert.equal(pipelineState(j)?.state, 'writing');
    });
  } finally {
    bus.off('event', onEvent);
  }

  // ── Research ───────────────────────────────────────────────────────────────
  section('A03 company research');
  await check('domains and company keys normalise; job boards are never a company site', () => {
    assert.equal(cleanDomain('https://www.Acme.com/careers'), 'acme.com');
    assert.equal(cleanDomain('careers.acme.io'), 'acme.io');
    assert.equal(cleanDomain('boards.greenhouse.io'), null);
    assert.equal(companyKey('Lumen Pay, Inc.'), companyKey('lumen pay'));
  });

  await check('research parser: a recorded response becomes a brief where every claim cites a URL that was read', async () => {
    const f = recordedFetcher(S.RESEARCH_DIR);
    const brief = await researchCompany(S.RESEARCH_COMPANY, S.RESEARCH_DOMAIN, { fetcher: f, now: S.NOW, force: true });
    ResearchBriefSchema.parse(brief);
    assert.equal(brief.domain, 'lumenpay.example.net');
    assert.equal(brief.products.length, 2, 'the product citing an unread blog is dropped');
    assert.deepEqual(
      brief.recent.map((r) => r.date),
      ['2026-09-15', '2026-09'],
      'news older than six months is dropped',
    );
    assert.equal(brief.hiringContact?.name, 'Sara Malik');
    assert.equal(brief.stage, 'Series A (2026)');
    for (const c of [...brief.products, ...brief.recent, ...brief.techSignals, ...brief.values]) assert.match(c.sourceUrl, /^https:\/\//);
    assert.ok(f.requests.includes('https://lumenpay.example.net/about'));
    assert.ok(!f.requests.some((u) => /pricing|twitter/.test(u)), 'only research-relevant own pages are fetched');
  });

  await check('briefs are cached for 14 days (no second Claude call)', async () => {
    const again = await researchCompany('Lumen Pay Inc.', 'https://www.lumenpay.example.net', { ai: noAi, fetcher: recordedFetcher(S.RESEARCH_DIR), now: S.NOW });
    assert.equal(again.company, 'Lumen Pay');
    assert.ok(cachedBrief('Lumen Pay'));
    run("UPDATE research_briefs SET fetched_at = '2020-01-01T00:00:00.000Z'");
    await assert.rejects(researchCompany('Lumen Pay', S.RESEARCH_DOMAIN, { ai: noAi, fetcher: recordedFetcher(S.RESEARCH_DIR), now: S.NOW }), /should not have been/);
  });

  await check('hiring contacts only from the posting or the company’s own pages; JSON found without a fence', () => {
    const ctx = { company: 'X', domain: 'x.com', readUrls: ['https://news.example.com/a'], postingUrl: 'https://boards.greenhouse.io/x/jobs/1', now: S.NOW };
    const fromLinkedIn = finalizeBrief({ hiringContact: { name: 'Jo', role: 'EM', sourceUrl: 'https://www.linkedin.com/in/jo' } }, ctx);
    assert.equal(fromLinkedIn.brief.hiringContact, null);
    const fromPosting = finalizeBrief({ hiringContact: { name: 'Jo', role: 'EM', sourceUrl: 'https://boards.greenhouse.io/x/jobs/1' } }, ctx);
    assert.equal(fromPosting.brief.hiringContact?.name, 'Jo');
    const parsed = parseResearch('Notes first. {"whatTheyBuild":"Tools","products":[{"text":"A","sourceUrl":"https://news.example.com/a/"}]} done', ctx);
    assert.equal(parsed?.brief.products.length, 1);
    assert.equal(extractJson('no json here'), null);
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  section('A03 routes');
  await check('the UI routes serve the profile, facts, voice, answers, questions and research', async () => {
    const Fastify = (await import('fastify')).default;
    const { AppError } = await import('../../server/errors.ts');
    const { masterProfileRoutes } = await import('../../server/profile/routes.ts');
    const { researchRoutes } = await import('../../server/research/routes.ts');
    const app = Fastify();
    app.setErrorHandler((err: Error, _req, reply) => reply.status(err instanceof AppError ? err.status : 500).send({ error: (err as { code?: string }).code ?? 'INTERNAL', message: err.message }));
    await app.register(masterProfileRoutes);
    await app.register(researchRoutes);
    try {
      const master = (await app.inject({ method: 'GET', url: '/api/master' })).json();
      MasterProfileSchema.parse(master.profile);
      const fl = (await app.inject({ method: 'GET', url: '/api/master/facts?source=github&active=true' })).json();
      assert.ok(fl.facts.length > 0 && fl.facts.every((f: { source: string }) => f.source === 'github'));
      const v = await app.inject({ method: 'POST', url: '/api/master/voice', payload: { prompt: 'Why this field?', text: 'Because money bugs hurt real people.' } });
      assert.equal(v.statusCode, 200);
      assert.equal(v.json().style.passages, 3);
      const jobId = jobIn('Lahore');
      transition(jobId, 'found');
      transition(jobId, 'skipped');
      const qid = P.recordUnknown({ question: 'Do you speak Arabic?', jobId, fieldKind: 'radio' });
      const qs = (await app.inject({ method: 'GET', url: '/api/master/questions' })).json();
      assert.ok(qs.questions.some((q: { id: string }) => q.id === qid));
      const ans = await app.inject({ method: 'POST', url: `/api/master/questions/${qid}/answer`, payload: { answer: 'Basic' } });
      assert.equal(ans.statusCode, 200);
      assert.deepEqual(ans.json().requeued, [jobId]);
      const t = (await app.inject({ method: 'POST', url: '/api/master/answers/test', payload: { question: 'Do you speak Arabic?' } })).json();
      assert.equal(t.answer.value, 'Basic');
      assert.equal((await app.inject({ method: 'POST', url: '/api/master/facts', payload: { kind: 'nonsense', text: 'x' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'GET', url: '/api/research?company=Nobody%20Corp' })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: '/api/research/briefs' })).json().briefs.length, 1);
      const lr = (await app.inject({ method: 'GET', url: '/api/master/learning' })).json();
      assert.ok(lr.items.length >= 3);
    } finally {
      await app.close();
    }
  });

  // Put back whatever profile was here before.
  run('DELETE FROM profile');
  if (savedProfile) run('INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)', savedProfile.data, savedProfile.updated_at);
  invalidateMasterProfile();
  void db;
}
