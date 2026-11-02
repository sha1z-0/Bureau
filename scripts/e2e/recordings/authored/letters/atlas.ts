import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Atlas Mutual team,

I read that Atlas Mutual launched online claim tracking for members this year, which is an impressive achievement for an insurer of your size. I would be honoured to contribute to the next step of your digital transformation.

I am a junior software engineer at Tessellate Labs with two years of experience in TypeScript, Node.js and PostgreSQL. I built the React admin screens for refunds and credit notes and maintain the invoicing service.

I believe my experience and my commitment to quality make me an ideal candidate for the Associate Software Engineer role.

Thank you for considering my application.

Best regards,
Rania Haroon`;

const proof = `Dear Atlas Mutual team,

Atlas Mutual opened a remote engineering hub for engineers in Pakistan this year, and the work you describe, TypeScript and Node.js services on PostgreSQL, is what I've done for two years at Tessellate Labs in Lahore. I built and maintain the invoicing service there, about 9,000 invoices a month, and the React admin screens for refunds and credit notes, with role-based access checks on the API side. I review pull requests for the billing team, and I've paired with two interns through their first month.

Online claim tracking looks simple to a member, and it isn't simple underneath. The closest thing I've fixed was our nightly reconciliation job. It took 41 minutes and started overlapping with the morning invoice run, so customers got duplicate reminders. I spent a day reading EXPLAIN output I only half understood, then rewrote it as set-based SQL with two partial indexes. Six minutes.

I also like writing things down. The billing team keeps a shared Google Doc called 'things that scared us this week', and on Fridays we go through it together. Half the items are nothing. The other half turn into tickets before they turn into incidents, and I try to be the person who writes it down first.

Could we set up a short call about the role?

Best regards,
Rania Haroon`;

const story = `Dear Atlas Mutual team,

In my first month at Tessellate I shipped a migration that renamed a column without a fallback, and the admin screen went blank. My lead didn't shout. She asked me to write up what happened and to add the expand-then-contract step to our migration checklist.

A member checking a claim online deserves the same care, which is why the Claims work at Atlas Mutual appeals to me. I have two years of TypeScript, Node.js and PostgreSQL behind me.

I'd welcome a conversation at your convenience.

