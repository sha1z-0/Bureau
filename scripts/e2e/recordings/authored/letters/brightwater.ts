import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Brightwater Health team,

Brightwater's two-way SMS, where a patient replies to confirm or delay a repeat prescription, is the kind of feature where the boring parts matter most: each reply has to reach the right patient record once, even when a provider retries the webhook.

I already care about getting that right in billing. At Tessellate Labs I built and maintain the invoicing service in Node.js, TypeScript and PostgreSQL, about 9,000 invoices a month, and I built the React admin screens for refunds and credit notes with role-based access checks on the API side.

Web security is something I've practised on purpose. I built chai-check, a browser extension that flags insecure form actions, while working through the PortSwigger Web Security Academy. I also like teams that say the scary thing out loud early, even when it's awkward, and I try to be the person who writes it down first. In my first month I shipped a migration that renamed a column without a fallback. My lead didn't shout. She asked me to write up what happened, and since then I write the rollback before the migration, every time.

I haven't built for healthcare or used Redis queues, and I'd treat patient data with the care your security page describes.

Could we set up a short call about the role?

Best regards,
Rania Haroon`;

const proof = `Dear Brightwater Health team,

I'm applying for the Junior Node.js Developer role because I have over one year of commercial experience with Node.js and TypeScript, which is your main requirement. At Tessellate Labs I maintain an invoicing service on PostgreSQL that issues about 9,000 invoices a month.

I understand REST API design and web security. I built role-based access checks for our refund screens, and I built chai-check, which flags insecure form actions.

I don't have healthcare experience, but I am very careful with data.

I hope to hear from you soon.

Best regards,
Rania Haroon`;

const story = `Dear Brightwater Health team,

The billing team at Tessellate is four people and a shared Google Doc called 'things that scared us this week'. Anyone can add to it, and on Fridays we go through it together. The other half of the items turn into tickets before they turn into incidents.

Patient data seems like exactly the place for that habit. I build Node.js and TypeScript services on PostgreSQL at Tessellate Labs and built chai-check while working through the PortSwigger Web Security Academy.

Please let me know if you would like to talk.

