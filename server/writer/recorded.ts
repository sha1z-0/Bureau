import { BRIEF, PROFILE } from './fixtures.ts';

/**
 * The hand-written Claude responses behind A04's recordings, keyed by the
 * writer's step label. server/writer/record-fixtures.ts runs the pipeline on
 * the fixture scenario with these answers and saves each as
 * fixtures/claude/<task>/<hash>.json; the selfcheck replays them through the
 * real `structured()`. The gate tests reuse and corrupt them.
 *
 * The story: the letters call drafts three variants (two with flaws a
 * skeptical reader would catch), the critic scores them and demands fixes for
 * two, the revision fixes those, the bandit (seed 3) picks the story letter,
 * the humanizer removes one AI-vocabulary word the critic let through, the
 * truth lock is clean, and the final critic re-scores the edited letter.
 */

const URL = `https://${BRIEF.domain}`;

export const LETTER_HOOK_DRAFT = `Dear Daftar Pay Payments team,

I am writing to apply for the Backend Engineer, Payments role. Your engineering post on moving Daftar Pay's ledger to PostgreSQL logical replication, so reconciliation reads never block posting, describes a problem I've been living with on a much smaller scale. My family runs a hardware store in Lahore. For years the books lived in a paper ledger that only my uncle could read, and every month-end he'd lose three days to it.

So I learned Go and PostgreSQL from the docs and a lot of trial and error, and built him a double-entry bookkeeping API. I am excited to bring my skills to your team. The hard part wasn't the code. It was the accounting. Now it posts about 400 entries a day across both branches, and month-end closing takes 2 hours instead of 3 days.

I haven't run anything on AWS or Kubernetes in production. I'm learning both now: a small k3s cluster at home runs LedgerLite's staging copy, and I'm working through the AWS Developer Associate course at night.

Could we talk next week about how your team keeps posting idempotent?

Best,
Ayesha Khan`;

export const LETTER_HOOK = `Dear Daftar Pay Payments team,

Your engineering post on moving Daftar Pay's ledger to PostgreSQL logical replication, so reconciliation reads never block posting, describes a problem I've been living with on a much smaller scale. My family runs a hardware store in Lahore. For years the books lived in a paper ledger that only my uncle could read, and every month-end he'd lose three days to it.

So I learned Go and PostgreSQL from the docs and a lot of trial and error, and built him a double-entry bookkeeping API. The hard part wasn't the code, honestly. It was the accounting. I had to learn why every debit needs a credit before I could write a single migration, and I got it wrong twice. Now it posts about 400 entries a day across both branches, and month-end closing takes 2 hours instead of 3 days.

I'll be straight about the gap. I haven't run anything on AWS or Kubernetes in production. I'm learning both now: a small k3s cluster at home runs LedgerLite's staging copy, and I'm working through the AWS Developer Associate course at night. I learned Go in about three weeks because I had to, and I'd learn your stack the same way: pick a real problem, build the smallest thing that works, then make it right.

Could we talk next week about how your team keeps posting idempotent?

Best,
Ayesha Khan`;

export const LETTER_PROOF_DRAFT = `Dear Daftar Pay Payments team,

I cut month-end closing at my family's hardware store from 3 days to 2 hours, and your Backend Engineer, Payments role reads like the grown-up version of that job. The store's books lived in a paper ledger that only my uncle could read. So I built LedgerLite, a double-entry bookkeeping API in Go and PostgreSQL, and it now runs both branches.

The hard part wasn't the code. It was the accounting: I had to learn why every debit needs a credit before I could write a single migration, and I got it wrong twice. It posts about 400 ledger entries a day with sub-50ms queries on a $5 VPS. Reconciliation is automated, which is where the 3 days went.

Your posting also asks for instrumentation with OpenTelemetry and Prometheus. The closest thing I've done is a memory leak in a Rust worker. I spent two evenings reading tracing-subscriber's source before I saw it: spans dropped across await points were never freed. Getting the fix merged upstream took a week of review, and span memory went from 1.2 GB to 140 MB.

AWS and Kubernetes are new to me. I'm learning Kubernetes on a small k3s cluster at home, and I'm working through the AWS Developer Associate course at night.

In short, my ledger experience and fast learning would make me a strong fit for your team.

Best,
Ayesha Khan`;

