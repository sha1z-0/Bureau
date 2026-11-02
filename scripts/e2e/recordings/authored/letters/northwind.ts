import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Northwind Labs team,

Northwind's post on migrating the bookings table without downtime landed close to home, because expand-then-contract is a step I added to our migration checklist after learning it the hard way. In my first month at Tessellate Labs I shipped a migration that renamed a column without a fallback, and the admin screen went blank. My lead didn't shout. She asked me to write up what happened and to add the step to the checklist. I did both. Since then I write the rollback before the migration, every time, even when it feels silly for a two-line change.

That habit matters more as tables grow. I built and maintain the invoicing service at Tessellate, in Node.js, TypeScript and PostgreSQL, which issues about 9,000 invoices a month. When our nightly reconciliation job started overlapping with the morning invoice run, I spent a day reading EXPLAIN output and rewrote it as set-based SQL with two partial indexes. It went from 41 minutes to 6.

I haven't used NestJS. I've built APIs with Fastify, including ledger-lite, and I review pull requests for the billing team, so I'd expect the framework to be the easy part.

Would you have time for a short call about the Core API squad?

Best regards,
Rania Haroon`;

const proof = `Dear Northwind Labs team,

I cut our nightly reconciliation job at Tessellate Labs from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes, and I think that experience would be valuable for keeping your p95 latency under 150 ms.

I have two years of experience with Node.js, TypeScript and PostgreSQL. I built and maintain the invoicing service that issues about 9,000 invoices a month, and I built React admin screens for refunds and credit notes. I also moved four services to Docker Compose and wrote the runbook our on-call rotation uses.

I review pull requests for the billing team and always try to write clear descriptions and ask questions early.

I haven't used NestJS, BullMQ or Redis yet, but I am confident I can learn them quickly.

I look forward to hearing from you.

Best regards,
Rania Haroon`;

const story = `Dear Northwind Labs team,

Nobody at work had written a Dockerfile when our VPS provider announced a migration with two weeks' notice. I volunteered, mostly because I didn't want to be the one restoring things by hand at 2am. I read the Compose docs on the bus and broke my laptop's networking twice. We moved four services, and the runbook I wrote is still pinned in our channel, typos included.

I tell that story because Northwind's support rota, one week in six, is the same kind of work: someone else's integration is broken and you have to learn their setup fast.

At Tessellate Labs I build Node.js and TypeScript services on PostgreSQL. The invoicing service I maintain issues about 9,000 invoices a month, and I cut our reconciliation job from 41 minutes to 6 with set-based SQL.

I haven't used NestJS. I've built Fastify APIs, so the move should be gentle.

I'd love to chat if you think I could be a fit.

