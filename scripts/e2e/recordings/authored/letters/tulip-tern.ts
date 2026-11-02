import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Tulip & Tern team,

I loved reading your published accessibility checklist. It is inspiring to see a studio that takes accessibility so seriously, and I would be excited to bring my skills to your team.

I have two years of experience with React and TypeScript at Tessellate Labs, where I built admin screens for refunds and credit notes, and I maintain a Node.js invoicing service on PostgreSQL. I also built Bus Tracker Lahore, a React and Leaflet map used by about 300 people a month.

I am passionate about building fast, accessible websites, and I am confident I would be a valuable asset.

Thank you for considering my application.

Best regards,
Rania Haroon`;

const proof = `Dear Tulip & Tern team,

The small React apps Tulip & Tern builds for hotel owners are close to what I've shipped at Tessellate Labs, where I built the React (TypeScript) admin screens for refunds and credit notes, with role-based access checks on the API side. Those screens taught me that the access checks matter more than the buttons. Owners of small places don't want the clever part. They want the part where someone stops staying up late over a double booking, and that is the part I like best too.

In my own time I built Bus Tracker Lahore, a React and Leaflet map of Metro Bus stops with estimated arrival gaps from public timetables. About 300 people use it a month. On the back end I maintain a Node.js invoicing service on PostgreSQL, the same pairing as your booking API.

I haven't run an accessibility audit, and your published checklist is the first thing I'd read. I learn fastest with a real deadline. Nobody at work had written a Dockerfile when our VPS provider announced a migration with two weeks' notice, so I volunteered. I read the Compose docs on the bus and broke my laptop's networking twice. We moved four services.

Could we set up a short call about the Junior Web Developer role?

Best regards,
Rania Haroon`;

const story = `Dear Tulip & Tern team,

My father ran a small hardware shop in Ichhra and kept his accounts in a green register with a rubber band around it. I wrote him a little spreadsheet when I was fifteen. It showed him which day the money went missing, and that was enough.

Independent hotels and B&Bs are small businesses like his, and I'd enjoy building the tools they use to manage rooms and bookings.

I've built React screens and a Node.js service at Tessellate Labs, and a Leaflet bus map in my own time.

I'd be grateful for the chance to talk.

