import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Kranich team,

Kranich Software's post on partitioning the stock-movements table by month is the kind of problem I'd like to grow into, because the slowest job I've fixed was a much smaller version of it. Our nightly reconciliation job at Tessellate Labs took 41 minutes and nobody touched it because it worked. Then it started overlapping with the morning invoice run, and customers got duplicate reminders. I spent a day reading EXPLAIN output I only half understood. The real problem was boring: we updated rows one at a time inside a loop. I rewrote it as set-based SQL and added two partial indexes. Six minutes.

I build Node.js and TypeScript services on PostgreSQL every day. I maintain the invoicing service that issues about 9,000 invoices a month for our logistics clients. When our VPS provider announced a migration with two weeks' notice and nobody at work had written a Dockerfile, I volunteered, and we moved four services.

I haven't built SAP or DATEV integrations, and my tables are far smaller than yours. English is my working language too, and your fortnightly architecture round sounds like the part of the week I'd enjoy most.

Could we arrange a short call with someone from the engineering team?

Best regards,
Rania Haroon`;

const proof = `Dear Kranich team,

I am applying for the Junior Backend Developer position. I have two years of professional experience with Node.js and TypeScript at Tessellate Labs, where I maintain the invoicing service for our logistics clients, which issues about 9,000 invoices a month.

My SQL skills are solid. I cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes. I also moved four services to Docker Compose.

My English is fluent, and I work well in remote teams.

I have no experience with SAP, DATEV or RabbitMQ, but I am a fast learner.

I would be glad to discuss how I can contribute to Kranich.

Best regards,
Rania Haroon`;

const story = `Dear Kranich team,

The billing team at Tessellate is four people and a shared Google Doc called 'things that scared us this week'. Anyone can add to it, and on Fridays we go through it together. Half the items are nothing. The other half turn into tickets before they turn into incidents. A team that already holds an architecture round every fortnight probably knows the feeling.

I build Node.js and TypeScript services on PostgreSQL. I maintain an invoicing service for logistics clients, about 9,000 invoices a month, and I cut our reconciliation job from 41 minutes to 6 with set-based SQL and two partial indexes.

I haven't worked with tables as big as yours yet.

I hope we can talk soon.