Best regards,
Rania Haroon`;

export const northwind: Application = {
  company: 'Northwind Labs',
  evidence: {
    priorities: [
      'Endpoints in a Node.js and TypeScript (NestJS) API used by customer developers',
      'PostgreSQL migrations that run safely on large, busy tables',
      'Tests and latency kept in check',
      'Clear pull requests and early questions on a remote team',
    ],
    mustWins: ['Node.js and TypeScript in production', 'Solid PostgreSQL and safe migrations', 'Clear written communication'],
    tone: 'Direct and practical; written by engineers for engineers',
    seniority: 'Junior (1+ years), joining a four-person squad',
    hooks: [
      { text: 'Blog post on migrating the bookings table without downtime using expand-and-contract steps (2026-10).', sourceUrl: 'https://northwindlabs.example.com/blog/zero-downtime-migrations' },
      { text: 'Webhooks v2 with signed payloads and retries (2026-08).', sourceUrl: 'https://northwindlabs.example.com/docs/webhooks' },
    ],
    items: [
      { requirement: '1+ years of professional experience with Node.js and TypeScript', importance: 'critical', factIds: ['f-exp-tessellate', 'f-tess-invoicing'], evidence: 'Junior Software Engineer at Tessellate Labs since Jul 2023; built the Node.js/TypeScript invoicing service', framing: 'direct', phrasing: 'two years of Node.js and TypeScript in production' },
      { requirement: 'Solid SQL skills and experience with PostgreSQL', importance: 'critical', factIds: ['f-tess-recon', 'f-skill-pg'], evidence: 'Reconciliation job from 41 to 6 minutes with set-based SQL and partial indexes', framing: 'direct', phrasing: 'PostgreSQL performance work on a live billing database' },
      { requirement: 'Migrations that run safely on large tables', importance: 'important', factIds: ['f-tess-invoicing'], evidence: 'Maintains the invoicing schema; adopted expand-then-contract after a failed rename (voice bank)', framing: 'transferable', phrasing: 'expand-then-contract migrations with the rollback written first' },
      { requirement: 'Clear pull-request descriptions; ask questions early', importance: 'important', factIds: ['f-tess-review'], evidence: 'Reviews pull requests for the billing team', framing: 'direct', phrasing: 'reviews pull requests for the billing team' },
      { requirement: 'Improve our test suite', importance: 'important', factIds: ['f-kestrel-tests'], evidence: 'Raised loader test coverage from 0 to 71% with pytest', framing: 'transferable', phrasing: 'took an untested loader to 71% coverage' },
      { requirement: 'NestJS', importance: 'nice', factIds: ['f-skill-fastify', 'f-proj-ledger'], evidence: 'Fastify APIs (ledger-lite), not NestJS', framing: 'transferable', phrasing: 'Node.js APIs in Fastify; NestJS would be new' },
      { requirement: 'Redis or message queues (BullMQ, SQS)', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'Docker', importance: 'nice', factIds: ['f-tess-docker'], evidence: 'Moved four services to Docker Compose', framing: 'direct', phrasing: 'moved four services to Docker Compose' },
      { requirement: 'Remote between UTC-1 and UTC+6', importance: 'critical', factIds: [], evidence: 'Logistics, not a claim: Lahore is UTC+5', framing: 'omit', phrasing: '' },
    ],
    biggestGap: 'No NestJS (Fastify only)',
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Junior Backend Engineer: Node.js, TypeScript, PostgreSQL',
    summary:
      'Junior software engineer with two years of production Node.js and TypeScript on PostgreSQL. Writes migrations with the rollback first, cut a nightly reconciliation job from 41 minutes to 6, and reviews pull requests for the billing team.',
    skills: [
      { group: 'Back end', items: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'Fastify'] },
      { group: 'Tooling and testing', items: ['Docker Compose', 'Linux', 'pytest'] },
      { group: 'Front end', items: ['React'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.',
      'Review pull requests for the billing team and paired with two interns through their first month.',
      'Moved four services from a hand-built VPS setup to Docker Compose with health checks; wrote the runbook the on-call rotation now uses.',
    ],
    kestrel: [
      'Added unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
      'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).',
    ],
    projects: [
      { name: 'ledger-lite', description: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL) that enforces balanced journal entries with a database constraint.', highlights: ['140 GitHub stars'] },
      { name: 'chai-check', description: 'A browser extension that flags insecure form actions (HTTP, mixed content), built while working through the PortSwigger Web Security Academy.', highlights: [] },
    ],
    emphasis: ['Led with the invoicing service and PostgreSQL performance work', 'Pull-request reviews for the communication must-win', 'ledger-lite shows an API built in Fastify'],
    keywordsUsed: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'Docker', 'pull requests'],
  },
  letters: [
    v('hook', ['vb-failure', 'vb-hard-bug'], hook, 8.7, { specificity: 9, evidence: 8.5, voice: 9, clarity: 8.5, ask: 8, aiTells: 9 }),
    v('proof', ['vb-hard-bug'], proof, 6.5, { specificity: 7, evidence: 8, voice: 5.5, clarity: 7.5, ask: 5, aiTells: 6 }, [
      'Cut "I think that experience would be valuable for keeping your p95 latency under 150 ms"; the reconciliation job is not a latency result.',
      'Cut "I am confident I can learn them quickly" and show it with an example.',
      'Replace "I look forward to hearing from you" with a concrete ask.',
    ]),
    v('story', ['vb-learned-fast'], story, 7.4, { specificity: 7.5, evidence: 7.5, voice: 8.5, clarity: 7.5, ask: 6, aiTells: 7.5 }, [
      'Replace "I\'d love to chat if you think I could be a fit" with a specific ask.',
      'Say something about migrations on large tables; it is the posting\'s main technical ask and the letter skips it.',
    ]),
  ],
  revised: {
    proof: revise('proof', ['vb-hard-bug'], proof, [
      [', and I think that experience would be valuable for keeping your p95 latency under 150 ms.', '.'],
      [', but I am confident I can learn them quickly.', '. When nobody at work knew Docker Compose, I learned it and moved four services.'],
      ['I look forward to hearing from you.', 'Could we have a short call next week?'],
    ], 7.1, { specificity: 6.5, evidence: 8, voice: 6.5, clarity: 7.5, ask: 7.5, aiTells: 7 }),
    story: revise('story', ['vb-learned-fast'], story, [
      ["I'd love to chat if you think I could be a fit.", 'Could we have a short call about the Core API squad?'],
      ['with set-based SQL.', 'with set-based SQL, and I write the rollback before every migration.'],
    ], 7.8, { specificity: 7.5, evidence: 8, voice: 8.5, clarity: 7.5, ask: 7.5, aiTells: 7.5 }),
  },
  subjects: [
    'Backend Engineer (Junior): migrations with the rollback written first',
    'Backend Engineer (Junior) application: Rania Haroon',
    'Core API squad: Node.js and PostgreSQL engineer from Lahore',
    'Backend Engineer (Junior): reconciliation job from 41 minutes to 6',
    'Zero-downtime migrations and a junior who writes rollbacks first',
  ],
  bestSubject: 0,
  outreach:
    "Northwind's post on migrating the bookings table without downtime is how I learned to work: after a failed column rename in my first month at Tessellate Labs, I added expand-then-contract to our migration checklist and now write the rollback first. I maintain a Node.js and TypeScript invoicing service on PostgreSQL. I've applied for the junior backend role; could we have a short call about the Core API squad?",
  followUp: `Hello,

