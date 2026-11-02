import { transition } from '../campaign/pipeline.ts';
import type { MatchResult } from '../contracts/match.ts';
import type { ResearchBrief } from '../contracts/research.ts';
import { all, get, run } from '../db.ts';
import { invalidateMasterProfile } from '../profile/index.ts';
import { syncCvFacts } from '../profile/cv.ts';
import { refreshStyle } from '../profile/voice.ts';
import { companyKey } from '../research/index.ts';
import { DEFAULT_PREFERENCES, saveProfile, type Profile } from '../services/profileStore.ts';

/**
 * The writer's recorded scenario: a fictional junior backend developer, her
 * voice bank and learning list, one stretch job (Backend Engineer, Payments at
 * the fictional Daftar Pay), the matcher's result and a research brief. The
 * selfcheck and the recorder (server/writer/record-fixtures.ts) both seed this
 * exact state, so every prompt, and so every replay hash, is identical.
 * Every id and timestamp that reaches a prompt is fixed here.
 */

export const SEED = 3;
export const JOB_ID = 'job-a04-daftar';
export const CAMPAIGN_ID = 'camp-a04';
export const COMPANY = 'Daftar Pay';
export const DOMAIN = 'daftarpay.example.net';
export const FIXED_AT = '2026-11-01T00:00:00.000Z';
const CV_REF = 'CV: ayesha-khan-cv.pdf';

export const PROFILE: Profile = {
  name: 'Ayesha Khan',
  headline: 'Backend developer (Go, PostgreSQL)',
  email: 'ayesha.khan@example.com',
  phone: '+92 300 1234567',
  location: 'Lahore, Pakistan',
  links: [
    { label: 'GitHub', url: 'https://github.com/ayesha-dev' },
    { label: 'Portfolio', url: 'https://ayesha.example.com' },
  ],
  summary: 'Backend developer who builds bookkeeping software for small shops in Go and PostgreSQL.',
  yearsExperience: 1.5,
  seniority: 'junior',
  categories: ['software', 'web'],
  targetRoles: ['Backend Engineer', 'Go Developer', 'Payments Engineer'],
  coreStack: ['Go', 'PostgreSQL', 'Docker', 'Linux'],
  skills: ['Git', 'Node.js', 'TypeScript', 'REST APIs', 'sqlc', 'Rust', 'Google Cloud'],
  experience: [
    {
      role: 'Backend Developer',
      company: 'Khan Hardware',
      location: 'Lahore',
      start: 'Jan 2025',
      end: 'Present',
      bullets: [
        "Built the store's bookkeeping API in Go and PostgreSQL, replacing a paper ledger across two branches.",
        'Cut month-end closing from 3 days to 2 hours by automating reconciliation.',
        'The API posts about 400 ledger entries a day with sub-50ms queries on a $5 VPS.',
        'Deployed with Docker on a single VPS, with nightly backups to Google Cloud Storage.',
      ],
    },
    {
      role: 'Backend Intern',
      company: 'Codebridge Labs',
      location: 'Lahore',
      start: 'Jun 2024',
      end: 'Aug 2024',
      bullets: ['Contributed to a REST API for a logistics client in Node.js and TypeScript.', 'Wrote integration tests that caught 12 regressions before release.'],
    },
  ],
  projects: [
    {
      name: 'LedgerLite',
      link: 'https://github.com/ayesha-dev/ledgerlite',
      description: 'A double-entry bookkeeping API for small shops, written in Go with PostgreSQL and sqlc.',
      highlights: ['Runs 3 years of transactions for 2 shops.'],
    },
    {
      name: 'tokio-tracing-fix',
      link: 'https://github.com/ayesha-dev/tokio-tracing-fix',
      description: 'An upstream fix for a span leak in Rust tracing-subscriber when spans were dropped across await points.',
      highlights: ['Span memory in a worker dropped from 1.2 GB to 140 MB over a day of traffic.'],
    },
    {
      name: 'Pixel Pantry',
      link: 'https://github.com/ayesha-dev/pixel-pantry',
      description: 'A recipe-sharing PWA that works offline.',
      highlights: ['300 home cooks used it during the beta.'],
    },
  ],
  education: [{ school: 'FAST NUCES Lahore', degree: 'BS Computer Science', start: '2023', end: '2027', details: 'Expected June 2027.' }],
  certifications: [],
  languages: ['English', 'Urdu'],
  achievements: [
    'Won first place at the FAST NUCES Lahore hackathon 2025 with a bus-tracking app built in 24 hours.',
    "Mentor first-year students in the university's programming club every week.",
  ],
  voice: 'Plain, warm and direct. Short sentences mixed with long ones; uses contractions; dry humour.',
  cvMarkdown: '# Ayesha Khan\nBackend developer, Lahore.',
  portfolioNotes: '',
  preferences: { ...DEFAULT_PREFERENCES, signature: 'Ayesha Khan', tone: 'Plain, warm, specific.' },
};

