import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Copperline team,

I read your post on idempotency keys, and it is a great example of the kind of engineering culture I want to join. Making sure a retry can never pay a seller twice is exactly the sort of problem I enjoy.

At Tessellate Labs I built and maintain the invoicing service in Node.js, TypeScript and PostgreSQL. It issues about 9,000 invoices a month for our logistics clients. I also built the React admin screens for refunds and credit notes, with role-based access checks on the API side.

In my own time I built ledger-lite, a small double-entry bookkeeping API that enforces balanced journal entries with a database constraint. It has 140 GitHub stars.

I'm learning Go at the moment, porting ledger-lite's trial-balance endpoint to it. I haven't worked on payouts, but money that has to add up is the work I like best.

I would love to bring this experience to the Payouts team. Please let me know if there is a good time to talk.

Best regards,
Rania Haroon`;

const proof = `Dear Copperline team,

Copperline Payments' post on idempotency keys says a retried payout must never pay a seller twice, and the rule I trust most in my own code works the same way: it lives where a careless script can't skip it. ledger-lite, my double-entry bookkeeping API, pushes the balance rule down into Postgres with a deferred constraint trigger that refuses to commit a transaction whose debits and credits don't match. It took me three weekends and one very confusing evening with deferrable constraints.

At Tessellate Labs I built and maintain the invoicing service, in Node.js, TypeScript and PostgreSQL, that issues about 9,000 invoices a month for our logistics clients. I also built the React admin screens for refunds and credit notes. They're the same kind of tool your operations team opens when a bank sends a payout back.

The work I'm proudest of there is boring. Our reconciliation job took 41 minutes and started overlapping with the morning invoice run, so customers got duplicate reminders. I rewrote it as set-based SQL with two partial indexes. Six minutes.

I haven't built payouts, and Go is something I'm learning now by porting ledger-lite's trial-balance endpoint.

Could we set up a short call with someone on the Payouts team?

Best regards,
Rania Haroon`;

const story = `Dear Copperline team,

My father ran a small hardware shop in Ichhra and kept his accounts in a green register with a rubber band around it. Every Ramzan the register stopped balancing and he'd sit up past sehri hunting for forty rupees. I wrote him a little spreadsheet when I was fifteen, and it showed him which day the money went missing.

I still like that feeling best, and it is why a payout and reconciliation company like Copperline appeals to me. If a ledger is off by one rupee, someone stays up all night.

Today I build billing software at Tessellate Labs. I built and maintain the Node.js and TypeScript invoicing service, about 9,000 invoices a month, and cut our reconciliation job from 41 minutes to 6 with set-based SQL. At home I built ledger-lite, which enforces balanced journal entries with a database constraint.

I'm learning Go now. I haven't built payouts yet.

I'd be glad to talk if the Payouts team is still hiring.

