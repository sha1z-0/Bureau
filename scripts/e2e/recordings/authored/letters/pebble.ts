import type { Application } from '../writer.ts';
import { revise, v } from './common.ts';

const hook = `Dear Pebble Analytics team,

Your new class-attendance forecasts are a great idea, and they show how much you care about your customers. I would be thrilled to join a team that helps gyms and studios plan better.

I am a junior software engineer with two years of experience. At Tessellate Labs I built React admin screens and maintain a Node.js and TypeScript invoicing service on PostgreSQL. As an intern at Kestrel Analytics I wrote Python scripts that loaded retail sales CSVs into PostgreSQL, about 2 million rows a week.

I believe my mix of data and web experience makes me a strong fit for the Junior Software Developer role.

I look forward to hearing from you.

Best regards,
Rania Haroon`;

const proof = `Dear Pebble Analytics team,

Pebble Analytics runs a PostgreSQL warehouse fed by nightly pipelines, and nightly jobs are where I've done my most useful work. At Tessellate Labs our reconciliation job took 41 minutes and nobody touched it because it worked. Then it started overlapping with the morning invoice run. I spent a day reading EXPLAIN output I only half understood. The real problem was boring: we updated rows one at a time inside a loop. I rewrote it as set-based SQL and added two partial indexes. Six minutes.

Before that, as an intern at Kestrel Analytics, I wrote the Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL, about 2 million rows a week. I also added unit tests to the loader with pytest, taking its coverage from 0 to 71%. Today I review pull requests for the billing team at Tessellate too.

Your front end is TypeScript, which is my daily language: I built React admin screens for refunds and credit notes and maintain a Node.js invoicing service. I haven't used Django, so your backend framework would be new. I'd learn it the way I learned Docker Compose when our VPS provider gave us two weeks' notice, reading the docs on the bus.

Could we set up a short call about the role?

Best regards,
Rania Haroon`;

const story = `Dear Pebble Analytics team,

Backend work suits the way my head works. I like problems where you can't see the result, only whether the numbers add up at the end of the day, and a gym owner looking at a membership dashboard is trusting exactly that.

I've spent two years at Tessellate Labs on billing software in Node.js, TypeScript and PostgreSQL, and as an intern at Kestrel Analytics I loaded about 2 million rows of retail sales a week into PostgreSQL with Python.

The posting doesn't say much about the role, so I'm happy to hear more.

Best regards,
Rania Haroon`;