export const LETTER_PROOF = `Dear Daftar Pay Payments team,

I cut month-end closing at my family's hardware store from 3 days to 2 hours, and your Backend Engineer, Payments role reads like the grown-up version of that job. The store's books lived in a paper ledger that only my uncle could read. So I built LedgerLite, a double-entry bookkeeping API in Go and PostgreSQL, and it now runs both branches.

The hard part wasn't the code. It was the accounting: I had to learn why every debit needs a credit before I could write a single migration, and I got it wrong twice. It posts about 400 ledger entries a day with sub-50ms queries on a $5 VPS. Reconciliation is automated, which is where the 3 days went.

Your posting also asks for instrumentation with OpenTelemetry and Prometheus. The closest thing I've done is a memory leak in a Rust worker. I spent two evenings reading tracing-subscriber's source before I saw it: spans dropped across await points were never freed. Getting the fix merged upstream took a week of review, and span memory went from 1.2 GB to 140 MB.

AWS and Kubernetes are new to me. I'm learning Kubernetes on a small k3s cluster at home, and I'm working through the AWS Developer Associate course at night.

Would you be open to a short call next week? I'd like to hear how you keep posting idempotent.

Best,
Ayesha Khan`;

/** The story letter as drafted: one AI-vocabulary word ("crucial") the critic lets through and the humanizer catches. */
export const LETTER_STORY_DRAFT = `Dear Daftar Pay Payments team,

The week before Eid, the busiest week of the year, my family's hardware store lost its spreadsheet, and that week is the reason I'm applying to work on Daftar Pay's ledger. I'd promised my uncle a replacement. I learned Go in about three weeks because I had to: I read the tour, wrote small programs every night and asked a lot of dumb questions on the Gophers Slack. It wasn't pretty code. But it shipped, it balanced, and nobody lost a sale.

That replacement grew into LedgerLite, a double-entry bookkeeping API in Go and PostgreSQL that runs both branches of the store. It posts about 400 entries a day, and month-end closing takes 2 hours instead of 3 days. My uncle checks the balance sheet on his phone. He still prints it out, though.

Your Backend Engineer, Payments posting asks for idempotent posting and clean reconciliation, which is the crucial part of this work for me. It also asks for AWS and Kubernetes, and I haven't used either in production. I run a small k3s cluster on two old laptops at home for LedgerLite's staging copy, and I'm working through the AWS Developer Associate course at night.

Could we find half an hour next week to talk about your ledger?

Best,
Ayesha Khan`;

export const HUMANIZE_FIND = 'which is the crucial part of this work for me';
export const HUMANIZE_REPLACE = 'which is the part of this work I like most';
export const LETTER_STORY = LETTER_STORY_DRAFT.replace(HUMANIZE_FIND, HUMANIZE_REPLACE);

export const SUBJECTS = [
  'Backend Engineer, Payments: I built a double-entry ledger in Go',
  'Backend Engineer, Payments: month-end close from 3 days to 2 hours',
  'Payments role: a Go and PostgreSQL ledger for a two-branch store',
  'Backend Engineer application: ledger reconciliation in Go',
  'Your logical replication post, and the Backend Engineer role',
];

export const OUTREACH = `Hi, I read Daftar Pay's post on moving the ledger to PostgreSQL logical replication and wanted to say hello. I built LedgerLite, a double-entry bookkeeping API in Go and PostgreSQL that runs both branches of my family's hardware store; it cut month-end closing from 3 days to 2 hours. I've applied for the Backend Engineer, Payments role. I'm learning Kubernetes and AWS now, and I'd value a few minutes to hear how your team keeps posting idempotent. Thanks, Ayesha`;