Best regards,
Rania Haroon`;

export const copperline: Application = {
  company: 'Copperline Payments',
  evidence: {
    priorities: [
      'Correct, idempotent money movement in Node.js and PostgreSQL',
      'Comfort with database transactions and the failure cases around them',
      'Operations tooling in React for returned payouts',
      'Calm, blameless habits around incidents',
    ],
    mustWins: ['Node.js and TypeScript services in production', 'Solid SQL with an understanding of transactions', 'Experience with money or ledger data'],
    tone: 'Precise and grown-up; correctness over speed',
    seniority: 'Junior (Software Engineer I, 1-2 years)',
    hooks: [
      { text: 'Engineering post on idempotency keys: every payout request carries a key so a retry can never pay a seller twice.', sourceUrl: 'https://copperline.example.com/engineering/idempotency-keys' },
      { text: 'Returned-payouts dashboard for operations teams (2026-08).', sourceUrl: 'https://copperline.example.com/product/returns' },
    ],
    items: [
      { requirement: '1-2 years of professional software engineering experience', importance: 'critical', factIds: ['f-exp-tessellate'], evidence: 'Junior Software Engineer at Tessellate Labs since Jul 2023', framing: 'direct', phrasing: 'two years as a software engineer on a billing team' },
      { requirement: 'Node.js and TypeScript', importance: 'critical', factIds: ['f-tess-invoicing', 'f-skill-node', 'f-skill-ts'], evidence: 'Built and maintains the Node.js/TypeScript invoicing service (about 9,000 invoices a month)', framing: 'direct', phrasing: 'builds and maintains Node.js and TypeScript services' },
      { requirement: 'Solid SQL and an understanding of database transactions', importance: 'critical', factIds: ['f-proj-ledger', 'f-tess-recon'], evidence: 'ledger-lite enforces balanced entries with a database constraint; reconciliation job cut from 41 to 6 minutes', framing: 'direct', phrasing: 'balance rules enforced inside the database transaction; set-based SQL' },
      { requirement: 'Idempotent, well-tested code for money movement', importance: 'important', factIds: ['f-tess-invoicing', 'f-proj-ledger'], evidence: 'Invoicing and double-entry bookkeeping; not payouts', framing: 'transferable', phrasing: 'billing and ledger code where every number has to add up' },
      { requirement: 'Internal React tools for operations and support', importance: 'important', factIds: ['f-tess-react'], evidence: 'React admin screens for refunds and credit notes with role-based access checks', framing: 'direct', phrasing: 'React tools for refunds and credit notes' },
      { requirement: 'Code review and blameless incident reviews', importance: 'important', factIds: ['f-tess-review'], evidence: 'Reviews pull requests for the billing team', framing: 'direct', phrasing: 'reviews pull requests for the billing team' },
      { requirement: 'Experience with payments, ledgers or financial data', importance: 'nice', factIds: ['f-tess-invoicing', 'f-proj-ledger'], evidence: 'Invoicing service and ledger-lite', framing: 'direct', phrasing: 'billing and ledger systems' },
      { requirement: 'Go', importance: 'nice', factIds: ['ll-go'], evidence: "Porting ledger-lite's trial-balance endpoint to Go", framing: 'learning', phrasing: "learning Go now by porting ledger-lite's trial-balance endpoint" },
      { requirement: 'Docker', importance: 'nice', factIds: ['f-tess-docker'], evidence: 'Moved four services to Docker Compose', framing: 'direct', phrasing: 'moved four services to Docker Compose' },
      { requirement: 'AWS', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
    ],
    biggestGap: 'Has not built payouts or handled bank returns',
    fastLearning: 'f-tess-docker',
  },
  cv: {
    headline: 'Junior Software Engineer: Node.js, TypeScript and PostgreSQL for billing',
    summary:
      'Junior software engineer with two years on a billing team, building Node.js and TypeScript services on PostgreSQL. Built the invoicing service and the React refund and credit-note tools, and enforces balance rules in the database in her own ledger-lite project.',
    skills: [
      { group: 'Back end', items: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'Fastify'] },
      { group: 'Front end', items: ['React'] },
      { group: 'Tooling', items: ['Docker Compose', 'Linux', 'pytest', 'Python'] },
      { group: 'Currently learning', items: ['Go'] },
    ],
    tessellate: [
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.',
      'Built the React (TypeScript) admin screens for refunds and credit notes, including role-based access checks on the API side.',
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
    emphasis: ['Led with the invoicing service and the reconciliation speed-up: billing work in the Payouts stack', 'ledger-lite shows database-level correctness for money', 'Go listed only under Currently learning'],
    keywordsUsed: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'React', 'code review'],
  },
  letters: [
    v('hook', ['vb-learning-now'], hook, 6.8, { specificity: 7, evidence: 7.5, voice: 6, clarity: 8, ask: 6, aiTells: 6 }, [
      'Cut "it is a great example of the kind of engineering culture I want to join"; it is flattery.',
      'Replace "I would love to bring this experience to the Payouts team" with a concrete ask.',
    ]),
    v('proof', ['vb-proudest-project', 'vb-hard-bug', 'vb-learning-now'], proof, 8.7, { specificity: 9, evidence: 9, voice: 8.5, clarity: 8.5, ask: 8, aiTells: 9 }),
    v('story', ['vb-why-build', 'vb-why-field'], story, 7.7, { specificity: 7, evidence: 8, voice: 9, clarity: 8, ask: 6.5, aiTells: 8 }, [
      'The story takes half the letter; cut "I still like that feeling best, and" and get to the billing work sooner.',
      'Replace "I\'d be glad to talk if the Payouts team is still hiring" with a specific ask.',
    ]),
  ],
  revised: {
    hook: revise('hook', ['vb-learning-now'], hook, [
      [', and it is a great example of the kind of engineering culture I want to join', ''],
      ['I would love to bring this experience to the Payouts team. Please let me know if there is a good time to talk.', 'Could I have a short call with someone on the Payouts team?'],
    ], 7.4, { specificity: 7.5, evidence: 7.5, voice: 6.5, clarity: 8, ask: 7.5, aiTells: 7 }),
    story: revise('story', ['vb-why-build', 'vb-why-field'], story, [
      ['I still like that feeling best, and it is why', 'It is why'],
      ["I'd be glad to talk if the Payouts team is still hiring.", 'Could we set up a short call about the Payouts team?'],
    ], 7.9, { specificity: 7.5, evidence: 8, voice: 9, clarity: 8, ask: 7.5, aiTells: 8 }),
  },
  subjects: [
    'Software Engineer I, Payouts: billing engineer from Lahore',
    'Software Engineer I: Node.js invoicing service, 9,000 invoices a month',
    'Payouts team application: ledgers enforced in Postgres',
    'Software Engineer I application: Rania Haroon',
    'Idempotent payouts and the ledger-lite constraint trigger',
  ],
  bestSubject: 2,
  outreach:
    "Copperline's post on idempotency keys made me want to apply for the Software Engineer I role on Payouts. I build billing software at Tessellate Labs: the Node.js and TypeScript invoicing service that issues about 9,000 invoices a month, plus the React refund tools. My side project ledger-lite enforces balanced journal entries with a database constraint. Would you be open to a short call about the team?",
  followUp: `Hello,

I applied for the Software Engineer I role on the Payouts team last week. One detail I left out: ledger-lite's balance rule is a deferred constraint trigger, so an unbalanced transaction can't commit at all, which is the same instinct as your idempotency keys. If it helps, I'm happy to walk someone through it on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Copperline Payments moves money for marketplaces, and the engineering post on idempotency keys shows the team cares about the failure cases, not just the happy path. That is the part of billing work I like most. At Tessellate Labs I maintain an invoicing service that issues about 9,000 invoices a month, and every number in it has to add up.",
    whyRole:
      "The Software Engineer I role on Payouts is the same stack I use every day: Node.js and TypeScript on PostgreSQL, with React tools for the operations side. I built the refund and credit-note screens at Tessellate Labs and cut our reconciliation job from 41 minutes to 6 with set-based SQL. I haven't built payouts, and that is the part I'd learn first.",
    project:
      "ledger-lite is a small double-entry bookkeeping API I built in TypeScript with Fastify and PostgreSQL. I didn't trust a check in the service layer, so I pushed the rule down into Postgres: a deferred constraint trigger refuses to commit a transaction whose debits and credits don't match. A stranger on GitHub later opened an issue saying it had caught a bug in their importer on day one.",
  },
};