export const pebble: Application = {
  company: 'Pebble Analytics',
  evidence: {
    priorities: [
      'Reporting dashboards for gyms and studios (the posting itself says almost nothing; the company site fills it in)',
      'Python/Django backend and a TypeScript front end',
      'A PostgreSQL warehouse fed by nightly pipelines',
    ],
    mustWins: ['Hands-on PostgreSQL and data loading', 'TypeScript front-end work', 'Comfort learning the Django backend'],
    tone: 'Small, plain-spoken team that publishes its salaries',
    seniority: 'Junior',
    hooks: [
      { text: 'Python/Django backend, a TypeScript front end and a PostgreSQL warehouse fed by nightly pipelines.', sourceUrl: 'https://pebbleanalytics.example.com/team' },
      { text: 'Class-attendance forecasts so studios can plan instructors a week ahead (2026-09).', sourceUrl: 'https://pebbleanalytics.example.com/blog/attendance-forecasts' },
    ],
    items: [
      { requirement: 'Junior software development experience', importance: 'important', factIds: ['f-exp-tessellate'], evidence: 'Junior Software Engineer at Tessellate Labs since Jul 2023', framing: 'direct', phrasing: 'two years as a junior engineer' },
      { requirement: 'PostgreSQL warehouse and nightly pipelines', importance: 'important', factIds: ['f-kestrel-etl', 'f-tess-recon'], evidence: 'Loaded about 2 million rows a week into PostgreSQL; nightly reconciliation job from 41 to 6 minutes', framing: 'direct', phrasing: 'nightly jobs and bulk loads into PostgreSQL' },
      { requirement: 'Python backend', importance: 'important', factIds: ['f-kestrel-etl', 'f-skill-python', 'f-kestrel-tests'], evidence: 'Python ingestion scripts with pytest tests', framing: 'transferable', phrasing: 'Python scripts with tests; Django would be new' },
      { requirement: 'TypeScript front end', importance: 'important', factIds: ['f-tess-react', 'f-skill-ts'], evidence: 'React (TypeScript) admin screens', framing: 'direct', phrasing: 'React and TypeScript in production' },
      { requirement: 'Django', importance: 'important', factIds: [], evidence: 'None', framing: 'omit', phrasing: '' },
    ],
    biggestGap: 'No Django experience',
    fastLearning: 'vb-learned-fast',
  },
  cv: {
    headline: 'Junior Software Developer: PostgreSQL, Python and TypeScript',
    summary:
      'Junior software engineer with two years of production TypeScript and PostgreSQL, plus Python data loading from an analytics internship. Cut a nightly reconciliation job from 41 minutes to 6 and loaded about 2 million rows a week into PostgreSQL.',
    skills: [
      { group: 'Data', items: ['PostgreSQL', 'SQL', 'Python', 'pytest'] },
      { group: 'Web', items: ['TypeScript', 'React', 'Node.js', 'Fastify'] },
      { group: 'Tooling', items: ['Docker Compose', 'Linux'] },
      { group: 'Currently learning', items: ['Go', 'Kubernetes'] },
    ],
    tessellate: [
      'Cut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.',
      'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company’s logistics clients.',
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
    emphasis: ['Led with nightly-job and loading work for a warehouse fed by nightly pipelines', 'Python and pytest from the Kestrel internship', 'TypeScript front-end proof second'],
    keywordsUsed: ['PostgreSQL', 'Python', 'TypeScript', 'React'],
  },
  letters: [
    v('hook', [], hook, 5.4, { specificity: 6.5, evidence: 6.5, voice: 4.5, clarity: 7, ask: 4.5, aiTells: 4.5 }, [
      'Cut "are a great idea, and they show how much you care about your customers"; it is flattery.',
      'Cut "I would be thrilled to join"; open with something you did.',
      'Cut "I believe my mix of data and web experience makes me a strong fit"; it is a stock line.',
      'Replace "I look forward to hearing from you" with a concrete ask.',
    ]),
    v('proof', ['vb-hard-bug', 'vb-learned-fast'], proof, 8.5, { specificity: 8.5, evidence: 9, voice: 8.5, clarity: 8.5, ask: 8, aiTells: 8.5 }),
    v('story', ['vb-why-field'], story, 6.9, { specificity: 7, evidence: 7, voice: 8.5, clarity: 7.5, ask: 4.5, aiTells: 7.5 }, [
      'Replace "The posting doesn\'t say much about the role, so I\'m happy to hear more" with a concrete ask.',
      'Name something from Pebble\'s own stack, such as the nightly pipelines.',
    ]),
  ],
  revised: {
    hook: revise('hook', [], hook, [
      ['Your new class-attendance forecasts are a great idea, and they show how much you care about your customers. I would be thrilled to join a team that helps gyms and studios plan better.', 'Your new class-attendance forecasts help studios plan a week ahead.'],
      ['I believe my mix of data and web experience makes me a strong fit for the Junior Software Developer role.\n\n', ''],
      ['I look forward to hearing from you.', 'Could we set up a short call?'],
    ], 6.6, { specificity: 7, evidence: 6.5, voice: 6, clarity: 7.5, ask: 7, aiTells: 6.5 }),
    story: revise('story', ['vb-why-field'], story, [
      ["The posting doesn't say much about the role, so I'm happy to hear more.", 'Your warehouse is fed by nightly pipelines, and nightly jobs are where I have done my best work. Could we set up a short call?'],
    ], 7.5, { specificity: 7.5, evidence: 7, voice: 8.5, clarity: 7.5, ask: 7, aiTells: 7.5 }),
  },
  subjects: [
    'Junior Software Developer: nightly jobs and PostgreSQL loading',
    'Junior Software Developer application: Rania Haroon',
    'Nightly pipelines: a reconciliation job from 41 minutes to 6',
    'Junior Software Developer: Python loaders and TypeScript screens',
    'Application for the remote junior developer role',
  ],
  bestSubject: 0,
  outreach:
    "Pebble Analytics feeds its PostgreSQL warehouse with nightly pipelines, and nightly jobs are where I've done my best work: at Tessellate Labs I cut a reconciliation job from 41 minutes to 6 with set-based SQL, and as an intern I loaded about 2 million rows a week into PostgreSQL with Python. I also built React admin screens in TypeScript, the language of your front end. I've applied for the Junior Software Developer role. Could we have a short call?",
  followUp: `Hello,

I applied for the Junior Software Developer role last week. One detail I left out: the Python loader I worked on as an intern had no tests when I started, and I took its coverage from 0 to 71% with pytest. If it helps, I'm happy to talk through how I'd test a nightly pipeline on a short call.

Best regards,
Rania Haroon`,
  answers: {
    whyUs:
      "Pebble Analytics gives small gyms and studios the reporting a big chain would have, and your class-attendance forecasts show it is useful, not decorative. I like work where the numbers have to add up at the end of the day. Your warehouse is fed by nightly pipelines, and nightly jobs are where I've done my best work.",
    whyRole:
      "The Junior Software Developer role touches the two things I know best: PostgreSQL and TypeScript. At Tessellate Labs I cut our nightly reconciliation job from 41 minutes to 6 and built React admin screens, and as an intern at Kestrel Analytics I loaded about 2 million rows a week into PostgreSQL with Python. Django would be new to me.",
    project:
      "At Kestrel Analytics I wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team, about 2 million rows a week. The loader had no tests when I started, so I added unit tests with pytest and took its coverage from 0 to 71%.",
  },
};