export const VOICE: { id: string; prompt: string; text: string }[] = [
  {
    id: 'vb-why-build',
    prompt: 'Why do you build things?',
    text: "My family runs a hardware store in Lahore. For years the books lived in a paper ledger that only my uncle could read, and every month-end he'd lose three days to it. I didn't set out to be a backend developer. I just wanted him to get his weekends back. So I learned Go and PostgreSQL from the docs and a lot of trial and error, and built him an API that does the boring part. That's still why I build things: somebody has a job that eats their time, and software can give it back.",
  },
  {
    id: 'vb-proudest',
    prompt: 'Tell the story of the project you are proudest of.',
    text: "LedgerLite is the thing I'm proudest of. It's a double-entry bookkeeping API, and it runs both branches of the store. The hard part wasn't the code, honestly. It was the accounting. I had to learn why every debit needs a credit before I could write a single migration, and I got it wrong twice. Now it posts about 400 entries a day and month-end closing takes 2 hours instead of 3 days. My uncle checks the balance sheet on his phone. He still prints it out, though.",
  },
  {
    id: 'vb-hard-bug',
    prompt: 'Describe a hard bug you cracked.',
    text: "The worst bug I've chased was a memory leak in a Rust worker. Memory climbed all day and nothing in our code looked wrong. I spent two evenings reading tracing-subscriber's source before I saw it: spans dropped across await points were never freed. The fix was small. Getting it merged upstream took a week of review, which taught me more than the fix did. Span memory went from 1.2 GB to 140 MB over a day of traffic.",
  },
  {
    id: 'vb-learned-fast',
    prompt: 'Something you had to learn fast.',
    text: "I learned Go in about three weeks because I had to. The store's old spreadsheet broke the week before Eid, the busiest week of the year, and I'd promised a replacement. I read the tour, wrote small programs every night, and asked a lot of dumb questions on the Gophers Slack. It wasn't pretty code. But it shipped, it balanced, and nobody lost a sale. I've learned every tool since the same way: pick a real problem, build the smallest thing that works, then make it right.",
  },
  {
    id: 'vb-team',
    prompt: 'A team you loved working in.',
    text: "The best team I've worked on was a three-person internship squad at Codebridge. We had a standup that actually took five minutes, and a rule that nobody merged their own pull request. I wrote the integration tests nobody else wanted to write. They caught 12 regressions before release, and after the second one people stopped teasing me about it. I like teams where the boring work is respected, because that's usually where the bugs hide.",
  },
  {
    id: 'vb-learning-now',
    prompt: 'What are you learning right now?',
    text: "Right now I'm learning Kubernetes the slow way. I run a small k3s cluster on two old laptops at home and deploy LedgerLite's staging copy to it. Half of what I know so far came from breaking it. I'm also working through the AWS Developer Associate course, mostly at night, because so many payment teams run on AWS and I'd rather not hand-wave about it in an interview.",
  },
];

export const LEARNING = [
  { id: 'learn-k8s', skill: 'Kubernetes', status: 'learning', notes: 'k3s cluster at home running the LedgerLite staging copy' },
  { id: 'learn-aws', skill: 'AWS', status: 'learning', notes: 'working through the AWS Developer Associate course' },
  { id: 'learn-kafka', skill: 'Kafka', status: 'queued', notes: '' },
] as const;