Best regards,
Rania Haroon`;

export const brightwater: Application = {
  company: 'Brightwater Health',
  evidence: {
    priorities: [
      'Node.js (TypeScript) services that send reminders and handle patient replies',
      'PostgreSQL and Redis-backed queues; SMS and email delivery webhooks',
      'Keeping patient data safe: authentication and input validation',
    ],
    mustWins: ['1+ year of commercial Node.js', 'JavaScript or TypeScript with SQL', 'Basic web security'],
    tone: 'Careful and plain; a small team in a regulated field',
    seniority: 'Junior (1+ year)',
    hooks: [
      { text: 'Two-way SMS: patients reply to a reminder to confirm or delay a repeat prescription (2026-07).', sourceUrl: 'https://brightwaterhealth.example.com/updates/two-way-sms' },
      { text: 'Patient data is kept to the minimum needed and access is logged.', sourceUrl: 'https://brightwaterhealth.example.com/security' },
    ],
    items: [
      { requirement: '1+ year of commercial experience with Node.js', importance: 'critical', factIds: ['f-exp-tessellate', 'f-tess-invoicing'], evidence: 'Two years on the Node.js/TypeScript invoicing service at Tessellate Labs', framing: 'direct', phrasing: 'two years of commercial Node.js' },
      { requirement: 'Good knowledge of JavaScript or TypeScript, and of SQL', importance: 'critical', factIds: ['f-skill-ts', 'f-tess-recon'], evidence: 'TypeScript daily; reconciliation job from 41 to 6 minutes with set-based SQL', framing: 'direct', phrasing: 'TypeScript and SQL every day' },
      { requirement: 'REST API design and basic web security (authentication, input validation)', importance: 'important', factIds: ['f-tess-react', 'f-proj-chai'], evidence: 'Role-based access checks on the API side; chai-check from the PortSwigger Web Security Academy', framing: 'direct', phrasing: 'role-based access checks on the API side, and web security practice' },
      { requirement: 'PostgreSQL and Redis-backed job queues', importance: 'important', factIds: ['f-skill-pg', 'f-tess-invoicing'], evidence: 'PostgreSQL in production; no Redis', framing: 'transferable', phrasing: 'PostgreSQL in production; queues would be new' },
      { requirement: 'Integrate with SMS and email providers and handle delivery webhooks', importance: 'important', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'Write tests and help keep patient data safe', importance: 'important', factIds: ['f-kestrel-tests', 'f-tess-react'], evidence: 'Loader coverage 0 to 71%; role-based access checks', framing: 'transferable', phrasing: 'tests and access checks' },
      { requirement: 'Excellent written English', importance: 'important', factIds: ['f-tess-docker'], evidence: 'Wrote the runbook the on-call rotation uses', framing: 'transferable', phrasing: 'writes runbooks people use' },
      { requirement: 'Experience in healthcare or another regulated industry', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'Docker and AWS', importance: 'nice', factIds: ['f-tess-docker'], evidence: 'Docker Compose migration; no AWS', framing: 'direct', phrasing: 'moved four services to Docker Compose' },
    ],
    biggestGap: 'No healthcare experience and no Redis queues',
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Junior Node.js Developer: TypeScript, PostgreSQL, web security',
    summary:
      'Junior software engineer with two years of commercial Node.js and TypeScript on PostgreSQL. Builds role-based access checks into the API side and practises web security; built chai-check while working through the PortSwigger Web Security Academy.',
    skills: [
      { group: 'Back end', items: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'Fastify'] },
      { group: 'Security', items: ['Burp Suite (Community)'] },
      { group: 'Tooling', items: ['Docker Compose', 'Linux', 'pytest'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Built the React (TypeScript) admin screens for refunds and credit notes, including role-based access checks on the API side.',
      'Moved four services from a hand-built VPS setup to Docker Compose with health checks; wrote the runbook the on-call rotation now uses.',
      'Cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.',
    ],
    kestrel: [
      'Added unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
      'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).',
    ],
    projects: [
      { name: 'chai-check', description: 'A browser extension that flags insecure form actions (HTTP, mixed content), built while working through the PortSwigger Web Security Academy.', highlights: [] },
      { name: 'ledger-lite', description: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL) that enforces balanced journal entries with a database constraint.', highlights: ['140 GitHub stars'] },
    ],
    emphasis: ['Led with commercial Node.js and the access checks', 'chai-check first among projects for the web security ask', 'No Redis, AWS or healthcare claims'],
    keywordsUsed: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'web security'],
  },
  letters: [
    v('hook', ['vb-team-loved', 'vb-failure'], hook, 8.6, { specificity: 9, evidence: 8.5, voice: 8.5, clarity: 8.5, ask: 8, aiTells: 8.5 }),
    v('proof', [], proof, 5.6, { specificity: 5.5, evidence: 7, voice: 5, clarity: 7.5, ask: 4.5, aiTells: 5.5 }, [
      'Replace "I\'m applying for the Junior Node.js Developer role because" with an opening specific to Brightwater.',
      'Change "over one year of commercial experience" to the true two years and drop "which is your main requirement".',
      'Cut "but I am very careful with data"; show it.',
      'Replace "I hope to hear from you soon" with a concrete ask.',
    ]),
    v('story', ['vb-team-loved'], story, 7.0, { specificity: 7, evidence: 6, voice: 8.5, clarity: 7, ask: 5, aiTells: 7.5 }, [
      'The second paragraph needs a concrete result from your Node.js work.',
      'Replace "Please let me know if you would like to talk" with a concrete ask.',
    ]),
  ],
  revised: {
    proof: revise('proof', [], proof, [
      ["I'm applying for the Junior Node.js Developer role because I have over one year of commercial experience with Node.js and TypeScript, which is your main requirement.", "Brightwater's reminder services run on the stack I use every day: I have two years of commercial experience with Node.js and TypeScript."],
      [', but I am very careful with data.', '. I write the rollback before every migration.'],
      ['I hope to hear from you soon.', 'Could we set up a short call?'],
    ], 6.8, { specificity: 6.5, evidence: 7, voice: 6, clarity: 7.5, ask: 7, aiTells: 7 }),
    story: revise('story', ['vb-team-loved'], story, [
      ['I build Node.js and TypeScript services on PostgreSQL at Tessellate Labs', 'I maintain a Node.js and TypeScript invoicing service on PostgreSQL at Tessellate Labs, about 9,000 invoices a month,'],
      ['Please let me know if you would like to talk.', 'Could we set up a short call?'],
    ], 7.5, { specificity: 7, evidence: 7, voice: 8.5, clarity: 7.5, ask: 7, aiTells: 7.5 }),
  },
  subjects: [
    'Junior Node.js Developer: billing services and web security practice',
    'Junior Node.js Developer application: Rania Haroon',
    'Two-way SMS replies and the engineer who writes rollbacks first',
    'Junior Node.js Developer: Node.js, PostgreSQL, access checks',
    'Application for the remote Node.js role from Lahore',
  ],
  bestSubject: 0,
  outreach:
    "Brightwater's two-way SMS for repeat prescriptions caught my eye: each patient reply has to land on the right record once, even when a webhook is retried. I build billing software in Node.js, TypeScript and PostgreSQL at Tessellate Labs, with role-based access checks on the API side, and I practise web security on the side. I've applied for the Junior Node.js Developer role. Could we have a short call?",
  followUp: `Hello,

I applied for the Junior Node.js Developer role last week. One detail I left out: chai-check, my browser extension that flags insecure form actions, came out of working through the PortSwigger Web Security Academy, which is where I learned most of what I know about input validation. If it helps, I'm happy to talk it through on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Brightwater Health makes software that reminds people to collect their medicine, which is a small thing that matters a lot to the person waiting for it. Your two-way SMS shows the team thinks about the patient on the other end. I'd like to bring the careful habits I learned on a billing team to patient data.",
    whyRole:
      "The Junior Node.js Developer role is Node.js and TypeScript on PostgreSQL, which I've used for two years at Tessellate Labs on our invoicing service. I built role-based access checks on the API side and practised web security through the PortSwigger Web Security Academy. I haven't used Redis queues, and that is the first thing I'd learn.",
    project:
      "chai-check is a browser extension that flags insecure form actions, such as forms that post over plain HTTP or mix secure and insecure content. I built it while working through the PortSwigger Web Security Academy, because I wanted something that would point out the problems on pages I actually use.",
  },
};
