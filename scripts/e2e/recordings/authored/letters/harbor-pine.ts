import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Harbor & Pine team,

Opening your internal developer portal to every product team is a great step, and I would be excited to contribute to the Platform team that owns it.

I have two years of experience building TypeScript services at Tessellate Labs, including the Node.js invoicing service that issues about 9,000 invoices a month. I also moved four services to Docker Compose and wrote the runbook our on-call rotation uses, so I understand what it means to own reliability.

I am currently learning Go and Kubernetes. I know the posting asks for five years and production Kubernetes, but I am a hard worker and I learn quickly.

I would love the opportunity to discuss how I can help Harbor & Pine.

Best regards,
Rania Haroon`;

const proof = `Dear Harbor & Pine team,

The most relevant thing I've done for a Platform role is small but real: I moved four services from a hand-built VPS setup to Docker Compose with health checks and wrote the runbook our on-call rotation now uses. At Tessellate Labs I also built and maintain a Node.js and TypeScript invoicing service, about 9,000 invoices a month, and cut a nightly reconciliation job from 41 minutes to 6.

I'm learning Go now and working through a Kubernetes course, though only on kind on my laptop.

I don't have five years of experience, Kafka, or experience leading projects across teams. I'd still like to be considered for the entry-level opening.

Thank you for your consideration.

Best regards,
Rania Haroon`;

const story = `Dear Harbor & Pine Platform team,

The Software Engineer I posting asks for things I don't have yet, so I'll start with the closest thing I do have. Nobody at work had written a Dockerfile when our VPS provider announced a migration with two weeks' notice. I volunteered, mostly because I didn't want to be the one restoring things by hand at 2am. I read the Compose docs on the bus and broke my laptop's networking twice. We moved four services. The runbook I wrote is the one our on-call rotation still uses.

Right now I'm learning Go, porting the trial-balance endpoint from my ledger-lite project, and so far the answer is: more typing, fewer surprises. I'm also working through a Kubernetes course in the evenings, though I've only run it on kind on my own laptop. Nothing in production yet. I'd rather say that plainly than pretend otherwise.

What I can offer today is two years of TypeScript services in production at Tessellate Labs, including the Node.js invoicing service behind about 9,000 invoices a month, and the habit of writing down what broke. I also review pull requests for the billing team and paired with two interns through their first month.

Could we have a short call about what the first year on Platform looks like?

