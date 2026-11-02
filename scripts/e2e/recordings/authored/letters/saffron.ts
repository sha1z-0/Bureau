import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Saffron Studio team,

Saffron Studio's kitchen display that keeps taking orders when the restaurant's internet drops is a problem I've thought about before, on a much smaller scale. My final-year project was an offline-first attendance app for rural schools, so I've had to decide what an app should do when the connection disappears and what it owes the server when it comes back. If a page renders a bit wrong, someone squints. If an order goes missing during service, a kitchen stops.

Since then I've spent two years at Tessellate Labs building on the stack you describe. I built the React (TypeScript) admin screens for refunds and credit notes, with role-based access checks on the API side, and I maintain the Node.js invoicing service on PostgreSQL. Orders and loyalty points would feel familiar after credit notes and invoices.

I haven't used Next.js or Prisma. When our VPS provider announced a migration with two weeks' notice, nobody at work had written a Dockerfile, so I volunteered. I read the Compose docs on the bus and broke my laptop's networking twice. We moved four services. I'd learn your framework the same way.

Real client work from week one, with a buddy, is how I'd want to start.

Could we have a short call about the role?

Best regards,
Rania Haroon`;

const proof = `Dear Saffron Studio team,

I have two years of professional experience with TypeScript, React and Node.js, which matches your must-haves for the Full-Stack Developer, Early Career role. At Tessellate Labs I built the React admin screens for refunds and credit notes and maintain the invoicing service, which issues about 9,000 invoices a month.

I am very comfortable with SQL. I cut our nightly reconciliation job from 41 minutes to 6 with set-based SQL and two partial indexes.

I am eager to learn Next.js and Prisma, and I am sure I would pick them up quickly.

I would be a great addition to your team. I look forward to hearing from you.

Best regards,
Rania Haroon`;

const story = `Dear Saffron Studio team,

The billing team at Tessellate is four people and a shared Google Doc called 'things that scared us this week'. Anyone can add to it, and on Fridays we go through it together. Half the items are nothing. The other half turn into tickets before they turn into incidents.

A 25-person studio that ships everything in-house probably works the same way, and that is the kind of place I'd like to grow in.

I build React screens and Node.js services on PostgreSQL at Tessellate Labs, and I haven't used Next.js yet.

Let me know if you'd like to talk.