export const FOLLOW_UP = `Dear Daftar Pay Payments team,

I applied for the Backend Engineer, Payments role last week and wanted to add one thing I left out. I'm learning Kubernetes on a small k3s cluster at home, and LedgerLite's staging copy runs on it, so I've already broken it a fair few times. Half of what I know so far came from that.

If it would help, I'm happy to walk someone on your team through how LedgerLite keeps the books balanced. Is there a good time next week?

Best,
Ayesha Khan`;

export const SHORT_ANSWERS = [
  {
    key: 'why us',
    answer:
      "Daftar Pay is building for thousands of shops the thing I built for one. My family's hardware store ran on a paper ledger until I wrote LedgerLite, a double-entry bookkeeping API in Go and PostgreSQL. Your post on moving the ledger to PostgreSQL logical replication so reconciliation never blocks posting is the kind of problem I want to spend my days on. And \"every rupee accounted for\" is how my uncle talks about his books.",
  },
  {
    key: 'why this role',
    answer:
      "The Backend Engineer, Payments role is about the part of software I already love: keeping a ledger correct. I automated reconciliation at my family's store and cut month-end closing from 3 days to 2 hours. The role also asks for AWS and Kubernetes, which I'm learning now, and I'd rather learn them on a team that cares about idempotent posting than on my own.",
  },
  {
    key: 'tell us about a project',
    answer:
      "LedgerLite is a double-entry bookkeeping API I wrote in Go with PostgreSQL and sqlc for my family's hardware store. The hard part wasn't the code; it was the accounting. I had to learn why every debit needs a credit before I could write a single migration, and I got it wrong twice. It now runs both branches and posts about 400 entries a day, and month-end closing takes 2 hours instead of 3 days.",
  },
];

const scores = (specificity: number, evidence: number, voice: number, clarity: number, ask: number, aiTells: number) => ({ specificity, evidence, voice, clarity, ask, aiTells });

