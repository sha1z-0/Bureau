import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Orchard Robotics team,

I saw the new frost-alert timeline in the Orchard Robotics dashboard, and it looks like a really useful feature for growers. I would love to help build features like it.

I am a junior software engineer with two years of experience in React, TypeScript and Node.js. At Tessellate Labs I built the React admin screens for refunds and credit notes and maintain the Node.js invoicing service on PostgreSQL. In my free time I built Bus Tracker Lahore, a React and Leaflet map with about 300 monthly users.

I haven't used PostGIS or time-series data before, but I enjoy learning new things.

I think my mix of front-end and back-end experience would make me a good fit for the team. Thank you for considering my application.

Best regards,
Rania Haroon`;

const proof = `Dear Orchard Robotics team,

The map views of orchard blocks in the Orchard Robotics dashboard are the kind of thing I build for fun. Bus Tracker Lahore is my React and Leaflet map of Metro Bus stops, with estimated arrival gaps worked out from public timetables, and about 300 people use it a month.

At work it's the same stack, just less colourful. At Tessellate Labs I built the React (TypeScript) admin screens for refunds and credit notes, with role-based access checks on the API side, and I maintain the Node.js invoicing service on PostgreSQL behind them. ledger-lite, my own double-entry bookkeeping API, runs on Fastify and PostgreSQL, so your telemetry API wouldn't be new ground.

I haven't used PostGIS or time-series data. When our VPS provider announced a migration with two weeks' notice and nobody at work had written a Dockerfile, I volunteered anyway. I read the Compose docs on the bus and broke my laptop's networking twice. We moved four services. PostGIS would get the same treatment.

Helping the field team debug a robot's upload from the other side of the world also sounds like my favourite kind of problem. You can't see the result, only whether the numbers add up at the end of the day.

Could we talk next week?

Best regards,
Rania Haroon`;

const story = `Dear Orchard Robotics team,

Backend work suits the way my head works. I like problems where you can't see the result, only whether the numbers add up at the end of the day, and a robot uploading data from an orchard on the other side of the world is a good example.

I built Bus Tracker Lahore, a React and Leaflet map of Metro Bus stops with arrival gaps from public timetables, used by about 300 people a month. At Tessellate Labs I built React admin screens for refunds and credit notes and maintain a Node.js invoicing service on PostgreSQL.

I'm not experienced with PostGIS, though I'm keen to learn it.

Is there a good time to talk about the role?

