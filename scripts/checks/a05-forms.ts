import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Harness } from '../lib/harness.ts';

/**
 * A05 form engine. Offline: A11's local fixture server, replay mode, the seeded
 * candidate. Units first (dictionary, normalisation, detection, mapping,
 * recipes, guard), then the engine on every ATS replica and widget page with
 * the shared browser, then the guarantees: zero submissions without
 * verification, unknown questions to the answer-bank loop, evidence on disk,
 * recipes used first / healed / demoted, accounts, abort.
 */
export default async function a05({ check, section, sandbox, sharedBrowser }: Harness) {
  const { synonymCount, matchSynonym } = await import('../../server/forms/synonyms.ts');
  const N = await import('../../server/forms/normalize.ts');
  const { detectAts, effectiveUrl } = await import('../../server/forms/detect.ts');
  const { splitLocation, splitPhone, splitDegree, candidateFrom } = await import('../../server/forms/candidate.ts');
  const { PAGE_LIB } = await import('../../server/forms/page.ts');
  const { generatePassword, FORBIDDEN_ACCOUNT_HOSTS, getAccount } = await import('../../server/forms/accounts.ts');
  const { mapFieldsWith } = await import('../../server/forms/map.ts');
  const R = await import('../../server/forms/recipes.ts');
  const { urlAllowed, allowFixtureOrigins } = await import('../../server/forms/browser.ts');
  const { runFill, submitVerified, UnverifiedSubmitError } = await import('../../server/forms/engine.ts');
  const { ADAPTERS } = await import('../../server/forms/adapters/index.ts');
  const { all, get, run } = await import('../../server/db.ts');
  type FormField = import('../../server/contracts/forms.ts').FormField;
  type Packet = import('../../server/contracts/writer.ts').ApplicationPacket;

  section('A05 forms: dictionary, normalisation, detection');
  await check('synonym dictionary has 300+ label variants', () => assert.ok(synonymCount() >= 300, `only ${synonymCount()}`));
  await check('synonyms: names, links, group-scoped dates, attestations', () => {
    assert.equal(matchSynonym(N.labelNorm('First Name *'))?.entry.key, 'first_name');
    assert.equal(matchSynonym(N.labelNorm('Your LinkedIn URL (optional)'))?.entry.key, 'linkedin');
    assert.equal(matchSynonym(N.labelNorm('Start date'), 'work')?.entry.key, 'work_start');
    assert.equal(matchSynonym(N.labelNorm('Start date'))?.entry.key, 'start_date');
    assert.equal(matchSynonym(N.labelNorm('Will you now or in the future require visa sponsorship?'))?.entry.attestation, true);
    assert.equal(matchSynonym(N.labelNorm('Social Security Number'))?.entry.source, 'never');
    assert.equal(matchSynonym(N.labelNorm('I consent to be contacted about future job opportunities'))?.entry.key, 'consent_marketing');
  });
  await check('signatures are stable and ignore option order, not label or section', () => {
    const a = N.signatureOf({ labelNorm: 'gender', kind: 'select', options: ['Male', 'Female'], section: 'EEO' });
    assert.equal(a, N.signatureOf({ labelNorm: 'gender', kind: 'select', options: ['Female', 'Male'], section: 'eeo' }));
    assert.notEqual(a, N.signatureOf({ labelNorm: 'gender', kind: 'select', options: ['Male', 'Female'], section: 'Other' }));
  });
  await check('option matching: yes/no, decline, ranges, time zones, containment', () => {
    assert.equal(N.bestOption('No', ['Yes', 'No']), 'No');
    assert.equal(N.bestOption('Decline to self-identify', ['Male', 'Female', "I don't wish to answer"]), "I don't wish to answer");
    assert.equal(N.bestOption('2', ['Less than 1 year', '1-2 years', '3-5 years']), '1-2 years');
    assert.equal(N.bestOption('PKT (UTC+5)', ['(GMT+01:00) Berlin', '(GMT+05:00) Islamabad, Karachi']), '(GMT+05:00) Islamabad, Karachi');
    assert.equal(N.bestOption('Lahore, Pakistan', ['Lahore Punjab, Pakistan', 'Lagos, Nigeria'], 0.6), 'Lahore Punjab, Pakistan');
  });
  await check('dates parse and render in the field format', () => {
    const p = N.parseDate('Jul 2023')!;
    assert.deepEqual([p.y, p.m], [2023, 7]);
    assert.equal(N.formatDate(N.parseDate('2026-12-01')!, 'MM/DD/YYYY'), '12/01/2026');
    assert.equal(N.formatDate(N.parseDate('2026-12-01')!, 'DD.MM.YYYY'), '01.12.2026');
    assert.ok(N.sameDate('Dec 1, 2026', '2026-12-01'));
  });
  await check('read-back comparison: masks tolerated, strict pre-fill check is not', () => {
    assert.ok(N.valuesMatch('tel', '+92 301 5550142', '(301) 555-0142'));
    assert.ok(!N.valuesMatch('tel', '3015550142', '0301 5550142', { strict: true }));
    assert.ok(N.valuesMatch('file', 'C:\\x\\Rania-Haroon-CV.pdf', '', { chip: 'Rania-Haroon-CV.pdf 120 KB' }));
    assert.ok(!N.valuesMatch('select', 'Yes', 'No'));
  });
  await check('detects the ATS from URLs, fixture paths and DOM fingerprints', () => {
    assert.equal(detectAts('https://boards.greenhouse.io/acme/jobs/123'), 'greenhouse');
    assert.equal(detectAts('https://jobs.lever.co/acme/8f3c2a71-5b9e-4d0a-a6c4-2e7d91b05f38/apply'), 'lever');
    assert.equal(detectAts('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/X_R-1'), 'workday');
    assert.equal(effectiveUrl('http://127.0.0.1:5555/jobs.ashbyhq.com/q/1/application'), 'https://jobs.ashbyhq.com/q/1/application');
    assert.equal(detectAts('https://careers.example.com/apply', '<form id="application_form"><div id="grnhse_app"></div>'), 'greenhouse');
    assert.equal(detectAts('https://careers.example.com/apply', '<div data-automation-id="pageFooterNextButton"></div>'), 'workday');
    assert.equal(detectAts('https://careers.example.com/apply', '<html><body>nothing</body></html>'), null);
  });
  await check('detects iCIMS, Taleo and SuccessFactors from their replica URLs, embeds and DOM', () => {
    assert.equal(detectAts('http://127.0.0.1:5555/careers-northbeam.icims.com/jobs/4821/junior-software-engineer/job'), 'icims');
    assert.equal(detectAts('https://northbeam.taleo.net/careersection/2/jobapply.ftl?job=2400123&lang=en'), 'taleo');
    assert.equal(detectAts('https://career4.successfactors.com/career?company=northbeam&career_job_req_id=10432'), 'successfactors');
    assert.equal(detectAts('https://careers.example.com/jobs/1', '<iframe id="icims_content_iframe" src="https://careers-x.icims.com/jobs/1/job?in_iframe=1">'), 'icims');
  });
  await check('candidate facts: location, phone and degree splits', () => {
    assert.deepEqual(splitLocation('Lahore, Pakistan'), { city: 'Lahore', state: '', country: 'Pakistan' });
    assert.deepEqual(splitLocation('Austin, TX'), { city: 'Austin', state: 'TX', country: 'United States' });
    assert.equal(splitPhone('+92 301 5550142', '').cc, '92');
    assert.equal(splitPhone('+92 301 5550142', '').national, '3015550142');
    assert.deepEqual(splitDegree('Bachelor of Science, Computer Science'), { degree: 'Bachelor of Science', discipline: 'Computer Science' });
  });
  await check('the in-page library is valid JavaScript', () => {
    new Function(`return ${PAGE_LIB}`);
  });
  await check('account passwords are strong and unique; LinkedIn/Indeed accounts are refused', () => {
    const a = generatePassword();
    assert.ok(a.length >= 20 && /[A-Z]/.test(a) && /[a-z]/.test(a) && /\d/.test(a) && /[^A-Za-z0-9]/.test(a));
    assert.notEqual(a, generatePassword());
    assert.ok(FORBIDDEN_ACCOUNT_HOSTS.test('www.linkedin.com') && FORBIDDEN_ACCOUNT_HOSTS.test('uk.indeed.com') && !FORBIDDEN_ACCOUNT_HOSTS.test('acme.wd5.myworkdayjobs.com'));
  });

  section('A05 forms: mapping (deterministic first, never guessing attestations)');
  const cand = candidateFrom(
    {
      name: 'Ada Example Lovelace', headline: '', email: 'ada@example.com', phone: '+44 7700 900123', location: 'London, UK', links: [{ label: 'GitHub', url: 'https://github.com/ada' }],
      summary: 'Engineer.', yearsExperience: 3, seniority: 'junior', categories: [], targetRoles: [], coreStack: ['TypeScript', 'PostgreSQL'], skills: ['Docker'],
      experience: [{ role: 'Engineer', company: 'Analytical Ltd', location: 'London', start: 'Jan 2022', end: 'Present', bullets: ['Built things'] }],
      education: [{ school: 'Example University', degree: 'BSc Computer Science', start: '2018', end: '2021', details: '' }],
      certifications: [], languages: [], achievements: [], voice: '', cvMarkdown: '# Ada', portfolioNotes: '', preferences: {} as never,
    } as never,
    {},
  );
  const field = (label: string, kind: FormField['kind'], extra: Partial<FormField> = {}): FormField => ({ id: `x${label.length}${kind}`, kind, label, labelNorm: N.labelNorm(label), required: true, step: 0, signature: 's', ...extra });
  const packet = { applicationId: 'app', jobId: 'job', cvPdfPath: 'C:/p/Ada-CV.pdf', letterPdfPath: 'C:/p/Ada-Letter.pdf', subject: '', coverLetter: 'Dear team', shortAnswers: { 'why us': 'Because of the ledger work.' }, outreach: '', followUp: '', quality: {} as never } as Packet;
  const bank = new Map<string, string>([['Will you require visa sponsorship?', 'No']]);
  const deps = {
    candidate: () => cand,
    answerFor: async (q: string, ctx: { options?: string[] }) => {
      const hit = [...bank].find(([k]) => N.labelNorm(k) === N.labelNorm(q));
      if (!hit) return null;
      const v = ctx.options?.length ? N.bestOption(hit[1], ctx.options) : hit[1];
      return v ? { value: v, source: 'answer_bank' as const, confidence: 0.97, key: 'ab1' } : null;
    },
    answerQuestion: null,
  };
  const job = { id: 'job', title: 'Engineer', company: 'Acme', source: 'greenhouse', url: '', ats: 'greenhouse' };
  const one = async (f: FormField) => (await mapFieldsWith([f], packet, { deps, job }))[0];
  await check('profile fields map with high confidence', async () => {
    assert.equal((await one(field('First name', 'text')))?.value, 'Ada');
    assert.equal((await one(field('Last name', 'text')))?.value, 'Lovelace');
    assert.equal((await one(field('Country', 'select', { options: ['Pakistan', 'United Kingdom'] })))?.value, 'United Kingdom');
    const cv = await one(field('Resume/CV', 'file'));
    assert.deepEqual([cv?.source, cv?.key], ['file', 'cv']);
    assert.ok((await one(field('Email', 'email')))!.confidence >= 0.9);
  });
  await check('voluntary EEO questions are declined', async () => {
    assert.equal((await one(field('Gender', 'select', { options: ['Male', 'Female', 'Decline To Self Identify'] })))?.value, 'Decline To Self Identify');
    assert.equal((await one(field('Veteran Status', 'radio', { options: ['I am a veteran', "I don't wish to answer"] })))?.value, "I don't wish to answer");
  });
  await check('legal attestations come only from the owner’s answer bank', async () => {
    const yes = await one(field('Will you require visa sponsorship?', 'radio', { options: ['Yes', 'No'] }));
    assert.deepEqual([yes?.value, yes?.source], ['No', 'answer_bank']);
    const unknown = await one(field('Are you legally authorized to work in Canada?', 'radio', { options: ['Yes', 'No'] }));
    assert.ok(unknown?.unknown && unknown.confidence < 0.7, JSON.stringify(unknown));
  });
  await check('sensitive data is never entered; consent vs marketing boxes', async () => {
    assert.ok((await one(field('Social Security Number', 'text')))?.unknown);
    assert.equal((await one(field('I agree to the privacy policy', 'consent')))?.value, 'true');
    assert.equal((await one(field('Send me job alerts and future opportunities', 'checkbox')))?.value, 'false');
  });
  await check('a "certify" box that attests a legal fact is never ticked on its own', async () => {
    const box = await one(field('I certify that I am legally authorized to work in the United States and will not require sponsorship', 'consent'));
    assert.ok(box?.unknown && box.value !== 'true', JSON.stringify(box));
    assert.equal((await one(field('I certify that the information in this application is accurate', 'consent')))?.value, 'true');
    const own = await one(field('During this application process I agree to use only my own words. I understand that plagiarism, the use of AI or other generated content will disqualify my application.', 'consent'));
    assert.ok(own?.unknown && own.value !== 'true', 'a "no AI" promise is never made for the owner');
  });
  await check("voluntary questions use the owner's own saved answer when there is one", async () => {
    bank.set('Gender (voluntary self-identification)', 'Male');
    bank.set('Veteran status (voluntary self-identification)', 'I am not a protected veteran');
    assert.equal((await one(field('Gender', 'select', { options: ['Male', 'Female', 'Decline To Self Identify'] })))?.value, 'Male');
    assert.equal((await one(field('Veteran Status', 'radio', { options: ['I am a protected veteran', 'I am not a protected veteran', "I don't wish to answer"] })))?.value, 'I am not a protected veteran');
    // No saved answer: still declined.
    assert.equal((await one(field('Disability Status', 'select', { options: ['Yes', 'No', 'I do not want to answer'] })))?.value, 'I do not want to answer');
    bank.delete('Gender (voluntary self-identification)');
    bank.delete('Veteran status (voluntary self-identification)');
  });
  await check('a required "referred by" name box says "No referral" when the owner was not referred', async () => {
    const q = 'Have you been referred by an Acme Employee? If yes, please enter their name below.';
    bank.set(q, 'No');
    assert.equal((await one(field(q, 'text')))?.value, 'No referral');
    bank.delete(q);
  });
  await check('a privacy confirmation as a menu is acknowledged; a dial code reads back as its country', async () => {
    const menu = await one(field("Please confirm that you have read and agree to Canonical's Recruitment Privacy Notice and Privacy Policy.", 'combobox', { options: ['Acknowledge/Confirm'] }));
    assert.equal(menu?.value, 'Acknowledge/Confirm');
    assert.ok(N.valuesMatch('combobox', 'Pakistan +92', '+92'));
    assert.ok(!N.valuesMatch('combobox', 'Pakistan +92', '+44'));
  });
  await check('long-form: the packet’s pre-written answers, skills only from the profile', async () => {
    assert.equal((await one(field('Why do you want to work at Acme?', 'textarea')))?.value, 'Because of the ledger work.');
    assert.equal((await one(field('Which of these have you used?', 'checkbox', { options: ['PostgreSQL', 'Elixir', 'Docker'] })))?.value, 'PostgreSQL; Docker');
    assert.ok((await one(field('Describe your favourite colour', 'text')))?.unknown);
  });
  await check('skills by relevance (core stack, job keywords), exact option matches only', async () => {
    const { rankSkills } = await import('../../server/forms/map.ts');
    assert.deepEqual(rankSkills({ skills: ['TypeScript', 'PostgreSQL', 'Docker', 'Go'], coreStack: ['TypeScript', 'PostgreSQL'] }, { title: 'Backend', description: 'Go and PostgreSQL services' }), ['PostgreSQL', 'Go', 'TypeScript', 'Docker']);
    const multi = await one(field('Skills', 'combobox', { meta: { multi: true } } as never));
    assert.equal(multi?.value, 'TypeScript; PostgreSQL; Docker');
    assert.equal((await one(field('Which of these have you used?', 'checkbox', { options: ['SQL Server', 'Docker'] })))?.value, 'Docker');
    assert.ok(N.sameItem('Node', 'Node.js') && !N.sameItem('SQL', 'SQL Server') && !N.sameItem('SQL', 'MySQL'));
    assert.ok(N.valuesMatch('combobox', 'React; Node.js', 'Select… Node.js, React ▾') && !N.valuesMatch('combobox', 'React; Go', 'React'));
  });
  await check('education: GPA only as the profile states it; no copied or invented entries', async () => {
    const withGpa = candidateFrom({ name: 'Ada Lovelace', headline: '', email: '', phone: '', location: '', links: [], summary: '', yearsExperience: 3, seniority: 'junior', categories: [], targetRoles: [], coreStack: [], skills: [], experience: [], education: [{ school: 'Example University', degree: 'BSc Computer Science', start: '2018', end: '2021', details: 'CGPA 3.4 / 4.0. Thesis on engines.' }], certifications: [], languages: [], achievements: [], voice: '', cvMarkdown: '', portfolioNotes: '', preferences: {} } as never, {})!;
    const d2 = { ...deps, candidate: () => withGpa };
    const m = async (f: FormField) => (await mapFieldsWith([f], packet, { deps: d2, job }))[0];
    assert.equal((await m(field('Overall Result (GPA)', 'text')))?.value, '3.4');
    assert.notEqual((await m(field('GPA scale', 'text')))?.value, '3.4', 'the grade is not the scale');
    const second = await m(field('School', 'text', { meta: { group: { name: 'education', index: 1 } } } as never));
    assert.ok(!second?.value, `a second education entry the profile lacks stays empty: ${JSON.stringify(second)}`);
    const from = await m(field('From', 'date', { required: false, meta: { group: { name: 'education', index: 0 }, format: 'MM/YYYY' } } as never));
    assert.equal(from, undefined, 'a year-only start date is not turned into 01/2018');
  });
  await check('several generic website fields get distinct links in profile order', async () => {
    const withLinks = candidateFrom({ name: 'Ada Lovelace', headline: '', email: '', phone: '', location: '', links: [{ label: 'GitHub', url: 'https://github.com/ada' }, { label: 'Portfolio', url: 'https://ada.example.com' }, { label: 'LinkedIn', url: 'https://www.linkedin.com/in/ada' }], summary: '', yearsExperience: 3, seniority: 'junior', categories: [], targetRoles: [], coreStack: [], skills: [], experience: [], education: [], certifications: [], languages: [], achievements: [], voice: '', cvMarkdown: '', portfolioNotes: '', preferences: {} } as never, {})!;
    const d3 = { ...deps, candidate: () => withLinks };
    const a = field('URL', 'url', { id: 'w1', required: false, selectors: ['#website-1--url'] } as never);
    const b = field('URL', 'url', { id: 'w2', required: false, selectors: ['#website-2--url'] } as never);
    const li = field('LinkedIn', 'url', { id: 'li', required: false });
    const out = await mapFieldsWith([a, b, li], packet, { deps: d3, job });
    assert.deepEqual(['w1', 'w2', 'li'].map((id) => out.find((x) => x.fieldId === id)?.value), ['https://github.com/ada', 'https://ada.example.com', 'https://www.linkedin.com/in/ada']);
    // Mapped alone (a later pass), the numbered panel still gets its own link.
    assert.equal((await mapFieldsWith([b], packet, { deps: d3, job, context: [a, b, li] }))[0]?.value, 'https://ada.example.com');
  });
  await check('"Address" next to its own City box is the street line; alone it is where the candidate lives', async () => {
    const d4 = { ...deps, answerFor: async (q: string) => (/street address/i.test(q) ? { value: '14 Example Street', source: 'answer_bank' as const, confidence: 0.97, key: 'ab-street' } : null) };
    const addr = field('Address', 'text', { id: 'addr' });
    const city = field('City', 'text', { id: 'city' });
    assert.equal((await mapFieldsWith([addr], packet, { deps: d4, job, context: [addr, city] }))[0]?.value, '14 Example Street');
    assert.equal((await mapFieldsWith([addr], packet, { deps: d4, job }))[0]?.value, 'London, UK');
  });
  await check('mapFields is side-effect free (no unknown question recorded)', async () => {
    const before = Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM unknown_questions')?.n ?? 0);
    await mapFieldsWith([field('A question nobody can answer?', 'text')], packet, { deps, job });
    assert.equal(Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM unknown_questions')?.n ?? 0), before);
  });

  section('A05 forms: recipe store (url > company > ats, versions, demotion)');
  const steps = [{ action: 'fill' as const, fieldSignature: 'sig1', selectors: ['#first'], widget: 'text', valueSource: 'profile' as const, valueKey: 'first_name', labelNorm: 'first name' }];
  await check('scope priority: url beats company beats ats', () => {
    R.saveRecipe({ ats: 'lever', scope: 'ats', scopeKey: 'lever', version: 1, status: 'active', match: {}, steps, hooks: [] });
    R.saveRecipe({ ats: 'lever', scope: 'company', scopeKey: 'Acme Inc.', version: 1, status: 'active', match: {}, steps, hooks: [] });
    assert.equal(R.findRecipe({ ats: 'lever', company: 'ACME', url: 'https://jobs.lever.co/acme/1' })?.scope, 'company');
    R.saveRecipe({ ats: 'lever', scope: 'url', scopeKey: 'https://jobs.lever.co/acme/*', version: 1, status: 'active', match: {}, steps, hooks: [] });
    assert.equal(R.findRecipe({ ats: 'lever', company: 'ACME', url: 'https://jobs.lever.co/acme/1/apply?x=1' })?.scope, 'url');
    assert.equal(R.findRecipe({ ats: 'lever', company: 'Other', url: 'https://jobs.lever.co/other/1' })?.scope, 'ats');
  });
  await check('a new active version supersedes the old one', () => {
    const v2 = R.saveRecipe({ ats: 'lever', scope: 'company', scopeKey: 'acme', version: 1, status: 'active', match: {}, steps, hooks: [] });
    const found = R.findRecipe({ ats: 'lever', company: 'Acme', url: 'https://x.example/' });
    assert.equal(found?.version, 2);
    assert.equal((found as { id?: string }).id, v2);
    assert.equal(all<{ status: string }>("SELECT status FROM form_recipes WHERE scope = 'company' AND scope_key = 'acme' AND version = 1")[0].status, 'demoted');
  });
  await check('two consecutive failures demote a recipe; a success resets the count', () => {
    const id = R.saveRecipe({ ats: 'ashby', scope: 'ats', scopeKey: 'ashby', version: 1, status: 'active', match: {}, steps, hooks: [] });
    R.recordRecipeRun(id, false, 'x');
    R.recordRecipeRun(id, true);
    R.recordRecipeRun(id, false, 'y');
    assert.equal(R.getRecipe(id)?.status, 'active');
    R.recordRecipeRun(id, false, 'z');
    assert.equal(R.getRecipe(id)?.status, 'demoted');
    assert.equal(R.findRecipe({ ats: 'ashby', url: 'https://jobs.ashbyhq.com/x' }), null);
  });

  section('A05 forms: guarantees without a browser');
  await check('submitVerified refuses an unverified form (and never clicks)', async () => {
    let clicked = false;
    const nav = { kind: 'submit' as const, selector: '#x', frame: { locator: () => ({ first: () => ({ click: async () => void (clicked = true) }) }) } } as never;
    await assert.rejects(submitVerified({ page: { frames: () => [] } as never, verified: false, problems: ['Email: empty'] }, nav), UnverifiedSubmitError);
    assert.equal(clicked, false);
  });
  await check('the browser guard blocks loopback, and fixture origins only in replay mode', async () => {
    assert.equal(await urlAllowed('http://127.0.0.1:4317/api/settings'), false);
    const undo = allowFixtureOrigins(['http://127.0.0.1:59999']);
    try {
      assert.equal(await urlAllowed('http://127.0.0.1:59999/x'), true);
      assert.equal(await urlAllowed('http://127.0.0.1:59998/x'), false);
      const prev = process.env.BUREAU_REPLAY;
      delete process.env.BUREAU_REPLAY;
      try {
        assert.equal(await urlAllowed('http://127.0.0.1:59999/x'), false);
      } finally {
        process.env.BUREAU_REPLAY = prev;
      }
    } finally {
      undo();
    }
  });
  await check('10+ adapters, Workday among them with an account flow', () => {
    assert.ok(ADAPTERS.length >= 10, `${ADAPTERS.length}`);
    for (const a of ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'personio', 'teamtailor', 'bamboohr', 'breezy', 'workday']) assert.ok(ADAPTERS.some((x) => x.ats === a), a);
    assert.ok(ADAPTERS.find((a) => a.ats === 'workday')?.account);
    for (const a of ['icims', 'taleo', 'successfactors']) assert.ok(ADAPTERS.find((x) => x.ats === a)?.account && !/best effort/i.test(ADAPTERS.find((x) => x.ats === a)!.name), a);
  });

  await check('a required date that wants a month the profile lacks goes to the owner (never an invented January)', async () => {
    const edu = { meta: { group: { name: 'education', index: 0 } } };
    const asked = await one(field('From', 'date', edu as never));
    assert.ok(asked?.unknown && !asked.value, `year-only education start in a date input: ${JSON.stringify(asked)}`);
    assert.match(asked!.reason ?? '', /only the year/);
    assert.ok((await one(field('Start date', 'text', { meta: { ...edu.meta, format: 'MM/YYYY' } } as never)))?.unknown, 'an MM/YYYY mask is a month field too');
    const grad = await one(field('Graduation date', 'date'));
    assert.ok(grad?.unknown && grad.value !== '2021', `graduation year alone in a date input: ${JSON.stringify(grad)}`);
    // A year field takes the year; a month the profile states is used as it is.
    const years = ['2017', '2018', '2019', '2020', '2021', '2022'];
    assert.equal((await one(field('Start year', 'select', { options: years, meta: edu.meta } as never)))?.value, '2018');
    assert.equal((await one(field('From', 'date', { meta: { group: { name: 'work', index: 0 } } } as never)))?.value, '2022-01');
  });

  // ── The engine on A11's replicas ──────────────────────────────────────────
  section('A05 forms: the engine on the ATS replicas and widget pages (fixture server)');
  const browser = await sharedBrowser();
  if (!browser) {
    await check('browser checks', () => 'skip');
    return;
  }
  const { startFixtureServer } = await import('../fixture-server.ts');
  const fx = await startFixtureServer({ quiet: true });
  const prevOrigins = process.env.BUREAU_FIXTURE_ORIGINS;
  process.env.BUREAU_FIXTURE_ORIGINS = `${fx.originA},${fx.originB}`;
  const { seedProfile, insertJob, fallbackPacket, formJob } = await import('../e2e/seed.ts');
  const { checkExpectations } = await import('../e2e/expect.ts');
  const { loadExpected } = await import('../e2e/manifest.ts');
  const { upsertAnswer } = await import('../../server/profile/index.ts');
  try {
    seedProfile();
    // Earlier check modules share this sandbox: drop any US work-authorisation answer so that question stays the owner's call here.
    run("DELETE FROM answer_bank WHERE question_raw LIKE '%United States%' OR question_raw LIKE '%U.S.%' OR question_raw LIKE '% US?%'");
    run("DELETE FROM settings WHERE key = 'profile.links'");
    const data = loadExpected() as unknown as Record<string, string>;
    // The owner answered the address questions once (the seeded candidate's profile has no street address).
    upsertAnswer({ question: 'What is your street address?', answer: data.addressLine1 });
    upsertAnswer({ question: 'What is your postal code?', answer: data.postalCode });
    upsertAnswer({ question: 'What is your state or province?', answer: data.region });
    // Germany-specific: the owner's own answer (a general sponsorship answer is never stretched to a country-specific attestation).
    upsertAnswer({ question: 'Do you need a work permit to work for a German employer?', answer: data.answers ? String((data.answers as unknown as Record<string, string>).needsSponsorship) : 'Yes' });
    const unknowns: string[] = [];
    const waitForCode = async (_d: string, ms: number) => {
      const until = Date.now() + Math.min(ms, 20_000);
      const seen = fx.mail().length;
      while (Date.now() < until) {
        const m = fx.mail().slice(Math.max(0, seen - 1)).reverse().find((x) => /\b\d{6}\b/.test(x.text));
        if (m) return m.text.match(/\b(\d{6})\b/)![1];
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    };
    const engineDeps = { browser: async () => ({ browser, release: () => {} }), waitForCode, recordUnknown: (q: { question: string }) => (unknowns.push(q.question), 'q') };
    const jobs = new Map<string, { jobId: string; packet: Packet }>();
    const prep = (id: string) => {
      if (!jobs.has(id)) {
        const f = fx.form(id);
        const meta = formJob(f);
        const jobId = insertJob({ fingerprint: `a05:${id}`, title: meta.title, company: meta.company, url: fx.url(id), ats: f.ats, campaignId: null });
        jobs.set(id, { jobId, packet: fallbackPacket(jobId, 'a05', sandbox) });
      }
      return jobs.get(id)!;
    };
    type Out = Awaited<ReturnType<typeof runFill>>;
    const rehearsals = new Map<string, Out>();
    const forms = fx.manifest.forms.map((f) => f.id);
    const queue = [...forms];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          const { packet: p } = prep(id);
          try {
            rehearsals.set(id, await runFill(p, { submit: false, onUnknown: 'skip' }, engineDeps));
          } catch (err) {
            rehearsals.set(id, { status: 'failed', reason: (err as Error).message, shotPath: null, shots: [], answers: [], verified: false, unknownQuestions: [], fieldLog: [], ats: null, via: null, recipeId: null, url: null });
          }
        }
      }),
    );
    const ratio = (o: Out) => (o.fieldLog.length ? o.fieldLog.filter((e) => e.ok).length / o.fieldLog.length : 0);
    for (const id of forms) {
      const spec = fx.form(id);
      const out = rehearsals.get(id)!;
      const want = spec.expectedOutcome ?? 'submitted';
      const name = spec.ats === 'widget' ? `widget handler: ${id.replace(/^widget-/, '')}` : `adapter: ${id} (${spec.ats})`;
      await check(`${name} → ${want === 'submitted' ? 'rehearsed, ≥95% verified' : want}`, () => {
        if (id === 'widget-cross-origin-iframe' && out.status === 'skipped') {
          // US work authorisation: the seeded bank only answers for Pakistan, so this is (correctly) the owner's call.
          assert.ok(out.unknownQuestions.some((u) => /authori[sz]ed to work in the United States/i.test(u.label)), out.reason);
          assert.ok(ratio(out) >= 0.85);
          return;
        }
        if (want === 'needs_you') return assert.equal(out.status, 'needs_you', out.reason);
        if (want !== 'submitted') return assert.ok(!out.verified && out.status !== 'rehearsed', out.reason);
        assert.equal(out.status, 'rehearsed', out.reason);
        assert.ok(out.verified);
        assert.ok(ratio(out) >= 0.95, `${(ratio(out) * 100).toFixed(0)}%: ${out.fieldLog.filter((e) => !e.ok).map((e) => e.label).join(', ')}`);
      });
    }
    await check('Workday ran the full wizard (account, parse correction, 6 steps)', () => {
      const out = rehearsals.get('workday')!;
      assert.equal(out.status, 'rehearsed', out.reason);
      assert.ok(out.shots.length >= 6, `${out.shots.length} step shots`);
      assert.ok(getAccount('atlasmutual.wd5.myworkdayjobs.com'), 'site account stored');
      const row = get<{ secret_name: string }>("SELECT secret_name FROM site_accounts WHERE domain = 'atlasmutual.wd5.myworkdayjobs.com'");
      assert.ok(row && !JSON.stringify(row).includes('password'));
    });
    await check('every run leaves step screenshots and a field log on disk', () => {
      const out = rehearsals.get('greenhouse-classic')!;
      assert.ok(out.shots.length >= 1);
      for (const s of out.shots) assert.ok(fs.existsSync(path.join(process.env.BUREAU_DATA_DIR!, s)), s);
      const runId = out.shots[0].split('/')[2];
      const log = JSON.parse(fs.readFileSync(path.join(process.env.BUREAU_DATA_DIR!, 'forms', 'runs', runId, 'fieldlog.json'), 'utf8')) as unknown[];
      assert.equal(log.length, out.fieldLog.length);
      assert.ok(out.shotPath && fs.existsSync(path.join(process.env.BUREAU_DATA_DIR!, 'shots', out.shotPath)));
    });
    await check('unknown required questions go to the answer-bank loop (recordUnknown; skipped or needs_you)', async () => {
      const uj = insertJob({ fingerprint: 'a05:unknown', title: 'Junior Developer', company: 'Unknowable Ltd', url: fx.url('/ats/_a05/heal.html'), ats: 'other', campaignId: null });
      const up = fallbackPacket(uj, 'a05', sandbox);
      const url = `${fx.url('/ats/_a05/heal.html')}?v=3`;
      const skip = await runFill(up, { submit: true, onUnknown: 'skip' }, { ...engineDeps, url });
      assert.equal(skip.status, 'skipped', skip.reason);
      assert.match(skip.reason, /^unknown_question/);
      assert.equal(skip.verified, false);
      assert.ok(unknowns.some((q) => /Freedonia/.test(q)), 'attestation recorded');
      assert.ok(skip.unknownQuestions.some((u) => /Freedonia/.test(u.label)));
      const ask = await runFill(up, { submit: true, onUnknown: 'needs_you' }, { ...engineDeps, url });
      assert.equal(ask.status, 'needs_you');
    });
    await check('a verified adapter run teaches a recipe', () => {
      const rec = R.findRecipe({ ats: 'greenhouse', company: 'Lumen Ledger', url: fx.url('greenhouse-classic') });
      assert.ok(rec && rec.steps.some((s) => s.action === 'upload') && rec.steps.some((s) => s.valueKey === 'first_name'));
    });

    section('A05 forms: live submits against the fixture server');
    const live = async (id: string) => {
      const before = fx.submissions({ formId: id }).at(-1)?.seq ?? 0;
      const out = await runFill(prep(id).packet, { submit: true, onUnknown: 'skip' }, engineDeps);
      return { out, finals: fx.submissions({ formId: id, final: true }).filter((x) => x.seq > before) };
    };
    await check('recipe used first: Greenhouse classic submits via its learned recipe, every expected value exact', async () => {
      const { out, finals } = await live('greenhouse-classic');
      assert.equal(out.status, 'submitted', out.reason);
      assert.equal(out.via, 'recipe');
      assert.equal(finals.length, 1);
      const exp = checkExpectations(fx.form('greenhouse-classic'), finals[0], loadExpected());
      const bad = exp.filter((e) => !e.ok);
      // The e2e bar: every profile and file value exact, ≥ 95% overall (other modules' checks share this answer bank).
      assert.deepEqual(bad.filter((e) => /^(profile:|file:)/.test(e.rule)), [], JSON.stringify(bad));
      // Choice answers come from the shared answer bank (earlier modules' checks edit it), so the overall bar here is 85%; the e2e uses a clean bank.
      assert.ok((exp.length - bad.length) / exp.length >= 0.85, JSON.stringify(bad));
    });
    await check('never twice: a second live fill of a submitted job sends nothing', async () => {
      const { out, finals } = await live('greenhouse-classic');
      assert.equal(out.status, 'skipped');
      assert.equal(finals.length, 0);
    });
    await check('zero submissions without verified:true (verify-trap-impossible, live)', async () => {
      const { out, finals } = await live('widget-verify-trap-impossible');
      assert.notEqual(out.status, 'submitted');
      assert.equal(out.verified, false);
      assert.equal(finals.length, 0);
    });
    await check('a visible CAPTCHA parks the job (needs_you) with nothing sent', async () => {
      const { out, finals } = await live('widget-captcha-recaptcha');
      assert.equal(out.status, 'needs_you');
      assert.equal(finals.filter((x) => x.valid).length, 0);
    });
    await check('the beatable verify trap is beaten by read-back and submits valid data', async () => {
      const { out, finals } = await live('widget-verify-trap');
      assert.equal(out.status, 'submitted', out.reason);
      assert.equal(finals.length, 1);
      assert.ok(finals[0].valid, finals[0].errors.join('; '));
    });

    section('A05 forms: recipe self-heal, abort, agent switch');
    const heal = (v: number) => `${fx.url('/ats/_a05/heal.html')}?v=${v}`;
    const healJob = insertJob({ fingerprint: 'a05:heal', title: 'Junior Developer', company: 'Heal Co', url: heal(1), ats: 'other', campaignId: null });
    const healPacket = fallbackPacket(healJob, 'a05', sandbox);
    await check('self-heal: a redeploy renames every selector, the recipe re-matches by signature and saves a new version', async () => {
      const first = await runFill(healPacket, { submit: false }, { ...engineDeps, url: heal(1) });
      assert.equal(first.status, 'rehearsed', first.reason);
      const learned = R.findRecipe({ ats: 'other', company: 'Heal Co', url: heal(1) });
      assert.ok(learned, 'recipe learned on v1');
      const second = await runFill(healPacket, { submit: false }, { ...engineDeps, url: heal(2) });
      assert.equal(second.status, 'rehearsed', second.reason);
      assert.equal(second.via, 'recipe');
      const now = R.findRecipe({ ats: 'other', company: 'Heal Co', url: heal(2) })!;
      assert.ok(now.version > learned.version, `version ${now.version}`);
      assert.ok(now.steps.some((s) => s.selectors.some((x) => /fld_/.test(x))), 'new selectors recorded');
    });
    await check('abort: the kill signal stops a fill within seconds and closes its page', async () => {
      const ac = new AbortController();
      const t0 = Date.now();
      const p = runFill(prep('workday').packet, { submit: false, signal: ac.signal }, engineDeps);
      setTimeout(() => ac.abort(), 800);
      await assert.rejects(p);
      assert.ok(Date.now() - t0 < 15_000, `${Date.now() - t0} ms`);
    });
    await check('no form + agent switched off → needs_you; agent not built → needs_you with the reason', async () => {
      const pj = insertJob({ fingerprint: 'a05:noform', title: 'x', company: 'Nowhere', url: fx.url('/ats/_a05/heal.html'), ats: 'other', campaignId: null });
      const pk = fallbackPacket(pj, 'a05', sandbox);
      const page = `data:text/html,<h1>No form here</h1>`;
      const off = await runFill(pk, { submit: false, allowAgent: false }, { ...engineDeps, url: fx.url('/ats/_a05/missing-page.html') });
      assert.equal(off.status, 'needs_you');
      assert.match(off.reason, /switched off|form/i);
      const stub = await runFill(pk, { submit: false }, { ...engineDeps, url: fx.url('/ats/_a05/missing-page.html'), agentFill: null });
      assert.equal(stub.status, 'needs_you');
      void page;
    });

    section('A05 forms: iCIMS, Taleo, SuccessFactors and shadow-root replicas (staged, fixtures/ats/*/staged.json)');
    const { startStagedReplicas } = await import('../../fixtures/ats/_staged/server.ts');
    const sx = await startStagedReplicas({ quiet: true });
    process.env.BUREAU_FIXTURE_ORIGINS = `${fx.originA},${fx.originB},${sx.originA},${sx.originB}`;
    try {
      type Staged = { rehearsal: Out; live: Out; finals: import('../e2e/expect.ts').Submission[] };
      const staged = new Map<string, Staged>();
      const stagedJob = (id: string, tag = '') => {
        const f = sx.form(id);
        const jobId = insertJob({ fingerprint: `a05:staged:${id}${tag}`, title: f.job.title, company: f.job.company, url: sx.url(id), ats: f.ats, campaignId: null });
        return fallbackPacket(jobId, 'a05', sandbox);
      };
      const failed = (err: unknown): Out => ({ status: 'failed', reason: (err as Error).message, shotPath: null, shots: [], answers: [], verified: false, unknownQuestions: [], fieldLog: [], ats: null, via: null, recipeId: null, url: null });
      const squeue = sx.forms.map((f) => f.id);
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          for (let id = squeue.shift(); id; id = squeue.shift()) {
            // Rehearse, then send for real: the replica's own server records exactly what arrived.
            const p = stagedJob(id);
            const rehearsal = await runFill(p, { submit: false, onUnknown: 'skip', allowAgent: false }, engineDeps).catch(failed);
            const before = sx.submissions({ formId: id }).at(-1)?.seq ?? 0;
            const live = await runFill(p, { submit: true, onUnknown: 'skip', allowAgent: false }, engineDeps).catch(failed);
            staged.set(id, { rehearsal, live, finals: sx.submissions({ formId: id, final: true }).filter((x) => x.seq > before) });
          }
        }),
      );
      for (const f of sx.forms) {
        const want = f.expectedOutcome;
        await check(`${f.ats === 'widget' ? 'staged widget' : 'adapter'}: ${f.id} (${f.ats}) → ${want === 'submitted' ? 'rehearsed ≥95% verified, then submitted with every expected value' : want}`, () => {
          const { rehearsal, live, finals } = staged.get(f.id)!;
          if (want === 'needs_you') {
            for (const o of [rehearsal, live]) assert.equal(o.status, 'needs_you', o.reason);
            assert.equal(finals.length, 0, 'nothing may be sent');
            return;
          }
          assert.equal(rehearsal.status, 'rehearsed', rehearsal.reason);
          assert.ok(ratio(rehearsal) >= 0.95, `${(ratio(rehearsal) * 100).toFixed(0)}%: ${rehearsal.fieldLog.filter((e) => !e.ok).map((e) => e.label).join(', ')}`);
          if (f.ats !== 'widget') assert.ok(rehearsal.via === 'adapter' || rehearsal.via === 'recipe', `via ${rehearsal.via}`);
          assert.equal(live.status, 'submitted', live.reason);
          assert.equal(finals.length, 1, `${finals.length} final submissions`);
          assert.ok(finals[0].valid, finals[0].errors.join('; '));
          const exp = checkExpectations(f, finals[0], loadExpected());
          const bad = exp.filter((e) => !e.ok);
          assert.deepEqual(bad.filter((e) => /^(profile:|file:)/.test(e.rule) || e.rule === 'empty'), [], JSON.stringify(bad));
          assert.ok((exp.length - bad.length) / exp.length >= 0.95, JSON.stringify(bad));
        });
      }
      await check('Taleo / SuccessFactors: the account is created once (vault password) and reused by the next run', () => {
        for (const [id, domain] of [['taleo-careersection', 'northbeam.taleo.net'], ['successfactors-career', 'career4.successfactors.com']] as const) {
          assert.ok(getAccount(domain), `${domain} account stored`);
          assert.equal(sx.accounts(id).length, 1, `one account on the ${id} replica`);
          assert.equal(staged.get(id)!.live.status, 'submitted', 'the second run signed in with the stored account');
        }
      });
      await check('iCIMS embedded cross-origin: Apply, Next and Submit are all inside the origin-B frame; the host newsletter box is left alone', () => {
        const { live, finals } = staged.get('icims-embedded')!;
        assert.equal(live.status, 'submitted', live.reason);
        assert.equal(finals[0]?.origin, 'b', 'the submission came from the embedded frame');
        assert.ok(!live.answers.some((a) => /news/i.test(a.label)), JSON.stringify(live.answers.map((a) => a.label)));
      });
      await check('closed shadow root: the required field is named in the reason, logged as unfillable, never asked of the owner', () => {
        const { rehearsal } = staged.get('widget-shadow-closed-required')!;
        assert.match(rehearsal.reason, /Preferred first name: inside a closed shadow root/);
        assert.ok(rehearsal.fieldLog.some((e) => e.note === 'closed shadow root' && !e.ok));
        assert.equal(rehearsal.unknownQuestions.length, 0, 'not an answer-bank question: an answer would not help');
      });
      await check('Taleo account Bureau has no password for (made by hand): "already exists" → needs_you, nothing sent', async () => {
        run("DELETE FROM site_accounts WHERE domain = 'northbeam.taleo.net'");
        const before = sx.submissions({ formId: 'taleo-careersection' }).length;
        const out = await runFill(stagedJob('taleo-careersection', ':handmade'), { submit: true, onUnknown: 'skip', allowAgent: false }, engineDeps);
        assert.equal(out.status, 'needs_you', out.reason);
        assert.match(out.reason, /already exists/);
        assert.equal(sx.submissions({ formId: 'taleo-careersection' }).length, before);
        assert.equal(getAccount('northbeam.taleo.net'), null, 'no half-made account is kept');
      });
      await check('the accounts flow does not mistake a zip-code box for an email-verification form', async () => {
        const { authView } = await import('../../server/forms/accounts.ts');
        const ctx = await browser.newContext();
        try {
          const page = await ctx.newPage();
          await page.setContent('<form><input name="ZipCode"><input name="City"></form>');
          assert.equal(await authView(page), null);
          await page.setContent('<form><input name="verificationCode"></form>');
          assert.equal(await authView(page), 'verify');
        } finally {
          await ctx.close();
        }
      });
    } finally {
      process.env.BUREAU_FIXTURE_ORIGINS = `${fx.originA},${fx.originB}`;
      await sx.close();
    }

    section('A05 forms: routes');
    await check('GET /api/forms/summary, /recipes, /runs', async () => {
      const Fastify = (await import('fastify')).default;
      const { formsRoutes } = await import('../../server/forms/routes.ts');
      const app = Fastify();
      await app.register(formsRoutes);
      const sum = await app.inject({ method: 'GET', url: '/api/forms/summary' });
      assert.equal(sum.statusCode, 200);
      assert.ok((sum.json() as { synonyms: number }).synonyms >= 300);
      assert.equal((await app.inject({ method: 'GET', url: '/api/forms/recipes' })).statusCode, 200);
      const runs = (await app.inject({ method: 'GET', url: '/api/forms/runs?limit=5' })).json() as { runs: { id: string }[] };
      assert.ok(runs.runs.length > 0);
      assert.equal((await app.inject({ method: 'GET', url: `/api/forms/runs/${runs.runs[0].id}` })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: '/api/forms/runs/..%2F..%2Fsecret/shots/x.jpg' })).statusCode >= 400, true);
      await app.close();
    });
    await check('coverage keeps rehearsals and live runs apart: the live rate counts only real submissions', async () => {
      const Fastify = (await import('fastify')).default;
      const { formsRoutes } = await import('../../server/forms/routes.ts');
      const at = new Date().toISOString();
      const rows: [number, string, number, string][] = [
        [0, 'rehearsed', 1, 'Rehearsal: filled and verified, not submitted.'],
        [0, 'rehearsed', 1, 'Rehearsal: filled and verified, not submitted.'],
        [0, 'needs_you', 0, 'Could not verify the form'],
        [1, 'submitted', 1, 'Submitted.'],
        [1, 'needs_you', 1, 'Submitted, but no confirmation appeared.'],
        [1, 'skipped', 0, 'Already submitted: Bureau never applies twice.'],
      ];
      const ids = rows.map(([submit, status, verified, reason], i) => {
        const id = `a05-split-${i}`;
        run('INSERT INTO form_runs (id, ats, submit, status, verified, reason, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, 'a05split', submit, status, verified, reason, at);
        return id;
      });
      const app = Fastify();
      await app.register(formsRoutes);
      try {
        type Row = { ats: string; runs: number; rehearsal: { runs: number; verified: number; rate: number | null }; live: { runs: number; submitted: number; rate: number | null } };
        const sum = (await app.inject({ method: 'GET', url: '/api/forms/summary' })).json() as { last30Days: Row[] };
        const row = sum.last30Days.find((r) => r.ats === 'a05split')!;
        assert.equal(row.runs, 6);
        assert.deepEqual(row.rehearsal, { runs: 3, verified: 2, rate: 0.67 });
        assert.deepEqual(row.live, { runs: 2, submitted: 1, rate: 0.5 }, 'a verified rehearsal never counts as sent; the never-twice skip is not an attempt');
      } finally {
        await app.close();
        for (const id of ids) run('DELETE FROM form_runs WHERE id = ?', id);
      }
    });
  } finally {
    // Leave the shared sandbox as found: later modules (the digest) count today's active recipes.
    run('DELETE FROM form_recipe_runs');
    run('DELETE FROM form_recipes');
    if (prevOrigins === undefined) delete process.env.BUREAU_FIXTURE_ORIGINS;
    else process.env.BUREAU_FIXTURE_ORIGINS = prevOrigins;
    await fx.close();
  }
}
