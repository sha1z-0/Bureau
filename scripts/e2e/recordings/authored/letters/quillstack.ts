import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Quillstack team,

Quillstack's suggested edits, where a reviewer proposes the wording and the author accepts it one change at a time, are the doc version of something I already do every week. I review pull requests for the billing team at Tessellate Labs, and the best reviews there are small and easy to say yes to.

I'm a junior engineer with two years of production TypeScript. I built the React admin screens for refunds and credit notes, including the role-based access checks on the API side, and I maintain the Node.js invoicing service those screens talk to. It isn't an editor, but it is the same stack your Editor team works in, front to back.

Writing things down is the other half of it. I like teams that say the scary thing out loud early, even when it's awkward, and I try to be the person who writes it down first. When our VPS provider announced a migration with two weeks' notice and nobody at work had written a Dockerfile, I volunteered. I read the Compose docs on the bus and broke my laptop's networking twice. We moved four services, and the runbook I wrote is still pinned in our channel, typos included.

I haven't built a rich-text editor or touched CRDTs. I learn fastest next to someone who has, which is why the six months with a mentor matter to me.

Could we set up a short call next week?

Best regards,
Rania Haroon`;

const proof = `Dear Quillstack team,

I'd like to apply for the Associate Software Engineer role on the Editor team. I have two years of production TypeScript, React and Node.js at Tessellate Labs, where I built the React admin screens for refunds and credit notes and maintain the invoicing service behind them.

The invoicing service issues about 9,000 invoices a month, so I've learned to be careful with changes. In my first month I shipped a migration that renamed a column without a fallback, and the admin screen went blank. My lead asked me to write up what happened and add an expand-then-contract step to our migration checklist. Since then I write the rollback before the migration, every time.

I also review pull requests for the billing team and paired with two interns through their first month. Reviewing is a skill I enjoy, and docs-as-code with pull-request style review sounds like a natural fit for me.

I have no experience with ProseMirror or CRDTs. I am a quick learner, and I moved four services to Docker Compose in a short time when nobody else at work knew how.

I would welcome the chance to discuss the role.

Best regards,
Rania Haroon`;

const story = `Dear Quillstack team,

The billing team at Tessellate is four people and a shared Google Doc called 'things that scared us this week', and it is the closest thing I know to the review workflow Quillstack sells. Anyone can add to it. On Fridays we go through it together, and half the items turn into tickets before they turn into incidents.

That habit of writing the scary thing down early is how I work on code too. I review pull requests for the team, and I wrote the runbook our on-call rotation uses.

On the engineering side I have two years of production TypeScript. I built React admin screens for refunds and credit notes and maintain the Node.js invoicing service, so the React editor and the Node.js rendering services are both familiar ground, even if Markdown and MDX rendering is new.

I haven't worked on an editor or real-time collaboration. I'd be learning that from your mentor, the same way I learned Docker Compose when nobody else at work had.

If it helps, I could talk you through one of my write-ups on a short call.