Best regards,
Rania Haroon`;

export const atlas: Application = {
  company: 'Atlas Mutual',
  evidence: {
    priorities: [
      'TypeScript and Node.js services on PostgreSQL for member-facing platforms',
      'SQL migrations and small features shipped end to end',
      'A reliable engineer for the new remote hub in Pakistan',
    ],
    mustWins: ['TypeScript or Python in production', 'Comfort with SQL', 'Steady, careful delivery'],
    tone: 'Short posting from a large, established insurer',
    seniority: 'Junior (associate)',
    hooks: [
      { text: 'Opened a remote engineering hub for engineers based in Pakistan (2026-06).', sourceUrl: 'https://atlasmutual.example.com/careers/digital-engineering' },
      { text: 'Online claim tracking so members can see each step of a claim without calling (2026-07).', sourceUrl: 'https://atlasmutual.example.com/newsroom/claims-tracking' },
    ],
    items: [
      { requirement: '1+ years with TypeScript or Python', importance: 'critical', factIds: ['f-exp-tessellate', 'f-skill-ts'], evidence: 'Two years of TypeScript at Tessellate Labs', framing: 'direct', phrasing: 'two years of production TypeScript' },
      { requirement: 'Comfort with SQL', importance: 'critical', factIds: ['f-tess-recon'], evidence: 'Reconciliation job from 41 to 6 minutes with set-based SQL', framing: 'direct', phrasing: 'set-based SQL on a live database' },
      { requirement: 'TypeScript and Node.js services backed by PostgreSQL', importance: 'important', factIds: ['f-tess-invoicing'], evidence: 'Invoicing service, about 9,000 invoices a month', framing: 'direct', phrasing: 'Node.js and TypeScript on PostgreSQL in production' },
      { requirement: 'Write SQL migrations', importance: 'important', factIds: ['f-tess-invoicing'], evidence: 'Maintains the invoicing schema; expand-then-contract checklist (voice bank)', framing: 'transferable', phrasing: 'schema changes with the rollback written first' },
      { requirement: 'Ship small features end to end', importance: 'important', factIds: ['f-tess-react'], evidence: 'Refund and credit-note screens plus API checks', framing: 'direct', phrasing: 'features from React screen to API' },
      { requirement: 'Docker', importance: 'nice', factIds: ['f-tess-docker'], evidence: 'Moved four services to Docker Compose', framing: 'direct', phrasing: 'moved four services to Docker Compose' },
      { requirement: 'AWS', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'React', importance: 'nice', factIds: ['f-tess-react'], evidence: 'React admin screens', framing: 'direct', phrasing: 'React admin screens' },
    ],
    biggestGap: null,
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Associate Software Engineer: TypeScript, Node.js, PostgreSQL',
    summary:
      'Junior software engineer in Lahore with two years of production TypeScript, Node.js and PostgreSQL. Built the invoicing service and React refund tools at Tessellate Labs, and cut a nightly reconciliation job from 41 minutes to 6.',
    skills: [
      { group: 'Back end', items: ['TypeScript', 'Node.js', 'PostgreSQL', 'SQL', 'Fastify'] },
      { group: 'Front end', items: ['React'] },
      { group: 'Tooling', items: ['Docker Compose', 'Linux', 'pytest', 'Python'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Built the React (TypeScript) admin screens for refunds and credit notes, including role-based access checks on the API side.',
      'Cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.',
      'Review pull requests for the billing team and paired with two interns through their first month.',
    ],
    kestrel: [
      'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).',
      'Added unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
    ],
    projects: [
      { name: 'ledger-lite', description: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL) that enforces balanced journal entries with a database constraint.', highlights: ['140 GitHub stars'] },
      { name: 'Bus Tracker Lahore', description: 'A React + Leaflet map of Metro Bus stops with estimated arrival gaps from public timetables.', highlights: ['About 300 monthly users'] },
    ],
    emphasis: ['Led with the invoicing service and React refund screens', 'Reconciliation speed-up for the SQL must-win', 'Lahore location kept visible for the Pakistan hub'],
    keywordsUsed: ['TypeScript', 'Node.js', 'PostgreSQL', 'SQL', 'React', 'Docker'],
  },
  letters: [
    v('hook', [], hook, 4.4, { specificity: 5.5, evidence: 6, voice: 3.5, clarity: 7, ask: 4, aiTells: 3 }, [
      'Cut "which is an impressive achievement for an insurer of your size" and "I would be honoured"; it is flattery.',
      'Cut "my commitment to quality make me an ideal candidate"; it is a stock line.',
      'Replace "Thank you for considering my application" with a concrete ask.',
    ]),
    v('proof', ['vb-hard-bug', 'vb-team-loved'], proof, 8.5, { specificity: 8.5, evidence: 9, voice: 8.5, clarity: 8.5, ask: 8, aiTells: 8.5 }),
    v('story', ['vb-failure'], story, 6.6, { specificity: 6.5, evidence: 5.5, voice: 8.5, clarity: 7.5, ask: 4.5, aiTells: 7 }, [
      'Add a concrete result from your Node.js or PostgreSQL work.',
      'Replace "I\'d welcome a conversation at your convenience" with a concrete ask.',
    ]),
  ],
  revised: {
    hook: revise('hook', [], hook, [
      [', which is an impressive achievement for an insurer of your size. I would be honoured to contribute to the next step of your digital transformation.', '. Claims that members can follow online are the kind of feature I would like to work on.'],
      ['I believe my experience and my commitment to quality make me an ideal candidate for the Associate Software Engineer role.\n\n', ''],
      ['Thank you for considering my application.', 'Could we set up a short call?'],
    ], 6.3, { specificity: 6.5, evidence: 6, voice: 5.5, clarity: 7.5, ask: 7, aiTells: 6.5 }),
    story: revise('story', ['vb-failure'], story, [
      ['I have two years of TypeScript, Node.js and PostgreSQL behind me.', 'I have two years of TypeScript, Node.js and PostgreSQL behind me, and I cut our nightly reconciliation job from 41 minutes to 6.'],
      ["I'd welcome a conversation at your convenience.", 'Could we set up a short call?'],
    ], 7.3, { specificity: 6.5, evidence: 7, voice: 8.5, clarity: 7.5, ask: 7, aiTells: 7.5 }),
  },
  subjects: [
    'Associate Software Engineer: TypeScript and PostgreSQL, based in Lahore',
    'Associate Software Engineer application: Rania Haroon',
    'Remote hub in Pakistan: Associate Software Engineer from Lahore',
    'Associate Software Engineer: billing services and React tools',
    'Application for the Associate Software Engineer role from Lahore',
  ],
  bestSubject: 2,
  outreach:
    "Atlas Mutual's new remote engineering hub for engineers in Pakistan caught my eye, since I'm in Lahore and already work in the stack you hire for: TypeScript and Node.js on PostgreSQL at Tessellate Labs, where I built the invoicing service and React refund screens. I also cut a nightly reconciliation job from 41 minutes to 6 with set-based SQL. I've applied for the Associate Software Engineer role. Could we have a short call about the hub?",
  followUp: `Hello,

I applied for the Associate Software Engineer role last week. One detail I left out: I review pull requests for the billing team at Tessellate Labs and paired with two interns through their first month, which is useful in a new hub where people are still learning each other's code. If it helps, I'm happy to talk on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Atlas Mutual is owned by its members, and features like online claim tracking show the effort goes into the people who pay for the policies. Your new remote engineering hub for Pakistan means I can do that work from Lahore. I'd like to build software where getting the details right matters to someone on the other end.",
    whyRole:
      "The Associate Software Engineer role is TypeScript and Node.js on PostgreSQL, which I've used every day for two years at Tessellate Labs. I built the React admin screens for refunds and credit notes and maintain the invoicing service, and I cut our nightly reconciliation job from 41 minutes to 6 with set-based SQL.",
    project:
      "At Tessellate Labs I built the React admin screens for refunds and credit notes, with role-based access checks on the API side. The checks were the important part: a refund button the wrong person can press is worse than no button at all.",
  },
};