Best regards,
Rania Haroon`;

export const kranich: Application = {
  company: 'Kranich Software GmbH',
  evidence: {
    priorities: [
      'Node.js and TypeScript services for stock movements, picking and shipping',
      'PostgreSQL schemas and queries on very large tables',
      'ERP and accounting integrations over REST and SFTP',
      'Tests, code review and an architecture habit',
    ],
    mustWins: ['1-2 years of Node.js and TypeScript', 'Solid SQL, ideally PostgreSQL', 'Working English'],
    tone: 'Plain and well organised; a profitable, remote-first German company',
    seniority: 'Junior (1-2 years)',
    hooks: [
      { text: 'Engineering blog post on partitioning the stock-movements table in PostgreSQL by month (2026-09).', sourceUrl: 'https://kranich.example.com/en/blog/partitioning-stock-movements' },
      { text: 'DATEV export so stock valuations flow straight into accounting (2026-06).', sourceUrl: 'https://kranich.example.com/en/news/datev-export' },
    ],
    items: [
      { requirement: '1-2 years of professional experience with Node.js and TypeScript', importance: 'critical', factIds: ['f-exp-tessellate', 'f-tess-invoicing'], evidence: 'Two years at Tessellate Labs on the Node.js/TypeScript invoicing service', framing: 'direct', phrasing: 'two years of Node.js and TypeScript in production' },
      { requirement: 'Solid SQL, ideally PostgreSQL', importance: 'critical', factIds: ['f-tess-recon', 'f-skill-pg'], evidence: 'Reconciliation job from 41 to 6 minutes with set-based SQL and two partial indexes', framing: 'direct', phrasing: 'set-based SQL and partial indexes in PostgreSQL' },
      { requirement: 'English at B2 level or better', importance: 'critical', factIds: [], evidence: 'English is fluent (profile languages; not a fact id)', framing: 'omit', phrasing: '' },
      { requirement: 'PostgreSQL schemas for tables with hundreds of millions of rows', importance: 'important', factIds: ['f-tess-recon', 'f-kestrel-etl'], evidence: 'Index and query work on the invoicing database; loaded about 2 million rows a week at Kestrel', framing: 'transferable', phrasing: 'query and index work at a smaller scale' },
      { requirement: 'Integrations with ERP and accounting systems (SAP, DATEV)', importance: 'important', factIds: ['f-tess-invoicing'], evidence: 'Invoicing for logistics clients; no SAP or DATEV', framing: 'transferable', phrasing: 'billing systems that feed accounting' },
      { requirement: 'Automated tests and code reviews', importance: 'important', factIds: ['f-tess-review', 'f-kestrel-tests'], evidence: 'Reviews billing pull requests; loader coverage 0 to 71%', framing: 'direct', phrasing: 'code reviews and automated tests' },
      { requirement: 'Docker', importance: 'nice', factIds: ['f-tess-docker'], evidence: 'Moved four services to Docker Compose', framing: 'direct', phrasing: 'moved four services to Docker Compose' },
      { requirement: 'RabbitMQ', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'Experience with logistics software', importance: 'nice', factIds: ['f-tess-invoicing'], evidence: 'Invoicing service for logistics clients', framing: 'transferable', phrasing: 'billing software for logistics clients' },
    ],
    biggestGap: 'No SAP or DATEV integrations, and no tables at hundreds of millions of rows',
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Junior Backend Developer: Node.js, TypeScript, PostgreSQL',
    summary:
      'Junior software engineer with two years of production Node.js and TypeScript on PostgreSQL, building billing software for logistics clients. Cut a nightly reconciliation job from 41 minutes to 6 with set-based SQL and two partial indexes.',
    skills: [
      { group: 'Back end', items: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'Fastify'] },
      { group: 'Tooling and testing', items: ['Docker Compose', 'Linux', 'pytest', 'Python'] },
      { group: 'Front end', items: ['React'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.',
      'Moved four services from a hand-built VPS setup to Docker Compose with health checks; wrote the runbook the on-call rotation now uses.',
      'Review pull requests for the billing team and paired with two interns through their first month.',
    ],
    kestrel: [
      'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).',
      'Added unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
    ],
    projects: [
      { name: 'ledger-lite', description: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL) that enforces balanced journal entries with a database constraint.', highlights: ['140 GitHub stars'] },
      { name: 'chai-check', description: 'A browser extension that flags insecure form actions (HTTP, mixed content), built while working through the PortSwigger Web Security Academy.', highlights: [] },
    ],
    emphasis: ['Led with the invoicing service for logistics clients', 'Reconciliation speed-up as the SQL must-win', 'Kestrel bulk loading shows larger-volume PostgreSQL work'],
    keywordsUsed: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'Docker', 'code reviews'],
  },
  letters: [
    v('hook', ['vb-hard-bug', 'vb-learned-fast'], hook, 8.5, { specificity: 9, evidence: 8.5, voice: 8.5, clarity: 8.5, ask: 8, aiTells: 8.5 }),
    v('proof', [], proof, 6.0, { specificity: 5.5, evidence: 8, voice: 5, clarity: 7.5, ask: 5, aiTells: 5.5 }, [
      'Replace the opening "I am applying for the Junior Backend Developer position" with something specific to Kranich.',
      'Cut "My SQL skills are solid" and "I work well in remote teams"; the evidence says it already.',
      'Cut "but I am a fast learner"; give an example.',
      'Replace "I would be glad to discuss how I can contribute to Kranich" with a concrete ask.',
    ]),
    v('story', ['vb-team-loved'], story, 7.3, { specificity: 7, evidence: 7.5, voice: 9, clarity: 7.5, ask: 5.5, aiTells: 8 }, [
      'Replace "I hope we can talk soon" with a specific, low-pressure ask.',
      'Say what you would do about the gap in "tables as big as yours".',
    ]),
  ],
  revised: {
    proof: revise('proof', [], proof, [
      ['I am applying for the Junior Backend Developer position. I have', 'Kranich builds the kind of logistics software I already work next to: I have'],
      ['My SQL skills are solid. I cut', 'I cut'],
      ['My English is fluent, and I work well in remote teams.\n\n', ''],
      [', but I am a fast learner.', '. When nobody at work knew Docker Compose, I learned it in time for a two-week migration.'],
      ['I would be glad to discuss how I can contribute to Kranich.', 'Could we arrange a short call?'],
    ], 7.0, { specificity: 7, evidence: 8, voice: 6, clarity: 7.5, ask: 7.5, aiTells: 6.5 }),
    story: revise('story', ['vb-team-loved'], story, [
      ['I hope we can talk soon.', 'Could we arrange a short call?'],
      ["I haven't worked with tables as big as yours yet.", "My tables have been far smaller than yours, and your partitioning post is where I'd start."],
    ], 7.8, { specificity: 7.5, evidence: 7.5, voice: 9, clarity: 7.5, ask: 7.5, aiTells: 8 }),
  },
  subjects: [
    'Junior Backend Developer: Node.js and PostgreSQL for logistics',
    'Junior Backend Developer (m/w/d) application: Rania Haroon',
    'Partitioned stock movements, and a reconciliation job from 41 to 6 min',
    'Junior Backend Developer: billing services for logistics clients',
    'Application from Lahore for the remote backend role',
  ],
  bestSubject: 0,
  outreach:
    "Kranich Software's post on partitioning the stock-movements table by month caught my eye, because the slowest job I've fixed was a smaller version of the same problem: a nightly reconciliation job at Tessellate Labs that went from 41 minutes to 6 with set-based SQL and two partial indexes. I build Node.js and TypeScript services for logistics clients. Could we have a short call about the Junior Backend Developer role?",
  followUp: `Hello,

I applied for the Junior Backend Developer role last week. One detail I left out: at Kestrel Analytics I wrote the Python scripts that loaded about 2 million rows a week into PostgreSQL, which is the closest I've come to your table sizes. If it helps, I'm happy to walk someone through my reconciliation fix on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Kranich Software builds software for warehouses, and I already build billing software for logistics clients at Tessellate Labs, so the domain isn't new to me. Your post on partitioning the stock-movements table is the kind of PostgreSQL problem I want to get better at. The fortnightly architecture round is a habit I'd like to learn from too.",
    whyRole:
      "The Junior Backend Developer role is Node.js, TypeScript and PostgreSQL, which is my daily stack at Tessellate Labs. I maintain the invoicing service there and cut our nightly reconciliation job from 41 minutes to 6 with set-based SQL. I haven't built SAP or DATEV integrations, and that is where I'd expect to learn the most.",
    project:
      "The reconciliation job at Tessellate took 41 minutes and nobody touched it because it worked, until it started overlapping with the morning invoice run. I spent a day reading EXPLAIN output and found that we updated rows one at a time inside a loop. I rewrote it as set-based SQL with two partial indexes, and it now runs in 6 minutes.",
  },
};
