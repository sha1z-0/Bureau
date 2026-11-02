/**
 * A09's test world, shared by the selfcheck (scripts/checks/a09-inbox.ts) and
 * the fixture recorder (scripts/a09/record-fixtures.ts) so both send Claude
 * byte-identical prompts. Fictional candidate, fictional companies on
 * example.* domains, fixed dates. Import only after BUREAU_DATA_DIR is set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MasterProfile } from '../../server/contracts/profile.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** A11's shared corpus (indexed in index.json). */
export const MAIL_DIR = path.resolve(HERE, '..', '..', 'fixtures', 'mail');
/** A09's own fixtures, in a subfolder so A11's "every .eml is indexed" check stays true. */
export const A09_MAIL_DIR = path.join(MAIL_DIR, 'a09');

export const mailFile = (name: string) => path.join(name.startsWith('a09-') ? A09_MAIL_DIR : MAIL_DIR, name);
export const mailFiles = () =>
  fs
    .readdirSync(A09_MAIL_DIR)
    .filter((f) => f.startsWith('a09-') && f.endsWith('.eml'))
    .sort();

/** The class every fixture email must get. */
export const EXPECTED: Record<string, string> = {
  'a09-01-verify-workday.eml': 'verification_code',
  'a09-02-verify-greenhouse.eml': 'verification_code',
  'a09-03-verify-link-ashby.eml': 'verification_code',
  'a09-04-confirm-greenhouse.eml': 'confirmation_received',
  'a09-05-confirm-workday.eml': 'confirmation_received',
  'a09-06-reject-plain-lever.eml': 'rejection',
  'a09-07-reject-kind.eml': 'rejection',
  'a09-08-interview-calendly.eml': 'interview_invite',
  'a09-09-interview-times.eml': 'interview_invite',
  'a09-10-assessment-hackerrank.eml': 'assessment',
  'a09-11-assessment-takehome.eml': 'assessment',
  'a09-12-recruiter-relocation.eml': 'recruiter_question',
  'a09-13-recruiter-notice.eml': 'recruiter_question',
  'a09-14-offer.eml': 'offer',
  'a09-15-other-jobalert.eml': 'other',
  'a09-16-other-promo.eml': 'other',
  'a09-17-injection.eml': 'other',
  'a09-18-interview-goodtime.eml': 'interview_invite',
  'a09-19-reject-workday.eml': 'rejection',
  'a09-20-confirm-lever.eml': 'confirmation_received',
  'a09-21-verify-otp-html.eml': 'verification_code',
  'a09-22-other-ooo.eml': 'other',
  'a09-23-reschedule-unfortunately.eml': 'interview_invite',
  'a09-24-recruiter-agency-salary.eml': 'recruiter_question',
};

/** Fixtures the code pre-rules cannot settle: they go to Haiku (recorded responses). */
export const MODEL_CASES = ['a09-07-reject-kind.eml', 'a09-12-recruiter-relocation.eml', 'a09-13-recruiter-notice.eml', 'a09-17-injection.eml', 'a09-24-recruiter-agency-salary.eml'];

/** A11's shared corpus: labels come from fixtures/mail/index.json. */
export interface A11Mail {
  file: string;
  class: string;
  company: string | null;
  applicationHint: string | null;
  code: string | null;
}
export const a11Mail = (): A11Mail[] => (JSON.parse(fs.readFileSync(path.join(MAIL_DIR, 'index.json'), 'utf8')) as { messages: A11Mail[] }).messages;

/** A11 fixtures the code rules leave to the model (recorded responses). */
export const A11_MODEL_CASES = [
  'reject-personio-absage-kranich.eml',
  'reject-prompt-injection-pebble-analytics.eml',
  'interview-northwind-labs-reschedule-thursday.eml',
  'recruiter-notice-salary-brightwater-health.eml',
  'recruiter-relocate-berlin-lindenhof.eml',
  'recruiter-sourcer-cold-outreach-cobalt.eml',
  'offer-quillstack-verbal-followup.eml',
  'other-profile-views.eml',
  'other-phishing-lookalike-workday.eml',
];