Best regards,
Rania Haroon`;

export const quillstack: Application = {
  company: 'Quillstack',
  evidence: {
    priorities: [
      'Ship features in the React editor without breaking the writing flow',
      'Node.js services that render and publish Markdown and MDX',
      'Tests and pull-request review as everyday habits',
      'A junior who grows fast with a mentor and cares about documentation',
    ],
    mustWins: ['Production TypeScript and React', 'Node.js backend experience', 'Comfort with pull-request review'],
    tone: 'Warm and product-minded; writes like people who care about words',
    seniority: 'Junior (associate), paired with a mentor for six months',
    hooks: [
      { text: 'Suggested edits: reviewers propose wording changes inline and the author accepts them one by one (launched 2026-07).', sourceUrl: 'https://quillstack.example.com/changelog/suggested-edits' },
      { text: 'Documentation is part of the product and deserves the same review as code.', sourceUrl: 'https://quillstack.example.com/about' },
    ],
    items: [
      { requirement: 'Up to 2 years of professional experience with TypeScript and React', importance: 'critical', factIds: ['f-tess-react', 'f-skill-ts', 'f-skill-react'], evidence: 'Built the React (TypeScript) admin screens for refunds and credit notes at Tessellate Labs', framing: 'direct', phrasing: 'two years of production TypeScript and React' },
      { requirement: 'Some backend experience with Node.js', importance: 'critical', factIds: ['f-tess-invoicing', 'f-skill-node'], evidence: 'Built and maintains the Node.js/TypeScript invoicing service', framing: 'direct', phrasing: 'maintains a Node.js service in production' },
      { requirement: 'Comfortable with Git and pull-request workflows', importance: 'important', factIds: ['f-tess-review'], evidence: 'Reviews pull requests for the billing team', framing: 'direct', phrasing: 'reviews pull requests for her team every week' },
      { requirement: 'Ship features in the React editor and its collaboration layer', importance: 'important', factIds: ['f-tess-react'], evidence: 'React admin screens with role-based access checks; no editor work', framing: 'transferable', phrasing: 'React features shipped end to end, with the API checks behind them' },
      { requirement: 'Node.js services that render Markdown and MDX at scale', importance: 'important', factIds: ['f-tess-invoicing'], evidence: 'Node.js invoicing service; no rendering pipeline', framing: 'transferable', phrasing: 'Node.js services in production; rendering would be new' },
      { requirement: 'Write tests and take part in code review', importance: 'important', factIds: ['f-kestrel-tests', 'f-tess-review'], evidence: 'Raised loader test coverage from 0 to 71% with pytest; reviews billing pull requests', framing: 'direct', phrasing: 'writes tests and reviews code' },
      { requirement: 'An interest in technical writing', importance: 'nice', factIds: ['f-tess-docker'], evidence: 'Wrote the runbook the on-call rotation now uses', framing: 'direct', phrasing: 'wrote the runbook her on-call rotation uses' },
      { requirement: 'Experience with ProseMirror, CRDTs or real-time collaboration', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'Four hours of overlap with 08:00-16:00 UTC', importance: 'important', factIds: [], evidence: 'Logistics, not a claim: Lahore is UTC+5', framing: 'omit', phrasing: '' },
    ],
    biggestGap: 'No rich-text editor or real-time collaboration experience (ProseMirror, CRDTs)',
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Junior Software Engineer: TypeScript, React and Node.js',
    summary:
      'Junior software engineer with two years of production TypeScript: React admin screens and the Node.js service behind them. Reviews pull requests for the billing team and writes things down; the on-call runbook the team uses is hers.',
    skills: [
      { group: 'Front end', items: ['TypeScript', 'React', 'Leaflet'] },
      { group: 'Back end', items: ['Node.js', 'Fastify', 'PostgreSQL', 'SQL'] },
      { group: 'Testing and tooling', items: ['pytest', 'Docker Compose', 'Linux'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Built the React (TypeScript) admin screens for refunds and credit notes, including role-based access checks on the API side.',
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Review pull requests for the billing team; paired with two interns through their first month.',
      'Moved four services from a hand-built VPS setup to Docker Compose with health checks and wrote the runbook the on-call rotation now uses.',
    ],
    kestrel: [
      'Added unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
      'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).',
    ],
    projects: [
      { name: 'ledger-lite', description: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL) that enforces balanced journal entries with a database constraint.', highlights: ['140 GitHub stars', 'Exposes a trial balance endpoint'] },
      { name: 'Bus Tracker Lahore', description: 'A React + Leaflet map of Metro Bus stops with estimated arrival gaps from public timetables.', highlights: ['About 300 monthly users'] },
      { name: 'chai-check', description: 'A browser extension that flags insecure form actions (HTTP, mixed content), built while working through the PortSwigger Web Security Academy.', highlights: [] },
    ],
    emphasis: ['Led with React and TypeScript, the editor stack', 'Pull-request review and the runbook show the writing and review habit Quillstack sells', 'Kept the Node.js invoicing service second as backend proof'],
    keywordsUsed: ['TypeScript', 'React', 'Node.js', 'pull requests', 'code review', 'tests'],
  },
  letters: [
    v('hook', ['vb-learned-fast', 'vb-team-loved'], hook, 8.6, { specificity: 9, evidence: 8.5, voice: 8.5, clarity: 8.5, ask: 8, aiTells: 9 }),
    v('proof', ['vb-failure'], proof, 6.4, { specificity: 6, evidence: 7.5, voice: 6, clarity: 7.5, ask: 5.5, aiTells: 6 }, [
      'Replace the opening "I\'d like to apply for the Associate Software Engineer role" with something only Quillstack would recognise.',
      'Cut "sounds like a natural fit for me"; show the fit instead.',
      'Cut "I am a quick learner" and let the Docker Compose example carry it.',
      'Replace "I would welcome the chance to discuss the role" with a concrete ask.',
    ]),
    v('story', ['vb-team-loved', 'vb-learned-fast'], story, 7.6, { specificity: 8, evidence: 7.5, voice: 8.5, clarity: 7, ask: 7, aiTells: 8 }, [
      'The opening sentence is long; split "and it is the closest thing I know to the review workflow Quillstack sells" into its own sentence.',
      'Cut "so the React editor and the Node.js rendering services are both familiar ground"; it overstates rendering.',
    ]),
  ],
  revised: {
    proof: revise('proof', ['vb-failure'], proof, [
      ["I'd like to apply for the Associate Software Engineer role on the Editor team. I have", "Quillstack's Editor team works in the stack I use every day: I have"],
      [' Reviewing is a skill I enjoy, and docs-as-code with pull-request style review sounds like a natural fit for me.', ' Docs that go through pull-request review are how I already like to work.'],
      ['I am a quick learner, and I moved four services', 'I moved four services'],
      ['I would welcome the chance to discuss the role.', 'Could we talk for half an hour about the Editor team?'],
    ], 7.2, { specificity: 7, evidence: 7.5, voice: 6.5, clarity: 7.5, ask: 7.5, aiTells: 7 }),
    story: revise('story', ['vb-team-loved', 'vb-learned-fast'], story, [
      [", and it is the closest thing I know to the review workflow Quillstack sells. Anyone", ". It is the closest thing I know to the review workflow Quillstack sells. Anyone"],
      [', so the React editor and the Node.js rendering services are both familiar ground, even if Markdown and MDX rendering is new.', '. Markdown and MDX rendering would be new to me.'],
    ], 7.8, { specificity: 8, evidence: 7.5, voice: 8.5, clarity: 7.5, ask: 7, aiTells: 8 }),
  },
  subjects: [
    'Associate Software Engineer, Editor team: Rania Haroon',
    'Associate Software Engineer: React and Node.js, reviews PRs weekly',
    'Editor team application: TypeScript, React, Node.js',
    'Suggested edits, and the engineer who reviews pull requests',
    'Associate Software Engineer application from Lahore',
  ],
  bestSubject: 1,
  outreach:
    "Hi, I saw Quillstack's suggested edits launch: reviewers propose the wording, the author accepts it change by change. That is how I already review pull requests for the billing team at Tessellate Labs, where I built React admin screens and maintain a Node.js service. I've applied for the Associate Software Engineer role on the Editor team. Would you be open to a short chat about what the team is building next?",
  followUp: `Hello,

I applied for the Associate Software Engineer role on the Editor team last week and wanted to add one detail. Your MDX 3 upgrade caught my eye: the Node.js invoicing service I maintain at Tessellate Labs is the part of the stack I know best, and rendering is where I'd most like to grow. If it's useful, I'm happy to walk someone through my React admin screens on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Quillstack treats documentation the way good teams treat code, with every change reviewed before it ships. I already work like that on the billing team at Tessellate Labs, where I review pull requests and wrote the runbook our on-call rotation uses. Suggested edits is the feature I'd want to work on, because small, specific reviews are the ones people actually accept.",
    whyRole:
      "The Associate Software Engineer role sits in the stack I use every day: React with TypeScript on the front, Node.js behind it. At Tessellate Labs I built the React admin screens for refunds and credit notes and maintain the Node.js invoicing service. I haven't built an editor or used CRDTs, and six months with a mentor is how I'd want to learn that.",
    project:
      "ledger-lite started because I didn't trust my own code. A check in the service layer was the only thing stopping an unbalanced journal entry at work, so at home I rebuilt the idea and pushed the rule down into Postgres with a deferred constraint trigger. Then a stranger on GitHub opened an issue saying it had caught a bug in their importer on day one.",
  },
};