Best regards,
Rania Haroon`;

export const orchard: Application = {
  company: 'Orchard Robotics',
  evidence: {
    priorities: [
      'Dashboard features in React and TypeScript: map views, alert timelines, report exports',
      'The Fastify API and PostgreSQL schema behind robot telemetry',
      'Tests and code review in a small team with two seniors',
      'Willingness to debug real-world data uploads',
    ],
    mustWins: ['React and TypeScript in production', 'REST APIs in Node.js', 'Working SQL'],
    tone: 'Friendly and concrete; a small hardware company with a web product',
    seniority: 'Junior (1-2 years)',
    hooks: [
      { text: 'Frost-alert timeline that shows damage block by block on the orchard map (2026-09).', sourceUrl: 'https://orchardrobotics.example.com/news/frost-alerts' },
      { text: 'Grower dashboard with map views of orchard blocks, alert timelines and report exports.', sourceUrl: 'https://orchardrobotics.example.com/dashboard' },
    ],
    items: [
      { requirement: '1-2 years of professional experience with React and TypeScript', importance: 'critical', factIds: ['f-tess-react', 'f-skill-react', 'f-skill-ts'], evidence: 'React (TypeScript) admin screens for refunds and credit notes at Tessellate Labs', framing: 'direct', phrasing: 'React and TypeScript in production for two years' },
      { requirement: 'Experience building REST APIs in Node.js', importance: 'critical', factIds: ['f-tess-invoicing', 'f-proj-ledger'], evidence: 'Node.js invoicing service; ledger-lite API on Fastify', framing: 'direct', phrasing: 'Node.js APIs, including a Fastify API on PostgreSQL' },
      { requirement: 'Working knowledge of SQL', importance: 'critical', factIds: ['f-tess-recon'], evidence: 'Reconciliation job from 41 to 6 minutes with set-based SQL', framing: 'direct', phrasing: 'set-based SQL on a live database' },
      { requirement: 'Node.js (Fastify) API and PostgreSQL schema', importance: 'important', factIds: ['f-proj-ledger', 'f-skill-fastify'], evidence: 'ledger-lite runs on Fastify and PostgreSQL', framing: 'direct', phrasing: 'Fastify and PostgreSQL' },
      { requirement: 'Write tests, review pull requests', importance: 'important', factIds: ['f-tess-review', 'f-kestrel-tests'], evidence: 'Reviews billing pull requests; loader coverage 0 to 71%', framing: 'direct', phrasing: 'reviews pull requests and writes tests' },
      { requirement: 'Leaflet, Mapbox or another web mapping library', importance: 'nice', factIds: ['f-proj-bus'], evidence: 'Bus Tracker Lahore: React + Leaflet map, about 300 monthly users', framing: 'direct', phrasing: 'built a Leaflet map used by about 300 people a month' },
      { requirement: 'PostGIS or time-series data', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
      { requirement: 'Hardware or IoT tinkering', importance: 'nice', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
    ],
    biggestGap: 'No PostGIS or time-series experience',
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Junior Full-Stack Developer: React, TypeScript, Node.js',
    summary:
      'Junior software engineer with two years of production React and TypeScript, plus the Node.js and PostgreSQL behind them. Built Bus Tracker Lahore, a React and Leaflet map used by about 300 people a month.',
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
      'Review pull requests for the billing team and paired with two interns through their first month.',
    ],
    kestrel: [
      'Added unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
      'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).',
    ],
    projects: [
      { name: 'Bus Tracker Lahore', description: 'A React + Leaflet map of Metro Bus stops with estimated arrival gaps from public timetables.', highlights: ['About 300 monthly users'] },
      { name: 'ledger-lite', description: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL) that enforces balanced journal entries with a database constraint.', highlights: ['140 GitHub stars'] },
      { name: 'chai-check', description: 'A browser extension that flags insecure form actions (HTTP, mixed content), built while working through the PortSwigger Web Security Academy.', highlights: [] },
    ],
    emphasis: ['Led with React and TypeScript admin screens', 'Bus Tracker Lahore first among projects for the mapping bonus', 'ledger-lite shows Fastify on PostgreSQL, the same API stack'],
    keywordsUsed: ['React', 'TypeScript', 'Node.js', 'Fastify', 'PostgreSQL', 'SQL', 'Leaflet'],
  },
  letters: [
    v('hook', ['vb-why-field'], hook, 6.1, { specificity: 6.5, evidence: 7, voice: 5, clarity: 7.5, ask: 5, aiTells: 5.5 }, [
      'Cut "it looks like a really useful feature for growers" and "I would love to help build features like it"; say what you would do with it.',
      'Cut "I think my mix of front-end and back-end experience would make me a good fit"; it is a stock closer.',
      'Replace "Thank you for considering my application" with a concrete ask.',
    ]),
    v('proof', ['vb-learned-fast', 'vb-why-field'], proof, 8.6, { specificity: 9, evidence: 9, voice: 8.5, clarity: 8.5, ask: 7.5, aiTells: 9 }),
    v('story', ['vb-why-field'], story, 7.2, { specificity: 7.5, evidence: 7.5, voice: 8, clarity: 7.5, ask: 6.5, aiTells: 7 }, [
      'Cut "though I\'m keen to learn it"; give an example of learning something fast instead.',
      'The letter is short on the dashboard itself; name the map views or the frost alerts.',
    ]),
  ],
  revised: {
    hook: revise('hook', ['vb-why-field'], hook, [
      [', and it looks like a really useful feature for growers. I would love to help build features like it.', '. Map views like that are the part of the job I would most like to work on.'],
      ['I think my mix of front-end and back-end experience would make me a good fit for the team. Thank you for considering my application.', 'Could we talk next week?'],
    ], 7.0, { specificity: 7, evidence: 7, voice: 6, clarity: 7.5, ask: 7, aiTells: 7 }),
    story: revise('story', ['vb-why-field'], story, [
      ["I'm not experienced with PostGIS, though I'm keen to learn it.", "I haven't used PostGIS. When our VPS provider gave us two weeks' notice, I learned Docker Compose and we moved four services."],
      ['and maintain a Node.js invoicing service on PostgreSQL.', 'and maintain a Node.js invoicing service on PostgreSQL. Your map views of orchard blocks are the part of the dashboard I would most like to work on.'],
    ], 7.7, { specificity: 8, evidence: 7.5, voice: 8, clarity: 7.5, ask: 6.5, aiTells: 7.5 }),
  },
  subjects: [
    'Junior Full-Stack Developer: React, Leaflet and a Fastify API',
    'Junior Full-Stack Developer application: Rania Haroon',
    'Orchard block maps: I built a Leaflet bus map 300 people use',
    'Junior Full-Stack Developer: React dashboards and Node.js APIs',
    'Application for the dashboard role at Orchard Robotics',
  ],
  bestSubject: 0,
  outreach:
    "Orchard Robotics' grower dashboard, with its map views of orchard blocks, is close to my favourite side project: Bus Tracker Lahore, a React and Leaflet map that about 300 people use a month. At Tessellate Labs I build React admin screens and a Node.js service on PostgreSQL, and ledger-lite runs on Fastify. I also review pull requests for the billing team. I've applied for the Junior Full-Stack Developer role. Could we have a short call?",
  followUp: `Hello,

I applied for the Junior Full-Stack Developer role last week. Since then I've looked at your frost-alert timeline, and showing damage block by block on the map is the kind of view I'd enjoy building, given my Leaflet bus map. If it's useful, I'm happy to walk someone through Bus Tracker Lahore on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Orchard Robotics turns what a robot sees in a row of trees into something a grower can act on, and that dashboard is where I'd be useful. I built Bus Tracker Lahore, a React and Leaflet map that about 300 people use a month, so map views of orchard blocks are close to work I already enjoy.",
    whyRole:
      "The Junior Full-Stack Developer role covers the stack I use every day: React and TypeScript in front, Node.js and PostgreSQL behind. At Tessellate Labs I built the React admin screens for refunds and credit notes and maintain the Node.js invoicing service. I haven't used PostGIS, and it's the first thing I'd learn.",
    project:
      "Bus Tracker Lahore is a React and Leaflet map of Metro Bus stops that shows estimated arrival gaps worked out from public timetables. It's a side project, and about 300 people use it a month, which is enough to make me careful with every change I push.",
  },
};