Best regards,
Rania Haroon`;

export const saffron: Application = {
  company: 'Saffron Studio',
  evidence: {
    priorities: [
      'Features across React / Next.js front ends and Node.js (TypeScript) APIs',
      'Modelling menus, orders and loyalty points in PostgreSQL',
      'Tests, code review and client demos from week one',
    ],
    mustWins: ['Professional JavaScript or TypeScript with React', 'REST APIs in Node.js', 'Basic SQL'],
    tone: 'Friendly studio voice; growth plan and buddy for early-career developers',
    seniority: 'Early career (up to 2 years)',
    hooks: [
      { text: "Case study: a kitchen-display system that keeps taking orders when the restaurant's internet drops and syncs when it returns.", sourceUrl: 'https://saffronstudio.example.com/work/offline-kitchen-display' },
      { text: 'Early-career developers work on real client projects from week one, with a buddy and a growth plan.', sourceUrl: 'https://saffronstudio.example.com/careers' },
    ],
    items: [
      { requirement: 'Up to 2 years of professional experience with JavaScript or TypeScript', importance: 'critical', factIds: ['f-exp-tessellate', 'f-skill-ts'], evidence: 'Two years of TypeScript at Tessellate Labs', framing: 'direct', phrasing: 'two years of production TypeScript' },
      { requirement: 'Experience with React', importance: 'critical', factIds: ['f-tess-react', 'f-skill-react'], evidence: 'React (TypeScript) admin screens for refunds and credit notes', framing: 'direct', phrasing: 'React screens in production' },
      { requirement: 'Building REST APIs in Node.js', importance: 'critical', factIds: ['f-tess-invoicing', 'f-proj-ledger'], evidence: 'Node.js invoicing service; ledger-lite API on Fastify', framing: 'direct', phrasing: 'Node.js APIs in production' },
      { requirement: 'Basic SQL', importance: 'critical', factIds: ['f-tess-recon'], evidence: 'Reconciliation job from 41 to 6 minutes with set-based SQL', framing: 'direct', phrasing: 'SQL well beyond the basics' },
      { requirement: 'Model menus, orders and loyalty points in PostgreSQL', importance: 'important', factIds: ['f-tess-invoicing', 'f-skill-pg'], evidence: 'Invoices and credit notes modelled in PostgreSQL', framing: 'transferable', phrasing: 'billing data in PostgreSQL' },
      { requirement: 'Next.js', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'Prisma or Stripe integrations', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'Experience with mobile (React Native)', importance: 'nice', factIds: ['f-edu-bs'], evidence: 'Final-year project: offline-first attendance app (education record)', framing: 'transferable', phrasing: 'an offline-first app as a final-year project' },
    ],
    biggestGap: 'No Next.js or Prisma',
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Full-Stack Developer: React, TypeScript, Node.js and PostgreSQL',
    summary:
      'Early-career full-stack engineer with two years of production React and TypeScript and the Node.js APIs and PostgreSQL behind them. Builds admin tools and the APIs behind them, and writes down what broke.',
    skills: [
      { group: 'Front end', items: ['React', 'TypeScript', 'Leaflet'] },
      { group: 'Back end', items: ['Node.js', 'Fastify', 'PostgreSQL', 'SQL'] },
      { group: 'Tooling', items: ['Docker Compose', 'Linux', 'pytest'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Built the React (TypeScript) admin screens for refunds and credit notes, including role-based access checks on the API side.',
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.',
      'Moved four services from a hand-built VPS setup to Docker Compose with health checks; wrote the runbook the on-call rotation now uses.',
    ],
    kestrel: [
      'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).',
      'Added unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
    ],
    projects: [
      { name: 'Bus Tracker Lahore', description: 'A React + Leaflet map of Metro Bus stops with estimated arrival gaps from public timetables.', highlights: ['About 300 monthly users'] },
      { name: 'ledger-lite', description: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL) that enforces balanced journal entries with a database constraint.', highlights: ['140 GitHub stars'] },
    ],
    emphasis: ['Led with React admin screens and the Node.js API behind them', 'Offline-first final-year project kept in Education for the kitchen-display angle', 'No Next.js or Prisma listed'],
    keywordsUsed: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'SQL'],
  },
  letters: [
    v('hook', ['vb-learned-fast', 'vb-why-field'], hook, 8.4, { specificity: 9, evidence: 8, voice: 8.5, clarity: 8.5, ask: 7.5, aiTells: 8.5 }),
    v('proof', [], proof, 5.2, { specificity: 5.5, evidence: 7.5, voice: 4, clarity: 7.5, ask: 4, aiTells: 4.5 }, [
      'Cut "which matches your must-haves"; let the evidence show it.',
      'Cut "I am sure I would pick them up quickly" and give an example instead.',
      'Cut "I would be a great addition to your team" and "I look forward to hearing from you"; end with a concrete ask.',
    ]),
    v('story', ['vb-team-loved'], story, 6.8, { specificity: 7, evidence: 6, voice: 9, clarity: 7.5, ask: 5, aiTells: 7.5 }, [
      'The story takes most of the letter and the evidence is one sentence; add the admin screens or the reconciliation fix.',
      'Replace "Let me know if you\'d like to talk" with a concrete ask.',
    ]),
  ],
  revised: {
    proof: revise('proof', [], proof, [
      [', which matches your must-haves for the Full-Stack Developer, Early Career role', ''],
      ['I am eager to learn Next.js and Prisma, and I am sure I would pick them up quickly.', 'I have not used Next.js or Prisma; when nobody at work knew Docker Compose, I learned it in time for a two-week migration.'],
      ['I would be a great addition to your team. I look forward to hearing from you.', 'Could we have a short call?'],
    ], 6.5, { specificity: 6, evidence: 7.5, voice: 5.5, clarity: 7.5, ask: 7, aiTells: 6.5 }),
    story: revise('story', ['vb-team-loved'], story, [
      ['and I haven\'t used Next.js yet.', 'and I cut our reconciliation job from 41 minutes to 6 with set-based SQL. I haven\'t used Next.js yet.'],
      ["Let me know if you'd like to talk.", 'Could we have a short call about the role?'],
    ], 7.4, { specificity: 7, evidence: 7, voice: 9, clarity: 7.5, ask: 7, aiTells: 7.5 }),
  },
  subjects: [
    'Full-Stack Developer, Early Career: React and Node.js, offline-first',
    'Full-Stack Developer, Early Career application: Rania Haroon',
    'Kitchen displays that work offline, and an offline-first school app',
    'Early-career full-stack application: React, Node.js, PostgreSQL',
    'Full-Stack Developer application from Lahore',
  ],
  bestSubject: 0,
  outreach:
    "Saffron Studio's kitchen display that keeps taking orders when the internet drops caught my eye: my final-year project was an offline-first attendance app for rural schools. Today I build React admin screens and a Node.js service on PostgreSQL at Tessellate Labs, and I cut our nightly reconciliation job from 41 minutes to 6 with set-based SQL. I've applied for the Full-Stack Developer, Early Career role. Would you be open to a short call?",
  followUp: `Hello,

I applied for the Full-Stack Developer, Early Career role last week. One detail I left out: before Tessellate Labs, I built an offline-first attendance app for rural schools as my final-year project, which is why your offline kitchen display stuck with me. If it helps, I'm happy to walk someone through my React admin screens on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Saffron Studio builds the apps a restaurant runs on during service, and your kitchen display that keeps working when the internet drops shows you design for the bad day. I care about that problem: my final-year project was an offline-first attendance app for rural schools. Working on real client projects from week one, with a buddy, is how I'd want to grow.",
    whyRole:
      "The Full-Stack Developer, Early Career role is React and Node.js with PostgreSQL, the stack I've used for two years at Tessellate Labs. I built the React admin screens for refunds and credit notes and maintain the Node.js invoicing service. I haven't used Next.js, and that is where I'd start learning.",
    project:
      "At Tessellate Labs I built the React admin screens for refunds and credit notes, including the role-based access checks on the API side. The checks mattered more than the screens: a refund button that the wrong person can press is worse than no button.",
  },
};
