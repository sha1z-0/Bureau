import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Lumen Ledger team,

Lumen Ledger's new matching rules, which learn from the matches accountants make by hand, caught my attention because reconciliation is the work I know best. I am applying for the Junior Backend Engineer role.

At Tessellate Labs I built and maintain the invoicing service in Node.js, TypeScript and PostgreSQL, which issues about 9,000 invoices a month. I also cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.

Outside work I built ledger-lite, a double-entry bookkeeping API that enforces balanced journal entries with a database constraint. It has 140 stars on GitHub.

I believe my background in billing systems and my attention to detail make me a strong candidate for your team. I am a fast learner and I am comfortable with Docker.

Thank you for your time, and I hope to hear from you soon.

Best regards,
Rania Haroon`;

const proof = `Dear Lumen Ledger team,

I cut a nightly reconciliation job at Tessellate Labs from 41 minutes to 6, and that's why I'm applying for the Junior Backend Engineer role on Lumen Ledger's matching engine. The job had started overlapping with the morning invoice run, and customers got duplicate reminders. I spent a day reading EXPLAIN output I only half understood. The real problem was boring: we updated rows one at a time inside a loop. I rewrote it as set-based SQL and added two partial indexes. Six minutes.

That's the work I do every day at Tessellate Labs, where I built and maintain the invoicing service in Node.js, TypeScript and PostgreSQL. It issues about 9,000 invoices a month. I also write the rollback before every migration, even for a two-line change.

It goes back further than work. My father kept his shop's accounts in a green register, and every Ramzan it stopped balancing and he'd sit up past sehri hunting for forty rupees. I still like that part best. Not the clever part. The part where someone stops staying up late.

Your engineering post about moving candidate matching into PostgreSQL describes the part of the job I'd most like to work on.

Could I walk someone on the team through the reconciliation fix on a short call?

Best regards,
Rania Haroon`;

const story = `Dear Lumen Ledger team,

My father ran a small hardware shop in Ichhra and kept his accounts in a green register with a rubber band around it, so Lumen Ledger's customers feel familiar to me. Every Ramzan the register stopped balancing and he'd sit up past sehri hunting for forty rupees. I wrote him a little spreadsheet when I was fifteen. It didn't fix the forty rupees, but it showed him which day they went missing.

I still like that feeling best. Not the clever part. The part where someone stops staying up late.

That's the work I do now at Tessellate Labs, where I built and maintain the invoicing service in Node.js, TypeScript and PostgreSQL. It issues about 9,000 invoices a month. Our reconciliation job took 41 minutes until I spent a day reading EXPLAIN output I only half understood. The real problem was boring: we updated rows one at a time inside a loop. I rewrote it as set-based SQL and added two partial indexes. Six minutes.

Your engineering post about moving candidate matching into PostgreSQL describes the part of the job I'd most like to work on. I also write the rollback before every migration, even for a two-line change.

Could we set up a short call next week?