/** Which application each fixture must link to (null: none). Verification mail is never linked. */
export const EXPECTED_LINK: Record<string, string | null> = {
  'a09-04-confirm-greenhouse.eml': 'northwind',
  'a09-05-confirm-workday.eml': 'bluefin',
  'a09-06-reject-plain-lever.eml': 'corvid',
  'a09-07-reject-kind.eml': 'harbor',
  'a09-08-interview-calendly.eml': 'lumen',
  'a09-09-interview-times.eml': 'quillstone',
  'a09-10-assessment-hackerrank.eml': 'northwind',
  'a09-11-assessment-takehome.eml': 'tallgrass',
  'a09-12-recruiter-relocation.eml': 'mosaic',
  'a09-13-recruiter-notice.eml': 'bluefin',
  'a09-14-offer.eml': 'lumen',
  'a09-15-other-jobalert.eml': null,
  'a09-16-other-promo.eml': null,
  'a09-17-injection.eml': null,
  'a09-18-interview-goodtime.eml': 'northwind',
  'a09-19-reject-workday.eml': 'ferro',
  'a09-20-confirm-lever.eml': 'corvid',
  'a09-22-other-ooo.eml': 'harbor',
  'a09-23-reschedule-unfortunately.eml': 'quillstone',
  'a09-24-recruiter-agency-salary.eml': null,
};

export interface AppSpec {
  key: string;
  company: string;
  domain: string;
  title: string;
  ats: string | null;
  url: string;
  sentAt: string;
  channel: 'ats' | 'email';
  toEmail: string | null;
  description: string;
  match?: { screenPassScore: number; requirements: { text: string; importance: string; match: string; blocker?: boolean; blockerKind?: string }[] };
}

const req = (text: string, importance: string, match: string, extra: Record<string, unknown> = {}) => ({ text, importance, evidence: 'stated', match, proof: '', blocker: false, ...extra });

export const APPS: AppSpec[] = [
  {
    key: 'northwind',
    company: 'Northwind Labs',
    domain: 'northwind.example.com',
    title: 'Backend Engineer',
    ats: 'greenhouse',
    url: 'https://boards.greenhouse.io/northwindlabs/jobs/4411002',
    sentAt: '2026-10-20T10:30:00.000Z',
    channel: 'ats',
    toEmail: null,
    description: 'Northwind Labs builds routing software for freight brokers. You will build Go and PostgreSQL services. Kafka experience is a plus.',
  },
  {
    key: 'bluefin',
    company: 'Bluefin Analytics',
    domain: 'bluefin.example.org',
    title: 'Data Engineer',
    ats: 'workday',
    url: 'https://bluefin.wd5.myworkdayjobs.com/en-US/BluefinCareers/job/Lahore/Data-Engineer_R-10442',
    sentAt: '2026-10-21T08:30:00.000Z',
    channel: 'ats',
    toEmail: null,
    description: 'Data Engineer (R-10442). Airflow, dbt and Snowflake. Python and SQL.',
  },
  {
    key: 'lumen',
    company: 'Lumen Pay',
    domain: 'lumenpay.example.net',
    title: 'Go Backend Developer',
    ats: null,
    url: 'https://lumenpay.example.net/careers/go-backend-developer',
    sentAt: '2026-10-22T09:00:00.000Z',
    channel: 'email',
    toEmail: 'careers@lumenpay.example.net',
    description:
      'Lumen Pay builds checkout and a double-entry ledger API for independent shops in Pakistan and the Gulf.\n\nYou will: build payout and ledger services in Go on PostgreSQL; run event streaming on Kafka; expose internal services over gRPC; deploy on Kubernetes.\n\nYou have: production Go; strong PostgreSQL; Kafka or another event streaming platform in production; gRPC service design; Kubernetes basics. Nice to have: observability with Prometheus and OpenTelemetry.\n\nApply by email to careers@lumenpay.example.net with your CV.',
    match: {
      screenPassScore: 71,
      requirements: [
        req('Production experience with Go', 'critical', 'met'),
        req('Strong PostgreSQL', 'important', 'met'),
        req('Kafka or another event streaming platform in production', 'critical', 'missing'),
        req('gRPC service design', 'important', 'partial'),
        req('Kubernetes basics for deploying services', 'important', 'missing'),
        req('Observability with Prometheus and OpenTelemetry', 'nice', 'partial'),
        req('Must be authorised to work in the UAE', 'nice', 'missing', { blocker: true, blockerKind: 'citizenship' }),
      ],
    },
  },
  {
    key: 'corvid',
    company: 'Corvid Security',
    domain: 'corvid.example.com',
    title: 'Security Analyst',
    ats: 'lever',
    url: 'https://jobs.lever.co/corvid/8f1e2d3c',
    sentAt: '2026-10-20T12:00:00.000Z',
    channel: 'ats',
    toEmail: null,
    description: 'Security Analyst on the SOC team. Splunk, incident response.',
  },
  {
    key: 'tallgrass',
    company: 'Tallgrass Games',
    domain: 'tallgrass.example.com',
    title: 'Gameplay Programmer',
    ats: 'ashby',
    url: 'https://jobs.ashbyhq.com/tallgrass/77aa1c2e',
    sentAt: '2026-10-23T09:00:00.000Z',
    channel: 'ats',
    toEmail: null,
    description: 'Gameplay Programmer. Unity and C#.',
  },
  {
    key: 'quillstone',
    company: 'Quillstone',
    domain: 'quillstone.example.io',
    title: 'Frontend Engineer',
    ats: null,
    url: 'https://quillstone.example.io/jobs/frontend-engineer',
    sentAt: '2026-10-19T09:00:00.000Z',
    channel: 'email',
    toEmail: 'jobs@quillstone.example.io',
    description: 'Frontend Engineer. React and TypeScript. Send your CV to jobs@quillstone.example.io.',
  },
  {
    key: 'harbor',
    company: 'Harbor Health',
    domain: 'harborhealth.example.com',
    title: 'Platform Engineer',
    ats: 'smartrecruiters',
    url: 'https://jobs.smartrecruiters.com/HarborHealth/7431',
    sentAt: '2026-10-21T10:00:00.000Z',
    channel: 'ats',
    toEmail: null,
    description: 'Platform Engineer. Kubernetes, Terraform, AWS.',
  },
  {
    key: 'mosaic',
    company: 'Mosaic Robotics',
    domain: 'mosaic.example.com',
    title: 'ML Engineer',
    ats: null,
    url: 'https://mosaic.example.com/careers/ml-engineer',
    sentAt: '2026-10-24T09:00:00.000Z',
    channel: 'ats',
    toEmail: null,
    description: 'ML Engineer in Berlin. PyTorch, MLOps.',
  },
  {
    key: 'ferro',
    company: 'Ferro Logistics',
    domain: 'ferro.example.com',
    title: 'Software Engineer',
    ats: 'workday',
    url: 'https://ferro.wd3.myworkdayjobs.com/External/job/Lahore/Software-Engineer_R-2207',
    sentAt: '2026-10-25T09:00:00.000Z',
    channel: 'ats',
    toEmail: null,
    description: 'Software Engineer (R-2207). Java and Spring Boot.',
  },
];