/** Responses per step label. `fid` resolves a fact's text to its id in the seeded database. */
export function cannedResponses(fid: (text: string) => string): Record<string, unknown> {
  return {
    evidence: {
      priorities: [
        'Keep a double-entry ledger correct as payment volume grows',
        'Ship Go services that move money safely: idempotent posting and reconciliation',
        'Run on AWS today and on the new Kubernetes platform',
        'Instrument services from day one',
      ],
      mustWins: ['Go services in production', 'Ledger correctness: idempotent posting and reconciliation', 'PostgreSQL in production'],
      tone: 'Plain and practical; a small team that writes design docs before code',
      seniority: 'Mid-level on paper (2+ years), open to someone who already understands ledgers',
      hooks: [
        { text: BRIEF.recent[1].text, sourceUrl: `${URL}/blog/logical-replication` },
        { text: 'Mission line: "Every rupee accounted for"', sourceUrl: `${URL}/about` },
        // Not in the brief: code must drop it.
        { text: 'Named one of Asia’s top fintechs by a trade magazine', sourceUrl: 'https://example.org/top-fintechs' },
      ],
      items: [
        {
          requirement: 'Go',
          importance: 'critical',
          factIds: [fid('Go'), fid("Built the store's bookkeeping API in Go and PostgreSQL, replacing a paper ledger across two branches."), 'cv_0000000000000000'],
          evidence: "Built the store's bookkeeping API and LedgerLite in Go",
          framing: 'direct',
          phrasing: 'Go services in production: the bookkeeping API that runs both branches of the store',
        },
        {
          requirement: 'PostgreSQL in production',
          importance: 'critical',
          factIds: [fid('PostgreSQL'), fid('The API posts about 400 ledger entries a day with sub-50ms queries on a $5 VPS.')],
          evidence: 'LedgerLite on PostgreSQL: about 400 ledger entries a day, sub-50ms queries',
          framing: 'direct',
          phrasing: 'PostgreSQL in production behind a double-entry ledger',
        },
        {
          requirement: 'Experience with payments, accounting or ledgers',
          importance: 'important',
          factIds: [fid('LedgerLite: A double-entry bookkeeping API for small shops, written in Go with PostgreSQL and sqlc.'), fid('Cut month-end closing from 3 days to 2 hours by automating reconciliation.')],
          evidence: 'Double-entry bookkeeping API; automated reconciliation cut month-end closing from 3 days to 2 hours',
          framing: 'direct',
          phrasing: 'Double-entry ledger and automated reconciliation (month-end close from 3 days to 2 hours)',
        },
        { requirement: '2+ years of backend experience', importance: 'important', factIds: [], evidence: '', framing: 'omit', phrasing: '' },
        { requirement: 'AWS', importance: 'important', factIds: ['learn-aws'], evidence: 'On the learning list: AWS Developer Associate course', framing: 'learning', phrasing: 'Learning AWS now, working through the AWS Developer Associate course' },
        { requirement: 'Kubernetes', importance: 'important', factIds: ['learn-k8s'], evidence: 'On the learning list: k3s cluster at home', framing: 'learning', phrasing: 'Learning Kubernetes on a k3s cluster that runs the LedgerLite staging copy' },
        {
          requirement: 'Instrumentation with OpenTelemetry and Prometheus',
          importance: 'important',
          factIds: [
            fid('tokio-tracing-fix: An upstream fix for a span leak in Rust tracing-subscriber when spans were dropped across await points.'),
            fid('Span memory in a worker dropped from 1.2 GB to 140 MB over a day of traffic.'),
          ],
          evidence: 'Found and fixed a span leak in Rust tracing-subscriber; span memory from 1.2 GB to 140 MB',
          framing: 'transferable',
          phrasing: 'Debugged tracing span lifecycles in Rust, the same span model your OpenTelemetry instrumentation uses',
        },
        {
          requirement: 'Clear design docs',
          importance: 'nice',
          factIds: [fid('tokio-tracing-fix: An upstream fix for a span leak in Rust tracing-subscriber when spans were dropped across await points.')],
          evidence: 'Took an upstream fix through maintainer review',
          framing: 'transferable',
          phrasing: 'Explained a subtle fix well enough to get it merged upstream',
        },
        { requirement: 'Kafka', importance: 'nice', factIds: [], evidence: '', framing: 'omit', phrasing: '' },
      ],
      biggestGap: 'AWS and Kubernetes in production',
      fastLearning: 'vb-learned-fast',
    },

    cv: {
      cv: {
        name: PROFILE.name,
        headline: 'Backend developer: Go, PostgreSQL and double-entry ledgers',
        contact: { email: PROFILE.email, phone: PROFILE.phone, location: PROFILE.location, links: [{ label: 'GitHub', url: 'https://github.com/ayesha-dev' }, { label: 'Portfolio', url: 'https://ayesha.example.com' }] },
        summary:
          'Backend developer who built and runs a double-entry bookkeeping API in Go and PostgreSQL for a two-branch store, and cut month-end closing from 3 days to 2 hours by automating reconciliation. Currently learning Kubernetes and AWS.',
        skills: [
          { group: 'Backend', items: ['Go', 'PostgreSQL', 'sqlc', 'REST APIs', 'Node.js', 'TypeScript'] },
          // Kubernetes is a gap skill (on the learning list): code moves it to "Currently learning".
          { group: 'Infrastructure', items: ['Docker', 'Linux', 'Google Cloud', 'Kubernetes'] },
          { group: 'Other', items: ['Rust', 'Git'] },
          { group: 'Currently learning', items: ['AWS'] },
        ],
        experience: [
          {
            role: 'Backend Developer',
            company: 'Khan Hardware',
            location: 'Lahore',
            start: 'Jan 2025',
            end: 'Present',
            bullets: [
              'Cut month-end closing from 3 days to 2 hours by automating reconciliation.',
              "Built the store's bookkeeping API in Go and PostgreSQL, replacing a paper ledger across two branches.",
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
            bullets: ['Wrote integration tests that caught 12 regressions before release.', 'Contributed to a REST API for a logistics client in Node.js and TypeScript.'],
          },
        ],
        projects: [
          { name: 'LedgerLite', link: 'https://github.com/ayesha-dev/ledgerlite', description: 'A double-entry bookkeeping API for small shops, written in Go with PostgreSQL and sqlc.', highlights: ['Runs 3 years of transactions for 2 shops.'] },
          {
            name: 'tokio-tracing-fix',
            link: 'https://github.com/ayesha-dev/tokio-tracing-fix',
            description: 'An upstream fix for a span leak in Rust tracing-subscriber when spans were dropped across await points.',
            highlights: ['Span memory in a worker dropped from 1.2 GB to 140 MB over a day of traffic.'],
          },
          { name: 'Pixel Pantry', link: 'https://github.com/ayesha-dev/pixel-pantry', description: 'A recipe-sharing PWA that works offline.', highlights: ['300 home cooks used it during the beta.'] },
        ],
        education: [{ school: 'FAST NUCES Lahore', degree: 'BS Computer Science', start: '2023', end: '2027', details: 'Expected June 2027.' }],
        certifications: [],
      },
      emphasis: ['Opened with ledger correctness and the month-end result', 'Go and PostgreSQL first in skills, in the posting’s words', 'Kubernetes and AWS shown as learning, not as skills'],
      keywordsUsed: ['Go', 'PostgreSQL', 'double-entry', 'reconciliation'],
    },

    letters: {
      variants: [
        { strategy: 'hook', passagesUsed: ['vb-why-build', 'vb-proudest', 'vb-learning-now'], text: LETTER_HOOK_DRAFT },
        { strategy: 'proof', passagesUsed: ['vb-proudest', 'vb-hard-bug', 'vb-learning-now'], text: LETTER_PROOF_DRAFT },
        { strategy: 'story', passagesUsed: ['vb-learned-fast', 'vb-proudest', 'vb-learning-now'], text: LETTER_STORY_DRAFT },
      ],
      subjects: SUBJECTS,
      outreach: OUTREACH,
      followUp: FOLLOW_UP,
    },

    critic: {
      variants: [
        {
          strategy: 'hook',
          score: 6.9,
          scores: scores(8, 8, 7, 7, 7, 4),
          demands: [
            'Cut the opener "I am writing to apply for the Backend Engineer, Payments role." Start with the logical replication post itself.',
            'Delete "I am excited to bring my skills to your team." It says nothing; put the debit-and-credit story back in its place.',
          ],
        },
        {
          strategy: 'proof',
          score: 7.6,
          scores: scores(8, 9, 8, 8, 7, 6),
          demands: ['Delete the last line "In short, my ledger experience and fast learning would make me a strong fit for your team." It restates the letter. End on a concrete ask instead.'],
        },
        { strategy: 'story', score: 8.3, scores: scores(8, 8, 9, 8, 8, 8), demands: [] },
      ],
      bestSubject: 1,
    },

    revise: {
      variants: [
        { strategy: 'hook', passagesUsed: ['vb-why-build', 'vb-proudest', 'vb-learned-fast', 'vb-learning-now'], text: LETTER_HOOK },
        { strategy: 'proof', passagesUsed: ['vb-proudest', 'vb-hard-bug', 'vb-learning-now'], text: LETTER_PROOF },
      ],
    },

    critic_rescore: {
      variants: [
        { strategy: 'hook', score: 8.8, scores: scores(9, 9, 9, 8, 8, 9), demands: [] },
        { strategy: 'proof', score: 8.5, scores: scores(8, 9, 8, 9, 8, 8), demands: [] },
      ],
      bestSubject: 1,
    },

    humanize: {
      edits: [{ find: HUMANIZE_FIND, replace: HUMANIZE_REPLACE, reason: 'ai-vocabulary: "crucial" reads as model filler; her own phrasing is plainer' }],
    },

    short_answers: { answers: SHORT_ANSWERS },

    audit: {
      issues: [
        {
          claim: 'the busiest week of the year',
          reason: 'A personal anecdote from the voice bank; not checkable against the facts, and consistent with them.',
          severity: 'low',
        },
      ],
    },

    critic_final: {
      variants: [{ strategy: 'story', score: 8.6, scores: scores(8, 8, 9, 9, 8, 9), demands: [] }],
      bestSubject: 1,
    },
  };
}