I applied for the Backend Engineer (Junior) role last week. Since then I've read your webhooks v2 docs, and signed payloads with retries is the part I'd most like to learn from, since my own APIs so far are Fastify services without public consumers. If it helps, I'm happy to walk someone through my migration checklist on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Northwind Labs builds an API other developers depend on, and your post on migrating the bookings table without downtime shows the team takes that seriously. I learned the same lesson the hard way: a column rename in my first month at Tessellate Labs blanked an admin screen, and now I write the rollback before every migration.",
    whyRole:
      "The Backend Engineer (Junior) role on the Core API squad is Node.js, TypeScript and PostgreSQL, which is what I work in every day at Tessellate Labs. I maintain the invoicing service there and cut our nightly reconciliation job from 41 minutes to 6 with set-based SQL. I haven't used NestJS, but I've built APIs in Fastify and expect the move to be quick.",
    project:
      "The reconciliation job at Tessellate took 41 minutes and nobody touched it because it worked, until it started overlapping with the morning invoice run and customers got duplicate reminders. I spent a day reading EXPLAIN output and found the boring cause: rows updated one at a time inside a loop. I rewrote it as two set-based UPDATE statements with a partial index on unpaid invoices, and it now takes 6 minutes.",
  },  formAnswers: [
    {
      // Lever's "Additional information" box ("Add a cover letter or anything else you want to share").
      question: 'additional information',
      answer:
        "One thing worth saying plainly: I write Node.js APIs in Fastify, not NestJS, so the framework would be new to me. ledger-lite, my small bookkeeping API on GitHub, shows how I'd approach the Core API work. It pushes the rule that debits and credits must balance down into PostgreSQL with a deferred constraint, so a careless script can't skip it. I'm in Lahore, inside the time-zone window the posting gives.",
    },
  ],

};
