/**
 * The weekly discovery search (task `scan`, A01's deep scan). In the e2e the
 * "web" is the fictional employer set, so the search results are the boards
 * of employers the e2e feeds already serve: discovery finds nothing new to
 * fetch, which keeps the scout stage's counts unchanged.
 */
import type { Answer, DumpedRequest } from './index.ts';

const RESULTS: { url: string; title: string }[] = [
  { url: 'https://boards.greenhouse.io/lumenledger/jobs/4012345', title: 'Job Application for Junior Backend Engineer at Lumen Ledger' },
  { url: 'https://boards.greenhouse.io/orchardrobotics', title: 'Jobs at Orchard Robotics' },
  { url: 'https://job-boards.greenhouse.io/harborpine/jobs/7034511', title: 'Software Engineer I, Platform - Harbor & Pine' },
  { url: 'https://jobs.lever.co/northwind-labs/8f3c2a71-5b9e-4d0a-a6c4-2e7d91b05f38', title: 'Northwind Labs - Backend Engineer (Junior)' },
  { url: 'https://jobs.ashbyhq.com/quillstack/6c1e9b74-2f0d-4a8e-b3c5-91d7e4a20f68', title: 'Associate Software Engineer @ Quillstack' },
  { url: 'https://apply.workable.com/brightwater-health/j/3F9A2C71B4', title: 'Junior Node.js Developer - Brightwater Health' },
  { url: 'https://kranich.jobs.personio.de/job/1458822', title: 'Junior Backend Developer (m/w/d) | Kranich Software GmbH' },
];

export function scanAnswer(req: DumpedRequest): Answer {
  if (!req.system.join('\n').includes('lists job-board URLs')) return { skip: 'scan: not the discovery prompt' };
  const text = [
    'I ran the site: searches. Most returned only aggregator pages or postings for senior roles; these are the job-posting URLs that appeared in the results:',
    '',
    ...RESULTS.map((r) => r.url),
    '',
    'The SmartRecruiters, Workday and Recruitee searches returned no matching postings I could see in the results.',
  ].join('\n');
  return { label: 'discovery', body: { text, sources: RESULTS } };
}