Best regards,
Rania Haroon`;

export const harborPine: Application = {
  company: 'Harbor & Pine',
  evidence: {
    priorities: [
      'Go and TypeScript services on Kubernetes that other teams build on',
      'Owning reliability, including on-call',
      'Event streaming on Kafka',
      'Cross-team technical leadership',
    ],
    mustWins: ['Production services in TypeScript (Go a plus)', 'Comfort owning reliability and on-call', 'Container and Kubernetes fundamentals'],
    tone: 'Ambitious and senior-flavoured; the entry-level label does not match the duties',
    seniority: 'Labelled entry level, but the work described is mid to senior platform ownership',
    hooks: [
      { text: 'Opened the internal developer portal to every product team (2026-08).', sourceUrl: 'https://harborpine.example.com/engineering/developer-portal' },
      { text: 'Teams own the reliability of the services they build, including on-call.', sourceUrl: 'https://harborpine.example.com/engineering/platform-team' },
    ],
    items: [
      { requirement: '5+ years of professional software engineering experience', importance: 'important', factIds: [], evidence: 'Two years; not met', framing: 'omit', phrasing: '' },
      { requirement: '3+ years operating Kubernetes in production', importance: 'important', factIds: ['ll-k8s'], evidence: 'Evening course; runs workloads on kind locally only', framing: 'learning', phrasing: 'learning Kubernetes now, on kind on her laptop; nothing in production' },
      { requirement: 'Go and TypeScript services', importance: 'important', factIds: ['f-tess-invoicing', 'f-skill-ts'], evidence: 'Node.js/TypeScript invoicing service in production; Go only on the learning list', framing: 'direct', phrasing: 'TypeScript services in production' },
      { requirement: 'Go', importance: 'important', factIds: ['ll-go'], evidence: "Porting ledger-lite's trial-balance endpoint to Go", framing: 'learning', phrasing: "learning Go by porting ledger-lite's trial-balance endpoint" },
      { requirement: '24/7 on-call rotation from your first month', importance: 'important', factIds: ['f-tess-docker'], evidence: 'Wrote the runbook the on-call rotation now uses', framing: 'transferable', phrasing: 'wrote the runbook her on-call rotation uses' },
      { requirement: 'Deep experience with Kafka or a comparable streaming system', importance: 'important', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'A track record of leading projects across multiple teams', importance: 'important', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'BS in Computer Science or equivalent', importance: 'important', factIds: ['f-edu-bs'], evidence: 'Bachelor of Science, Computer Science, Lahore Institute of Computing', framing: 'direct', phrasing: 'BS in Computer Science' },
      { requirement: 'Docker and container operations', importance: 'important', factIds: ['f-tess-docker'], evidence: 'Moved four services to Docker Compose with health checks', framing: 'direct', phrasing: 'moved four services to Docker Compose with health checks' },
      { requirement: 'Terraform, AWS and Datadog', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
    ],
    biggestGap: 'No production Kubernetes (only kind locally) and two years of experience against five asked',
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Junior Software Engineer: TypeScript services, Docker, on-call runbooks',
    summary:
      'Junior software engineer with two years of production TypeScript services. Moved four services to Docker Compose with health checks and wrote the runbook the on-call rotation uses; learning Go and Kubernetes now.',
    skills: [
      { group: 'Languages', items: ['TypeScript', 'Python'] },
      { group: 'Services and data', items: ['Node.js', 'Fastify', 'PostgreSQL', 'SQL'] },
      { group: 'Infrastructure', items: ['Docker Compose', 'Linux'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Moved four services from a hand-built VPS setup to Docker Compose with health checks; wrote the runbook the on-call rotation now uses.',
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.',
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
    emphasis: ['Led with the Docker Compose migration and on-call runbook: the closest true platform work', 'Go and Kubernetes only under Currently learning', 'No Kafka, Terraform or AWS listed'],
    keywordsUsed: ['TypeScript', 'Docker', 'on-call', 'health checks'],
  },
  letters: [
    v('hook', [], hook, 5.6, { specificity: 6, evidence: 6, voice: 4.5, clarity: 7.5, ask: 5, aiTells: 5 }, [
      'Cut "is a great step, and I would be excited to contribute"; it is flattery.',
      'Cut "I am a hard worker and I learn quickly"; show it.',
      'Replace "I would love the opportunity to discuss how I can help Harbor & Pine" with a concrete ask.',
    ]),
    v('proof', ['vb-learned-fast'], proof, 6.9, { specificity: 6.5, evidence: 7.5, voice: 6.5, clarity: 8, ask: 5, aiTells: 7 }, [
      'Replace "I\'d still like to be considered for the entry-level opening" with a reason the team should talk to you.',
      'Replace "Thank you for your consideration" with a concrete ask.',
    ]),
    v('story', ['vb-learned-fast', 'vb-learning-now'], story, 8.2, { specificity: 8, evidence: 8, voice: 9, clarity: 8, ask: 8, aiTells: 8.5 }),
  ],
  revised: {
    hook: revise('hook', [], hook, [
      [' is a great step, and I would be excited to contribute to the Platform team that owns it.', ' is the kind of shared tooling I like working on.'],
      [', but I am a hard worker and I learn quickly.', '. When nobody at work knew Docker Compose, I learned it and moved four services.'],
      ['I would love the opportunity to discuss how I can help Harbor & Pine.', 'Could we have a short call about the Platform team?'],
    ], 6.6, { specificity: 6.5, evidence: 6.5, voice: 6, clarity: 7.5, ask: 7, aiTells: 6.5 }),
    proof: revise('proof', ['vb-learned-fast'], proof, [
      ["I'd still like to be considered for the entry-level opening.", 'The runbook is the reliability work I know, and I would like to learn the rest on your Platform team.'],
      ['Thank you for your consideration.', 'Could we have a short call?'],
    ], 7.2, { specificity: 6.5, evidence: 7.5, voice: 7, clarity: 8, ask: 7, aiTells: 7.5 }),
  },
  subjects: [
    'Software Engineer I, Platform: Docker Compose migration and on-call runbook',
    'Software Engineer I, Platform: an honest application',
    'Software Engineer I, Platform application: Rania Haroon',
    'Platform team: TypeScript services, learning Go and Kubernetes now',
    'Entry-level Platform role: the runbook our on-call rotation uses',
  ],
  bestSubject: 3,
  outreach:
    "Harbor & Pine's Platform team owns reliability for the services it builds, and the closest work I've done is moving four services from a hand-built VPS to Docker Compose and writing the runbook our on-call rotation uses. I'm learning Go and Kubernetes now, on kind only, nothing in production. I also built the Node.js invoicing service behind about 9,000 invoices a month. I've applied for Software Engineer I, Platform. Would you be open to a short call?",
  followUp: `Hello,

I applied for the Software Engineer I role on Platform last week. A small update: I've kept porting ledger-lite's trial-balance endpoint to Go, and it now feels less like a course exercise and more like a real service. If it's useful, I'm happy to talk through the Docker Compose migration and runbook on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Harbor & Pine's Platform team owns the shared services every product team builds on, and you expect engineers to own the reliability of what they ship. That is the part of my job I've enjoyed most: I moved four services to Docker Compose with health checks at Tessellate Labs and wrote the runbook our on-call rotation still uses.",
    whyRole:
      "The Software Engineer I, Platform role is a stretch for me, and I'd rather say that plainly. I have two years of TypeScript services in production, I'm learning Go and Kubernetes now, and I haven't run Kubernetes or Kafka in production. What I can bring is the habit of owning what I ship, from the Docker Compose migration to the runbook.",
    project:
      "When our VPS provider announced a migration with two weeks' notice, nobody at work had written a Dockerfile, so I volunteered. I read the Compose docs on the bus, broke my laptop's networking twice, and learned more about health checks than I'd planned to. We moved four services, and the runbook I wrote is still pinned in our channel.",
  },
};