export const POSTING = `Daftar Pay builds checkout and a double-entry ledger API for independent shops in Pakistan and the Gulf. We're hiring a Backend Engineer for the Payments team in Lahore (hybrid).

What you'll do
- Build and own Go services that move money between merchants, banks and wallets
- Keep the ledger correct: idempotent posting, reconciliation and month-end reporting
- Run services on AWS (ECS, RDS for PostgreSQL) and our new Kubernetes platform
- Instrument everything with OpenTelemetry and Prometheus
- Write clear design docs before you write code

What we're looking for
- 2+ years of backend experience
- Go, or another typed backend language and a willingness to learn Go
- PostgreSQL in production
- Experience with payments, accounting or ledgers
- AWS and Kubernetes
- Nice to have: Kafka, event sourcing

Salary: PKR 350,000-450,000 per month. Apply at https://jobs.daftarpay.example.net/backend-payments`;

export const MATCH: MatchResult = {
  jobId: JOB_ID,
  screenPassScore: 74,
  grade: 'B',
  requirements: [
    { text: 'Go', importance: 'critical', evidence: 'stated', match: 'met', proof: "Built the store's bookkeeping API and LedgerLite in Go", blocker: false, proofKind: 'direct', blockerKind: 'none' },
    { text: 'PostgreSQL in production', importance: 'critical', evidence: 'stated', match: 'met', proof: 'LedgerLite runs on PostgreSQL in production for two branches', blocker: false, proofKind: 'direct', blockerKind: 'none' },
    { text: 'Experience with payments, accounting or ledgers', importance: 'important', evidence: 'stated', match: 'met', proof: 'Built a double-entry bookkeeping API; automated month-end reconciliation', blocker: false, proofKind: 'direct', blockerKind: 'none' },
    { text: '2+ years of backend experience', importance: 'important', evidence: 'stated', match: 'partial', proof: '1.5 years including an internship', blocker: false, proofKind: 'none', blockerKind: 'none' },
    { text: 'AWS', importance: 'important', evidence: 'stated', match: 'partial', proof: 'currently learning', blocker: false, proofKind: 'learning', blockerKind: 'none' },
    { text: 'Kubernetes', importance: 'important', evidence: 'stated', match: 'partial', proof: 'currently learning', blocker: false, proofKind: 'learning', blockerKind: 'none' },
    { text: 'Instrumentation with OpenTelemetry and Prometheus', importance: 'important', evidence: 'stated', match: 'partial', proof: 'Fixed a span leak in Rust tracing-subscriber', blocker: false, proofKind: 'transferable', blockerKind: 'none' },
    { text: 'Clear design docs', importance: 'nice', evidence: 'stated', match: 'partial', proof: 'Got an upstream fix through a week of review', blocker: false, proofKind: 'transferable', blockerKind: 'none' },
    { text: 'Kafka', importance: 'nice', evidence: 'stated', match: 'missing', proof: '', blocker: false, proofKind: 'none', blockerKind: 'none' },
  ],
  dimensions: { skills: 4, experience: 3, domain: 5, logistics: 5, compensation: 3, growth: 5 },
  legitimacy: 'ok',
  verdict: 'Strong domain fit (she built a double-entry ledger in Go and PostgreSQL); AWS and Kubernetes are honest learning gaps.',
  strengths: ['Go and PostgreSQL in production', 'Double-entry ledger and reconciliation'],
  gaps: ['AWS', 'Kubernetes', 'Less than 2 years of experience'],
  atsKeywords: ['Go', 'PostgreSQL', 'double-entry ledger', 'reconciliation', 'idempotent', 'AWS', 'Kubernetes', 'OpenTelemetry'],
  stretch: { unmetImportant: 1, blockers: [] },
  inflatedPosting: false,
  decision: 'selected',
  reason: 'Selected for campaign camp-a04',
};