export const appId = (key: string) => `a09-app-${key}`;
export const jobId = (key: string) => `a09-job-${key}`;
export const companyId = (key: string) => `a09-co-${key}`;

/** The SMTP Message-ID A08 journaled when it emailed Lumen Pay (email 08 replies to it). */
export const LUMEN_SENT_ID = '<lumen-app-1@mail.bureau.example>';

/** A fixed candidate for plans and gap reports (never read from the shared database in tests). */
export const PROFILE: MasterProfile = {
  name: 'Ayesha Siddiqui',
  headline: 'Backend developer (Go, PostgreSQL)',
  email: 'ayesha.jobs@example.com',
  phone: '',
  location: 'Lahore, Pakistan',
  links: { github: 'https://github.com/ayesha-dev', portfolio: 'https://ayesha.example.com/', linkedin: '', socials: [] },
  summary: 'Backend developer who builds bookkeeping and payments software for small shops.',
  yearsExperience: 1.5,
  seniority: 'junior',
  categories: ['web'],
  targetRoles: ['Backend Engineer', 'Go Developer'],
  coreStack: ['Go', 'PostgreSQL', 'TypeScript', 'Docker'],
  skills: ['REST APIs', 'Linux', 'Git', 'sqlc'],
  experience: [
    {
      role: 'Backend Developer',
      company: 'Khan Hardware',
      location: 'Lahore',
      start: 'Jan 2025',
      end: 'Present',
      bullets: ["Built the store's bookkeeping API in Go and PostgreSQL.", 'Cut month-end closing from 3 days to 2 hours.', 'Posts about 400 ledger entries a day across two branches.'],
    },
  ],
  projects: [
    { name: 'LedgerLite', link: 'https://github.com/ayesha-dev/ledgerlite', description: 'Double-entry bookkeeping API in Go with PostgreSQL and sqlc.', highlights: ['Runs a two-branch hardware store', 'Sub-50ms queries on a $5 VPS'] },
    { name: 'tokio-tracing-fix', link: 'https://github.com/ayesha-dev/tokio-tracing-fix', description: 'Fixed a span leak in tracing-subscriber across await points.', highlights: ['Cut span memory from 1.2 GB to 140 MB'] },
  ],
  education: [{ school: 'FAST NUCES Lahore', degree: 'BS Computer Science', start: '2023', end: '2027', details: '' }],
  certifications: [],
  languages: ['English', 'Urdu'],
  achievements: ['First place, FAST NUCES Lahore hackathon 2025'],
  voice: '',
  cvMarkdown: '# Ayesha Siddiqui',
  portfolioNotes: '',
  preferences: {
    targetRoles: ['Backend Engineer'],
    categories: ['web'],
    locations: ['Lahore', 'Remote'],
    remoteOnly: false,
    openToRelocation: false,
    needsSponsorship: false,
    minSalary: 0,
    currency: 'USD',
    excludeCompanies: [],
    excludeKeywords: [],
    tone: '',
    signature: '',
    workAuthorization: '',
    noticePeriod: 'One month',
    salaryExpectation: '',
    extraAnswers: '',
  },
  facts: [
    { id: 'f1', kind: 'metric', text: 'Cut month-end closing from 3 days to 2 hours.', source: 'cv', sourceRef: 'CV', addedAt: '2026-10-01T00:00:00.000Z', active: true },
    { id: 'f2', kind: 'project', text: 'LedgerLite handles 3 years of transactions for 2 shops with sub-50ms queries on a $5 VPS.', source: 'github', sourceRef: 'https://github.com/ayesha-dev/ledgerlite', addedAt: '2026-10-01T00:00:00.000Z', active: true },
    { id: 'f3', kind: 'metric', text: 'Cut span memory in a worker from 1.2 GB to 140 MB over a day of traffic.', source: 'github', sourceRef: 'https://github.com/ayesha-dev/tokio-tracing-fix', addedAt: '2026-10-01T00:00:00.000Z', active: true },
    { id: 'f4', kind: 'experience', text: "I mentor first-year students in the university's programming club every week.", source: 'portfolio', sourceRef: 'https://ayesha.example.com/about', addedAt: '2026-10-01T00:00:00.000Z', active: true },
  ],
  voiceBank: [],
  answerBank: [],
  learning: [{ id: 'l1', skill: 'Kubernetes', status: 'learning', startedAt: '2026-10-15T00:00:00.000Z', notes: '' }],
  github: null,
  style: null,
};