Best regards,
Rania Haroon`;

export const tulipTern: Application = {
  company: 'Tulip & Tern',
  evidence: {
    priorities: [
      'Accessible, responsive pages from Figma designs',
      'React and TypeScript components connected to the Node.js booking API',
      'Fast client sites, with tests and bug fixing',
    ],
    mustWins: ['1+ year building websites with TypeScript', 'React', 'Care for accessibility and performance'],
    tone: 'Small, warm studio; plain and practical',
    seniority: 'Junior (1+ year)',
    hooks: [
      { text: 'Published the accessibility checklist the studio runs on every client site before launch (2026-09).', sourceUrl: 'https://tulipandtern.example.com/journal/accessibility-checklist' },
      { text: 'Small React apps that let hotel owners manage rooms and bookings, backed by a Node.js booking API.', sourceUrl: 'https://tulipandtern.example.com/' },
    ],
    items: [
      { requirement: '1+ year of experience building websites with HTML, CSS and JavaScript or TypeScript', importance: 'critical', factIds: ['f-tess-react', 'f-skill-ts'], evidence: 'React (TypeScript) admin screens at Tessellate Labs', framing: 'direct', phrasing: 'two years of React and TypeScript in production' },
      { requirement: 'Experience with React', importance: 'critical', factIds: ['f-tess-react', 'f-proj-bus'], evidence: 'React admin screens; Bus Tracker Lahore', framing: 'direct', phrasing: 'React in production and in a side project with about 300 monthly users' },
      { requirement: 'You care about accessibility and performance', importance: 'critical', factIds: ['f-proj-bus'], evidence: 'A public map used by about 300 people a month; no accessibility audit experience', framing: 'transferable', phrasing: 'builds for real users; has not run an accessibility audit' },
      { requirement: 'Connect components to our Node.js booking API', importance: 'important', factIds: ['f-tess-invoicing', 'f-skill-node'], evidence: 'Maintains a Node.js invoicing service', framing: 'direct', phrasing: 'Node.js on PostgreSQL in production' },
      { requirement: 'Fix bugs, write tests', importance: 'important', factIds: ['f-kestrel-tests'], evidence: 'Loader coverage 0 to 71% with pytest', framing: 'transferable', phrasing: 'writes tests' },
      { requirement: 'Node.js, PostgreSQL, or a headless CMS', importance: 'nice', factIds: ['f-tess-invoicing'], evidence: 'Node.js and PostgreSQL invoicing service', framing: 'direct', phrasing: 'Node.js and PostgreSQL' },
      { requirement: 'Dutch', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
    ],
    biggestGap: 'No formal accessibility work',
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Junior Web Developer: React, TypeScript and Node.js',
    summary:
      'Junior software engineer with two years of production React and TypeScript, plus the Node.js and PostgreSQL behind it. Built Bus Tracker Lahore, a React and Leaflet map used by about 300 people a month.',
    skills: [
      { group: 'Front end', items: ['React', 'TypeScript', 'Leaflet'] },
      { group: 'Back end', items: ['Node.js', 'PostgreSQL', 'SQL', 'Fastify'] },
      { group: 'Tooling', items: ['Docker Compose', 'Linux', 'pytest'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Built the React (TypeScript) admin screens for refunds and credit notes, including role-based access checks on the API side.',
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
      'Review pull requests for the billing team and paired with two interns through their first month.',
      'Moved four services from a hand-built VPS setup to Docker Compose with health checks; wrote the runbook the on-call rotation now uses.',
    ],
    kestrel: [
      'Added unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
      'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).',
    ],
    projects: [
      { name: 'Bus Tracker Lahore', description: 'A React + Leaflet map of Metro Bus stops with estimated arrival gaps from public timetables.', highlights: ['About 300 monthly users'] },
      { name: 'chai-check', description: 'A browser extension that flags insecure form actions (HTTP, mixed content), built while working through the PortSwigger Web Security Academy.', highlights: [] },
      { name: 'ledger-lite', description: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL) that enforces balanced journal entries with a database constraint.', highlights: ['140 GitHub stars'] },
    ],
    emphasis: ['Led with React screens and Bus Tracker Lahore', 'Node.js and PostgreSQL second for the booking API', 'No accessibility claims beyond the truth'],
    keywordsUsed: ['React', 'TypeScript', 'Node.js', 'PostgreSQL'],
  },
  letters: [
    v('hook', [], hook, 4.8, { specificity: 6, evidence: 6, voice: 4, clarity: 7, ask: 4, aiTells: 3.5 }, [
      'Cut "I loved reading" and "It is inspiring to see a studio that takes accessibility so seriously"; it is flattery.',
      'Cut "I am passionate about building fast, accessible websites"; the letter shows no accessibility work.',
      'Cut "I am confident I would be a valuable asset" and "Thank you for considering my application"; end with a concrete ask.',
    ]),
    v('proof', ['vb-why-build', 'vb-learned-fast'], proof, 8.4, { specificity: 8.5, evidence: 8.5, voice: 9, clarity: 8, ask: 8, aiTells: 8.5 }),
    v('story', ['vb-why-build'], story, 6.7, { specificity: 6.5, evidence: 5.5, voice: 9, clarity: 7.5, ask: 5, aiTells: 7.5 }, [
      'Add a concrete result from your React work; one sentence of evidence is not enough.',
      'Replace "I\'d be grateful for the chance to talk" with a concrete ask.',
    ]),
  ],
  revised: {
    hook: revise('hook', [], hook, [
      ['I loved reading your published accessibility checklist. It is inspiring to see a studio that takes accessibility so seriously, and I would be excited to bring my skills to your team.', 'Your published accessibility checklist is the first thing I would read before touching a client site.'],
      ['I am passionate about building fast, accessible websites, and I am confident I would be a valuable asset.\n\n', ''],
      ['Thank you for considering my application.', 'Could we set up a short call?'],
    ], 6.4, { specificity: 6.5, evidence: 6, voice: 6, clarity: 7.5, ask: 7, aiTells: 6.5 }),
    story: revise('story', ['vb-why-build'], story, [
      ['and a Leaflet bus map in my own time.', 'and a Leaflet bus map in my own time that about 300 people use a month.'],
      ["I'd be grateful for the chance to talk.", 'Could we set up a short call?'],
    ], 7.2, { specificity: 6.5, evidence: 6.5, voice: 9, clarity: 7.5, ask: 7, aiTells: 7.5 }),
  },
  subjects: [
    'Junior Web Developer: React screens and a bus map 300 people use',
    'Junior Web Developer application: Rania Haroon',
    'React and Node.js for hotel booking tools: Junior Web Developer',
    'Junior Web Developer: your accessibility checklist, read first',
    'Application from Lahore for the remote web developer role',
  ],
  bestSubject: 2,
  outreach:
    "Tulip & Tern's small React apps for hotel owners are close to what I build at Tessellate Labs: React (TypeScript) admin screens for refunds and credit notes, on a Node.js service. In my own time I built Bus Tracker Lahore, a React and Leaflet map about 300 people use a month. I haven't run an accessibility audit yet, and your checklist is where I'd start. I've applied for the Junior Web Developer role. Could we have a short call?",
  followUp: `Hello,

I applied for the Junior Web Developer role last week. One detail I left out: I also review pull requests for the billing team at Tessellate Labs, so small, careful changes to things people rely on are my everyday work. If it helps, I'm happy to walk someone through the map and my React admin screens on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Tulip & Tern builds tools for small, independent hotels, and I like working for people who run their own place. My father kept his shop's accounts in a green register, and the small spreadsheet I made him mattered more than anything clever. Your published accessibility checklist also tells me the studio does the careful work before launch.",
    whyRole:
      "The Junior Web Developer role is React and TypeScript components on a Node.js API, which is what I've built for two years at Tessellate Labs. I also built Bus Tracker Lahore, a React and Leaflet map about 300 people use a month. Accessibility audits would be new to me, and I'd start with your checklist.",
    project:
      "Bus Tracker Lahore is a React and Leaflet map of Metro Bus stops that shows estimated arrival gaps worked out from public timetables. It's a side project, and about 300 people use it a month, which is enough to make me careful with every change I push.",
  },
};