const URL = `https://${DOMAIN}`;
export const BRIEF: ResearchBrief = {
  company: COMPANY,
  domain: DOMAIN,
  whatTheyBuild: 'Checkout and a double-entry ledger API for independent shops in Pakistan and the Gulf.',
  products: [
    { text: 'Daftar Checkout: card and wallet payments online and in store', sourceUrl: `${URL}/checkout` },
    { text: 'Daftar Ledger API: a double-entry ledger that developers post to over REST', sourceUrl: `${URL}/developers` },
  ],
  recent: [
    { text: 'Raised a Series A to expand to the UAE and Saudi Arabia', sourceUrl: `${URL}/blog/series-a`, date: '2026-09' },
    { text: 'Engineering post: moved the ledger to PostgreSQL logical replication so reconciliation reads never block posting', sourceUrl: `${URL}/blog/logical-replication`, date: '2026-10' },
  ],
  techSignals: [{ text: 'Go services on AWS ECS with RDS for PostgreSQL; moving to Kubernetes', sourceUrl: `${URL}/blog/logical-replication` }],
  values: [{ text: 'Every rupee accounted for', sourceUrl: `${URL}/about` }],
  stage: 'Series A',
  teamSize: 'about 40 people',
  hiringContact: null,
  fetchedAt: FIXED_AT,
};

/** Write the scenario into the database (replacing the profile, facts, voice bank and learning list). */
export function seedScenario(opts: { state?: 'selected' | 'none' } = {}) {
  saveProfile(PROFILE);
  run("DELETE FROM settings WHERE key IN ('profile.links', 'profile.hiddenFacts')");
  run('DELETE FROM profile_facts');
  syncCvFacts(PROFILE, CV_REF);
  // Fixed dates so fact order (source, kind, added_at, id) is the same on every run.
  run('UPDATE profile_facts SET added_at = ?', FIXED_AT);
  run('DELETE FROM voice_bank');
  for (const v of VOICE) run('INSERT INTO voice_bank (id, prompt, text, tags, created_at) VALUES (?, ?, ?, ?, ?)', v.id, v.prompt, v.text, '[]', FIXED_AT);
  refreshStyle();
  run('DELETE FROM learning_list');
  for (const l of LEARNING) run('INSERT INTO learning_list (id, skill, status, started_at, notes) VALUES (?, ?, ?, ?, ?)', l.id, l.skill, l.status, l.status === 'learning' ? FIXED_AT : null, l.notes);
  invalidateMasterProfile();

  run('DELETE FROM applications WHERE job_id = ?', JOB_ID);
  run('DELETE FROM pipeline WHERE job_id = ?', JOB_ID);
  run('DELETE FROM jobs WHERE id = ?', JOB_ID);
  run(
    `INSERT INTO jobs (id, fingerprint, source, url, title, company, location, remote, category, description_text, tags, found_at, updated_at, match, apply_url_canonical)
     VALUES (?, ?, 'fixture', ?, ?, ?, ?, 0, 'software', ?, '[]', ?, ?, ?, ?)`,
    JOB_ID,
    `fp-${JOB_ID}`,
    'https://jobs.daftarpay.example.net/backend-payments',
    'Backend Engineer, Payments',
    COMPANY,
    'Lahore (hybrid)',
    POSTING,
    FIXED_AT,
    FIXED_AT,
    JSON.stringify(MATCH),
    'https://jobs.daftarpay.example.net/backend-payments',
  );
  const key = companyKey(COMPANY);
  run('DELETE FROM research_briefs WHERE company_key = ? OR company_key LIKE ?', key, `${key}|%`);
  run('INSERT INTO research_briefs (company_key, brief, fetched_at) VALUES (?, ?, ?)', `${key}|${DOMAIN}`, JSON.stringify(BRIEF), new Date().toISOString());
  if (opts.state !== 'none') {
    for (const s of ['found', 'filtered', 'scored', 'selected'] as const) transition(JOB_ID, s, { campaignId: CAMPAIGN_ID, reason: 'fixture' });
  }
}

/** Fact ids by text, for writing evidence maps that cite real facts. */
export function factIdOf(text: string): string {
  const row = get<{ id: string }>('SELECT id FROM profile_facts WHERE text = ? AND active = 1', text);
  if (!row) throw new Error(`No fact with text: ${text}\nKnown: ${all<{ text: string }>('SELECT text FROM profile_facts').map((r) => r.text).join(' | ')}`);
  return row.id;
}