/** Lumen Pay's research brief, written into the cache so plans see the same stack every run. */
export const LUMEN_BRIEF = {
  company: 'Lumen Pay',
  domain: 'lumenpay.example.net',
  whatTheyBuild: 'Checkout and a double-entry ledger API for independent retailers.',
  products: [],
  recent: [],
  techSignals: [
    { text: 'Backend written in Go on PostgreSQL', sourceUrl: 'https://lumenpay.example.net/engineering' },
    { text: 'Payments team uses Go, PostgreSQL and Kafka', sourceUrl: 'https://lumenpay.example.net/careers' },
    { text: 'Moved the ledger to PostgreSQL logical replication', sourceUrl: 'https://lumenpay.example.net/engineering' },
  ],
  values: [],
  stage: 'Series A (2026)',
  teamSize: 'about 40 people',
  hiringContact: null,
  fetchedAt: '2026-10-20T00:00:00.000Z',
};

/** Gap-report world: jobs scored in ISO week 2026-W40 (28 Sep – 4 Oct 2026). */
export const GAP_PERIOD = '2026-W40';
export const GAP_JOBS: { key: string; score: number; requirements: ReturnType<typeof req>[] }[] = [
  {
    key: 'g1',
    score: 82,
    requirements: [
      req('3+ years with Kafka in production', 'critical', 'missing'),
      req('Kubernetes and Helm', 'important', 'missing'),
      req('gRPC APIs', 'important', 'partial'),
      req('Go', 'critical', 'met'),
    ],
  },
  {
    key: 'g2',
    score: 74,
    requirements: [
      req('Experience with an event streaming platform', 'important', 'missing'),
      req('Terraform for infrastructure as code', 'important', 'missing'),
      req('Strong communication skills', 'important', 'partial'),
      req('Kubernetes in production', 'critical', 'missing'),
    ],
  },
  {
    key: 'g3',
    score: 65,
    requirements: [
      req('Kafka Streams', 'important', 'missing'),
      req('AWS (ECS, Lambda)', 'important', 'partial'),
      req("Bachelor's degree in Computer Science", 'critical', 'missing', { blocker: true, blockerKind: 'degree' }),
      req('Prometheus and Grafana monitoring', 'nice', 'missing'),
    ],
  },
  {
    key: 'g4',
    score: 58,
    requirements: [req('Terraform', 'important', 'partial'), req('Kubernetes operators', 'nice', 'missing'), req('Rust for performance-critical services', 'nice', 'missing')],
  },
  {
    key: 'g5',
    score: 90,
    requirements: [req('Advanced gRPC and protobuf schema design', 'critical', 'partial'), req('AWS', 'important', 'missing'), req('5+ years of professional experience', 'critical', 'missing', { blockerKind: 'years' })],
  },
];

