import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Meridian Freight team,

Meridian Freight's instant air-freight quotes from Lahore caught my eye, partly because that's where I live and partly because I already write software for logistics companies. At Tessellate Labs I built and maintain the invoicing service, in Node.js, TypeScript and PostgreSQL, that issues about 9,000 invoices a month for our logistics clients. I also built the React admin screens for refunds and credit notes, with role-based access checks on the API side.

The work I've learned the most from was boring. Our reconciliation job took 41 minutes, and nobody touched it because it worked, until it started overlapping with the morning invoice run and customers got duplicate reminders. I spent a day reading EXPLAIN output I only half understood. The fix was set-based SQL and two partial indexes. Six minutes.

Your graduate engineers ship to production in their first month. That's how my first month went too, including the part where I shipped a migration that renamed a column without a fallback and the admin screen went blank. My lead didn't shout. She asked me to write it up, and I write the rollback before every migration now, even when it feels silly for a two-line change.

Could we set up a short call about the graduate role?

Best regards,
Rania Haroon`;

const proof = `Dear Meridian Freight team,

Please accept my application for the Graduate Software Engineer position. I am a software engineer with two years of experience in TypeScript, Node.js and PostgreSQL, and I believe I would be an excellent fit for your team.

At Tessellate Labs I built the invoicing service for our logistics clients and cut the nightly reconciliation job from 41 minutes to 6. I also built React admin screens and moved four services to Docker Compose.

I am a hard-working and detail-oriented engineer, and I would welcome the opportunity to grow with Meridian Freight.

Thank you for your consideration.

Best regards,
Rania Haroon`;

const story = `Dear Meridian Freight team,

Nobody at work had written a Dockerfile when our VPS provider announced a migration with two weeks' notice. I volunteered, mostly because I didn't want to be the one restoring things by hand at 2am. I read the Compose docs on the bus and broke my laptop's networking twice. We moved four services.

That is how I'd approach a graduate role: say yes to the thing nobody has done yet, then write down how it went.

I've spent two years at Tessellate Labs on billing software for logistics clients, in Node.js, TypeScript and PostgreSQL.

I'd be happy to talk whenever suits you.