Best regards,
Rania Haroon`;

export const lumenLedger: Application = {
  company: 'Lumen Ledger',
  evidence: {
    priorities: [
      'Node.js and TypeScript services that import bank feeds and match transactions',
      'PostgreSQL migrations and query tuning behind the matching engine',
      'Small, well-tested changes shipped often',
      'Care with financial data',
    ],
    mustWins: ['Backend TypeScript and Node.js in production', 'Comfort with SQL and PostgreSQL', 'Evidence of shipping small changes safely'],
    tone: 'Friendly and practical; a small product team',
    seniority: 'Junior (1+ years)',
    hooks: [
      { text: 'Engineering post on moving candidate matching out of application code and into PostgreSQL queries.', sourceUrl: 'https://lumenledger.example.com/engineering/matching-in-postgres' },
      { text: 'Matching rules that learn from the manual matches accountants make (2026-09).', sourceUrl: 'https://lumenledger.example.com/blog/matching-rules-that-learn' },
    ],
    items: [
      { requirement: '1+ years with TypeScript or Python', importance: 'critical', factIds: ['f-exp-tessellate', 'f-skill-ts', 'f-skill-python'], evidence: 'Two years of TypeScript at Tessellate Labs; Python scripts at Kestrel Analytics', framing: 'direct', phrasing: 'two years of production TypeScript' },
      { requirement: 'Comfort with SQL', importance: 'critical', factIds: ['f-tess-recon'], evidence: 'Cut the nightly reconciliation job from 41 minutes to 6 with set-based SQL and two partial indexes', framing: 'direct', phrasing: 'set-based SQL and partial indexes on a reconciliation job' },
      { requirement: 'TypeScript and Node.js services backed by PostgreSQL', importance: 'important', factIds: ['f-tess-invoicing'], evidence: 'Invoicing service in Node.js, TypeScript and PostgreSQL, about 9,000 invoices a month', framing: 'direct', phrasing: 'builds and maintains a Node.js and TypeScript service on PostgreSQL' },
      { requirement: 'Write SQL migrations', importance: 'important', factIds: ['f-tess-invoicing', 'f-proj-ledger'], evidence: 'Maintains the invoicing schema; ledger-lite enforces balance with a database constraint', framing: 'transferable', phrasing: 'schema work on a live billing database' },
      { requirement: 'Ship small features end to end', importance: 'important', factIds: ['f-tess-react'], evidence: 'React admin screens for refunds and credit notes plus their API checks', framing: 'direct', phrasing: 'shipped refund and credit-note features from React screen to API' },
      { requirement: 'Docker', importance: 'nice', factIds: ['f-tess-docker'], evidence: 'Moved four services to Docker Compose with health checks', framing: 'direct', phrasing: 'moved four services to Docker Compose' },
      { requirement: 'React', importance: 'nice', factIds: ['f-tess-react'], evidence: 'React admin screens', framing: 'direct', phrasing: 'React admin screens' },
      { requirement: 'AWS', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'Remote within UTC+0 to UTC+6', importance: 'critical', factIds: [], evidence: 'Logistics, not a claim: Lahore is UTC+5', framing: 'omit', phrasing: '' },
    ],
    biggestGap: null,
    fastLearning: 'vb-hard-bug',
  },
  cv: {
    headline: 'Junior Backend Engineer: Node.js, TypeScript and PostgreSQL',
    summary:
      'Junior software engineer with two years of production Node.js and TypeScript on PostgreSQL, most of it on billing and reconciliation. Cut a nightly reconciliation job from 41 minutes to 6 with set-based SQL, and builds double-entry bookkeeping in her own time.',
    skills: [
      { group: 'Back end', items: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'Fastify'] },
      { group: 'Tooling', items: ['Docker Compose', 'Linux', 'pytest'] },
      { group: 'Front end', items: ['React'] },
      { group: 'Other languages', items: ['Python'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.',
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Moved four services from a hand-built VPS setup to Docker Compose with health checks; wrote the runbook the on-call rotation now uses.',
      'Built the React (TypeScript) admin screens for refunds and credit notes, including role-based access checks on the API side.',
    ],
    kestrel: [
      'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).',
      'Added unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
    ],
    projects: [
      { name: 'ledger-lite', description: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL) that enforces balanced journal entries with a database constraint.', highlights: ['140 GitHub stars'] },
      { name: 'Bus Tracker Lahore', description: 'A React + Leaflet map of Metro Bus stops with estimated arrival gaps from public timetables.', highlights: ['About 300 monthly users'] },
    ],
    emphasis: ['Led with the reconciliation speed-up: the same problem Lumen Ledger solves', 'Invoicing service second as Node.js and PostgreSQL proof', 'ledger-lite for double-entry correctness'],
    keywordsUsed: ['TypeScript', 'Node.js', 'PostgreSQL', 'SQL', 'Docker', 'React'],
  },
  letters: [
    v('hook', ['vb-hard-bug'], hook, 6.2, { specificity: 7, evidence: 8, voice: 5, clarity: 7.5, ask: 5, aiTells: 5 }, [
      'Cut "I believe my background in billing systems and my attention to detail make me a strong candidate"; it is a stock line.',
      'Cut "I am a fast learner and I am comfortable with Docker"; show it with the Docker Compose move instead.',
      'Replace "Thank you for your time, and I hope to hear from you soon" with a concrete ask.',
    ]),
    v('proof', ['vb-hard-bug', 'vb-why-build', 'vb-failure'], proof, 8.4, { specificity: 8.5, evidence: 9, voice: 8.5, clarity: 8, ask: 8, aiTells: 8.5 }),
    v('story', ['vb-why-build', 'vb-hard-bug', 'vb-failure'], story, 8.8, { specificity: 9, evidence: 8.5, voice: 9.5, clarity: 8.5, ask: 8, aiTells: 9 }),
  ],
  revised: {
    hook: revise('hook', ['vb-hard-bug'], hook, [
      ['I believe my background in billing systems and my attention to detail make me a strong candidate for your team. I am a fast learner and I am comfortable with Docker.', 'When our VPS provider gave us two weeks to move, I moved four services to Docker Compose.'],
      ['Thank you for your time, and I hope to hear from you soon.', 'Could we talk next week?'],
    ], 7.3, { specificity: 7, evidence: 8, voice: 6.5, clarity: 7.5, ask: 7, aiTells: 7 }),
  },
  subjects: [
    'Junior Backend Engineer: reconciliation job from 41 minutes to 6',
    'Junior Backend Engineer application: Rania Haroon',
    'Matching in Postgres: Junior Backend Engineer application',
    'Junior Backend Engineer: billing engineer who balances ledgers',
    'Application for Junior Backend Engineer (Node.js, PostgreSQL)',
  ],
  bestSubject: 0,
  outreach:
    "Lumen Ledger's post on moving candidate matching into PostgreSQL is close to the work I'm proudest of: I cut a nightly reconciliation job at Tessellate Labs from 41 minutes to 6 with set-based SQL and two partial indexes. I build the Node.js and TypeScript invoicing service there, and in my own time ledger-lite, which enforces balanced journal entries with a database constraint. I've applied for the Junior Backend Engineer role; could we have a short call about the matching engine?",
  followUp: `Hello,

I applied for the Junior Backend Engineer role last week. Since then I've been reading your engineering post on matching in PostgreSQL, and it reminded me of my own ledger-lite project, which enforces balanced journal entries with a database constraint. If it's useful, I'd be glad to talk through how I'd approach a slow matching query.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Lumen Ledger builds the tool I wish my father had: he kept his shop's accounts in a green register and lost nights to forty rupees that wouldn't balance. Matching bank lines to invoices is that problem at company scale. I've spent two years on billing at Tessellate Labs, and reconciliation is where I do my best work.",
    whyRole:
      "The Junior Backend Engineer role is Node.js and TypeScript on PostgreSQL, which is exactly what I build at Tessellate Labs. I maintain our invoicing service and cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL. Tuning the queries behind your matching engine is the work I'd most like to do next.",
    project:
      "ledger-lite started because I didn't trust my own code. The only thing stopping an unbalanced journal entry at work was a check in the service layer, so at home I rebuilt the idea and pushed the rule down into Postgres with a deferred constraint trigger. It took three weekends, and a stranger on GitHub later said it caught a bug in their importer on day one.",
  },
};