export const GAP_SCORED_AT = '2026-09-30T12:00:00.000Z';

/** Seed everything. Idempotent. */
export async function seed() {
  const { run, get } = await import('../../server/db.ts');
  await import('../../server/campaign/schema.ts');
  await import('../../server/inbox/schema.ts');
  const { companyKey } = await import('../../server/research/index.ts');
  const ts = '2026-10-01T00:00:00.000Z';
  for (const a of APPS) {
    run(
      `INSERT INTO companies (id, name, domain, ats, status) VALUES (?, ?, ?, ?, 'active')
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, domain = excluded.domain, ats = excluded.ats`,
      companyId(a.key),
      a.company,
      a.domain,
      a.ats,
    );
    const applyEmail = a.toEmail;
    run(
      `INSERT INTO jobs (id, fingerprint, source, url, title, company, category, description_text, apply_email, found_at, updated_at, ats, company_id, match, scored_at, ai_score, stage)
       VALUES (?, ?, 'a09-fixture', ?, ?, ?, 'software', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied')
       ON CONFLICT(id) DO UPDATE SET match = excluded.match, description_text = excluded.description_text, stage = 'applied'`,
      jobId(a.key),
      `a09-fp-${a.key}`,
      a.url,
      a.title,
      a.company,
      a.description,
      applyEmail,
      ts,
      ts,
      a.ats,
      companyId(a.key),
      a.match ? JSON.stringify({ jobId: jobId(a.key), grade: 'B', dimensions: {}, legitimacy: 'ok', verdict: '', strengths: [], gaps: [], atsKeywords: [], stretch: { unmetImportant: 2, blockers: [] }, ...a.match }) : null,
      a.match ? '2026-10-21T00:00:00.000Z' : null,
      a.match?.screenPassScore ?? null,
    );
    run(
      `INSERT INTO applications (id, job_id, status, channel, to_email, sent_at, stage, created_at, updated_at)
       VALUES (?, ?, 'sent', ?, ?, ?, 'applied', ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = 'sent', stage = 'applied', sent_at = excluded.sent_at`,
      appId(a.key),
      jobId(a.key),
      a.channel,
      a.toEmail,
      a.sentAt,
      a.sentAt,
      a.sentAt,
    );
  }
  if (!get("SELECT 1 FROM campaign_steps WHERE job_id = ? AND step = 'submit_done'", jobId('lumen'))) {
    run(
      "INSERT INTO campaign_steps (ts, campaign_id, job_id, step, status, detail) VALUES (?, NULL, ?, 'submit_done', 'email', ?)",
      '2026-10-22T09:00:00.000Z',
      jobId('lumen'),
      JSON.stringify({ messageId: LUMEN_SENT_ID }),
    );
  }
  // Only our brief for Lumen Pay (another suite may have cached its own).
  const key = companyKey('Lumen Pay');
  run('DELETE FROM research_briefs WHERE company_key = ? OR company_key LIKE ?', key, `${key}|%`);
  run('INSERT INTO research_briefs (company_key, brief, fetched_at) VALUES (?, ?, ?)', `${key}|lumenpay.example.net`, JSON.stringify(LUMEN_BRIEF), new Date().toISOString());

  for (const g of GAP_JOBS) {
    const match = { jobId: `a09-gap-${g.key}`, screenPassScore: g.score, grade: 'B', requirements: g.requirements, dimensions: {}, legitimacy: 'ok', verdict: '', strengths: [], gaps: [], atsKeywords: [], stretch: { unmetImportant: 1, blockers: [] } };
    run(
      `INSERT INTO jobs (id, fingerprint, source, url, title, company, category, found_at, updated_at, match, scored_at, ai_score)
       VALUES (?, ?, 'a09-fixture', ?, 'Backend Engineer', ?, 'software', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET match = excluded.match, scored_at = excluded.scored_at`,
      `a09-gap-${g.key}`,
      `a09-gap-fp-${g.key}`,
      `https://jobs.example.com/${g.key}`,
      `Gapco ${g.key.toUpperCase()}`,
      ts,
      ts,
      JSON.stringify(match),
      GAP_SCORED_AT,
      g.score,
    );
  }
}

/** The fixed inputs for the recorded learning plan (Lumen Pay, from email 08). */
export const LUMEN_PLAN = { interviewDate: '2026-11-09', startAt: '2026-11-02T10:05:00.000Z' };