Best regards,
Rania Haroon`;

export const meridian: Application = {
  company: 'Meridian Freight',
  evidence: {
    priorities: [
      'TypeScript and Node.js services on PostgreSQL for quoting, booking and tracking freight',
      'SQL migrations and small features shipped end to end',
      'A graduate who ships early with support',
    ],
    mustWins: ['TypeScript or Python in production', 'Comfort with SQL', 'Shipping small features safely'],
    tone: 'Short, friendly posting; a product team in logistics',
    seniority: 'Graduate (the candidate is above it, with two years)',
    hooks: [
      { text: 'Instant air-freight quotes for routes from Karachi, Lahore and Dubai (2026-08).', sourceUrl: 'https://meridianfreight.example.com/news/instant-air-quotes' },
      { text: 'Graduate engineers ship to production in their first month, paired with a senior engineer.', sourceUrl: 'https://meridianfreight.example.com/careers/graduates' },
    ],
    items: [
      { requirement: '1+ years with TypeScript or Python', importance: 'critical', factIds: ['f-exp-tessellate', 'f-skill-ts'], evidence: 'Two years of TypeScript at Tessellate Labs', framing: 'direct', phrasing: 'two years of production TypeScript' },
      { requirement: 'Comfort with SQL', importance: 'critical', factIds: ['f-tess-recon'], evidence: 'Reconciliation job from 41 to 6 minutes with set-based SQL', framing: 'direct', phrasing: 'set-based SQL on a live billing database' },
      { requirement: 'TypeScript and Node.js services backed by PostgreSQL', importance: 'important', factIds: ['f-tess-invoicing'], evidence: 'Invoicing service for logistics clients, about 9,000 invoices a month', framing: 'direct', phrasing: 'Node.js and TypeScript on PostgreSQL for logistics clients' },
      { requirement: 'Write SQL migrations', importance: 'important', factIds: ['f-tess-invoicing'], evidence: 'Maintains the invoicing schema; rollback-first migrations (voice bank)', framing: 'transferable', phrasing: 'migrations with the rollback written first' },
      { requirement: 'Ship small features end to end', importance: 'important', factIds: ['f-tess-react'], evidence: 'Refund and credit-note screens plus their API checks', framing: 'direct', phrasing: 'shipped features from React screen to API' },
      { requirement: 'Docker', importance: 'nice', factIds: ['f-tess-docker'], evidence: 'Moved four services to Docker Compose', framing: 'direct', phrasing: 'moved four services to Docker Compose' },
      { requirement: 'AWS', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'React', importance: 'nice', factIds: ['f-tess-react'], evidence: 'React admin screens', framing: 'direct', phrasing: 'React admin screens' },
    ],
    biggestGap: null,
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Software Engineer: Node.js, TypeScript and PostgreSQL for logistics billing',
    summary:
      'Software engineer with two years of production Node.js and TypeScript on PostgreSQL, building billing software for logistics clients. Cut a nightly reconciliation job from 41 minutes to 6 and writes the rollback before every migration.',
    skills: [
      { group: 'Back end', items: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'Fastify'] },
      { group: 'Front end', items: ['React'] },
      { group: 'Tooling', items: ['Docker Compose', 'Linux', 'pytest', 'Python'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.',
      'Built the React (TypeScript) admin screens for refunds and credit notes, including role-based access checks on the API side.',
      'Moved four services from a hand-built VPS setup to Docker Compose with health checks; wrote the runbook the on-call rotation now uses.',
    ],
    kestrel: [
      'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).',
      'Added unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
    ],
    projects: [
      { name: 'ledger-lite', description: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL) that enforces balanced journal entries with a database constraint.', highlights: ['140 GitHub stars'] },
      { name: 'Bus Tracker Lahore', description: 'A React + Leaflet map of Metro Bus stops with estimated arrival gaps from public timetables.', highlights: ['About 300 monthly users'] },
    ],
    emphasis: ['Led with the invoicing service for logistics clients', 'Reconciliation speed-up for the SQL must-win', 'React screens show end-to-end features'],
    keywordsUsed: ['TypeScript', 'Node.js', 'PostgreSQL', 'SQL', 'Docker', 'React'],
  },
  letters: [
    v('hook', ['vb-hard-bug', 'vb-failure'], hook, 8.5, { specificity: 8.5, evidence: 8.5, voice: 9, clarity: 8.5, ask: 8, aiTells: 8.5 }),
    v('proof', [], proof, 4.6, { specificity: 4, evidence: 7, voice: 3.5, clarity: 7, ask: 4, aiTells: 3 }, [
      'Cut "Please accept my application for the Graduate Software Engineer position"; open with something only Meridian would recognise.',
      'Cut "I believe I would be an excellent fit for your team" and "hard-working and detail-oriented"; they are stock phrases.',
      'Replace "Thank you for your consideration" with a concrete ask.',
    ]),
    v('story', ['vb-learned-fast'], story, 7.1, { specificity: 6.5, evidence: 6.5, voice: 9, clarity: 7.5, ask: 6, aiTells: 7.5 }, [
      'Name something about Meridian; the letter could go to any company.',
      'Replace "I\'d be happy to talk whenever suits you" with a concrete ask.',
    ]),
  ],
  revised: {
    proof: revise('proof', [], proof, [
      ['Please accept my application for the Graduate Software Engineer position. I am a software engineer', "Meridian Freight's platform is the kind of logistics software I already work next to. I am a software engineer"],
      [', and I believe I would be an excellent fit for your team.', '.'],
      ['I am a hard-working and detail-oriented engineer, and I would welcome the opportunity to grow with Meridian Freight.\n\n', ''],
      ['Thank you for your consideration.', 'Could we set up a short call?'],
    ], 6.4, { specificity: 6, evidence: 7, voice: 5.5, clarity: 7.5, ask: 7, aiTells: 6.5 }),
    story: revise('story', ['vb-learned-fast'], story, [
      ['in Node.js, TypeScript and PostgreSQL.', 'in Node.js, TypeScript and PostgreSQL, so freight bookings would not be a strange domain.'],
      ["I'd be happy to talk whenever suits you.", 'Could we set up a short call about the graduate role?'],
    ], 7.5, { specificity: 7, evidence: 6.5, voice: 9, clarity: 7.5, ask: 7.5, aiTells: 7.5 }),
  },
  subjects: [
    'Graduate Software Engineer: billing software for logistics clients',
    'Graduate Software Engineer application: Rania Haroon',
    'Instant air quotes from Lahore, and an engineer who lives there',
    'Graduate Software Engineer: Node.js and PostgreSQL, rollbacks first',
    'Application for the graduate engineering role from Lahore',
  ],
  bestSubject: 0,
  outreach:
    "Meridian Freight's instant air-freight quotes from Lahore caught my eye, since I live there and already build software for logistics clients: the Node.js and TypeScript invoicing service at Tessellate Labs, about 9,000 invoices a month on PostgreSQL. I also cut our nightly reconciliation job from 41 minutes to 6, and I review pull requests for the billing team. I've applied for the Graduate Software Engineer role. Could we have a short call?",
  followUp: `Hello,

I applied for the Graduate Software Engineer role last week. One detail I left out: I moved four services from a hand-built VPS to Docker Compose when our provider gave two weeks' notice, and the runbook I wrote is still what our on-call rotation uses. If it helps, I'm happy to walk someone through it on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Meridian Freight makes freight booking and tracking simple for shippers in South Asia and the Gulf, and I already build billing software for logistics clients at Tessellate Labs. Your instant air-freight quotes from Lahore are a nice coincidence, since I live there. Shipping to production in the first month, with a senior engineer alongside, is how I'd want to start.",
    whyRole:
      "The Graduate Software Engineer role is TypeScript and Node.js on PostgreSQL, the stack I've used for two years at Tessellate Labs. I maintain our invoicing service and cut the nightly reconciliation job from 41 minutes to 6 with set-based SQL. I'd bring that experience while still getting the support a graduate programme gives.",
    project:
      "The reconciliation job at Tessellate took 41 minutes and nobody touched it because it worked, until it started overlapping with the morning invoice run and customers got duplicate reminders. I spent a day reading EXPLAIN output and found we updated rows one at a time inside a loop. Set-based SQL and two partial indexes took it to 6 minutes.",
  },
};
