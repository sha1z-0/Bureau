import { DEFAULT_PREFERENCES, type Profile } from '../services/profileStore.ts';
import type { MatchJob } from './jobs.ts';
import { toMatchProfile, type MatchProfile } from './profile.ts';
import type { JobMatchAssessment } from './scoring.ts';

/**
 * Offline test data for the matcher: a fictional candidate, three postings and
 * the recorded Claude assessments for them (an inflated entry-level post, a true
 * clearance blocker, a strong match). `server/match/record-fixtures.ts` writes
 * the replay files under fixtures/claude/{match,score}/ from this module, so the
 * recordings always hash against the current rubric and rendering.
 */

/** The clock the fixtures are scored at. */
export const FIXTURE_NOW = '2026-11-02T09:00:00.000Z';

const CV = `# Sana Mirza
Lahore, Pakistan · sana.mirza@example.com · github.com/sana-example

## Experience
**Junior Full-Stack Developer**, Kestrel Apps (remote, client team in the UK), May 2025 – Present
- Build features for a booking platform in React, TypeScript and Next.js used by 40 clinics.
- Wrote and maintain the Node.js/Express REST API (14 endpoints) and its PostgreSQL schema and migrations.
- Added Jest unit tests and Playwright end-to-end tests; raised API test coverage from 31% to 74%.
- Set up GitHub Actions to lint, test and deploy preview builds on every pull request.
- Work async with a UK product manager; write the weekly release notes.

**Software Engineering Intern**, Daftar Labs, Lahore, Jun 2024 – Aug 2024
- Built internal dashboards in React with a Firebase backend.

## Projects
- **Qasr**: open-source expense splitter (Next.js, tRPC, PostgreSQL), 120 GitHub stars.
- **Pulse Monitor**: uptime checker with a Node.js worker and a React status page.

## Education
BS Computer Science, FAST-NUCES Lahore, 2020 – 2024

## Skills
TypeScript, JavaScript, React, Next.js, Node.js, Express, PostgreSQL, REST APIs, Jest, Playwright, Git, GitHub Actions, Tailwind CSS`;

/** The candidate as v1 stores her. */
export const TEST_V1_PROFILE: Profile = {
  name: 'Sana Mirza',
  headline: 'Junior full-stack developer (TypeScript, React, Node.js)',
  email: 'sana.mirza@example.com',
  phone: '',
  location: 'Lahore, Pakistan',
  links: [{ label: 'GitHub', url: 'https://github.com/sana-example' }],
  summary: 'Full-stack developer with 1.5 years building a clinic booking platform in React, TypeScript, Node.js and PostgreSQL for a UK client team, working fully remote.',
  yearsExperience: 1.5,
  seniority: 'junior',
  categories: ['web', 'software'],
  targetRoles: ['Full-Stack Developer', 'Frontend Engineer', 'Software Engineer'],
  coreStack: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Next.js'],
  skills: ['JavaScript', 'Express', 'REST APIs', 'Jest', 'Playwright', 'Git', 'GitHub Actions', 'Tailwind CSS'],
  experience: [
    { role: 'Junior Full-Stack Developer', company: 'Kestrel Apps', location: 'Remote', start: 'May 2025', end: 'Present', bullets: [] },
    { role: 'Software Engineering Intern', company: 'Daftar Labs', location: 'Lahore', start: 'Jun 2024', end: 'Aug 2024', bullets: [] },
  ],
  projects: [
    { name: 'Qasr', link: '', description: 'Open-source expense splitter in Next.js, tRPC and PostgreSQL', highlights: [] },
    { name: 'Pulse Monitor', link: '', description: 'Uptime checker with a Node.js worker and a React status page', highlights: [] },
  ],
  education: [{ school: 'FAST-NUCES Lahore', degree: 'BS Computer Science', start: '2020', end: '2024', details: '' }],
  certifications: [],
  languages: ['English', 'Urdu'],
  achievements: [],
  voice: '',
  cvMarkdown: CV,
  portfolioNotes: '',
  preferences: {
    ...DEFAULT_PREFERENCES,
    targetRoles: ['Full-Stack Developer', 'Frontend Engineer', 'Software Engineer'],
    categories: ['web', 'software'],
    locations: ['Remote', 'Lahore, Pakistan'],
    remoteOnly: false,
    needsSponsorship: false,
    minSalary: 18_000,
    currency: 'USD',
    excludeCompanies: ['Shadyco'],
    excludeKeywords: ['gambling'],
    workAuthorization: 'Pakistani citizen; works remotely as a contractor',
  },
};

/** The candidate as the matcher sees her, with two skills on the learning list. */
export const TEST_PROFILE: MatchProfile = { ...toMatchProfile(TEST_V1_PROFILE), learning: ['AWS', 'Docker'] };

const job = (j: Partial<MatchJob> & Pick<MatchJob, 'id' | 'title' | 'company' | 'descriptionText'>): MatchJob => ({
  companyId: null,
  location: 'Remote',
  remote: true,
  category: 'web',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  postedAt: null,
  foundAt: '2026-11-01T00:00:00.000Z',
  prefilterScore: 70,
  legitimacy: 'ok',
  priority: 0,
  status: 'new',
  url: `https://jobs.example.com/${j.id}`,
  applyUrl: null,
  applyEmail: null,
  ...j,
});

export const FIXTURE_JOBS = {
  inflated: job({
    id: 'fx-match-inflated',
    title: 'Junior Full-Stack Engineer (Entry Level)',
    company: 'Northwind Labs',
    location: 'Remote (worldwide)',
    salaryMin: 30_000,
    salaryMax: 45_000,
    salaryCurrency: 'USD',
    postedAt: '2026-11-01T15:00:00.000Z',
    prefilterScore: 72,
    descriptionText: `Northwind Labs builds scheduling software for logistics teams. We are hiring an entry-level full-stack engineer to join our product squad.

What you'll do
- Ship features across our React/TypeScript front end and Node.js services.
- Write and review REST APIs backed by PostgreSQL.
- Help run our AWS infrastructure (Lambda, S3, ECS) and our CI/CD pipelines.

Requirements
- 5+ years of professional software development experience.
- Strong React and TypeScript.
- Node.js and REST API design.
- PostgreSQL.
- AWS (Lambda, S3, ECS).
- Docker and Kubernetes in production.
- CI/CD pipelines (GitHub Actions or CircleCI).

Nice to have
- GraphQL.
- A computer science degree or equivalent experience.

This is an entry-level role: we offer mentoring, a learning budget and a fully remote team across 9 countries. Apply through our careers page.`,
  }),
  clearance: job({
    id: 'fx-match-clearance',
    title: 'Software Engineer II, Mission Platforms',
    company: 'Ridgeline Defense Systems',
    location: 'Remote',
    salaryMin: 95_000,
    salaryMax: 120_000,
    salaryCurrency: 'USD',
    postedAt: '2026-10-28T12:00:00.000Z',
    prefilterScore: 66,
    descriptionText: `Ridgeline Defense Systems builds mission-planning software for defence customers. Our Mission Platforms team is hiring a Software Engineer II.

Responsibilities
- Build React and TypeScript interfaces for mission planners.
- Develop Node.js services that run in AWS GovCloud.
- Work within NIST 800-171 and DoD security controls.

Required
- An active Secret security clearance. This position requires U.S. citizenship.
- 3+ years of professional software engineering experience.
- Production experience with TypeScript and React.
- Node.js services.

Preferred
- AWS GovCloud.
- Experience with DoD compliance frameworks (NIST 800-171, CMMC).

Remote within our approved program, with occasional travel to customer sites.`,
  }),
  strong: job({
    id: 'fx-match-strong',
    title: 'Full-Stack Developer (TypeScript/React)',
    company: 'Brightleaf Health',
    location: 'Remote (UTC+0 to UTC+6)',
    salaryMin: 40_000,
    salaryMax: 55_000,
    salaryCurrency: 'USD',
    postedAt: '2026-10-29T10:00:00.000Z',
    prefilterScore: 78,
    priority: 1,
    descriptionText: `Brightleaf Health makes appointment and reminder software for small clinics. We are a remote team of 25 and we're hiring a full-stack developer.

You will
- Build patient-facing booking flows in React and TypeScript.
- Extend our Node.js and Express API and its PostgreSQL database.
- Write tests (Jest, Playwright) and keep our CI green.
- Work async with product and design; we write things down.

You have
- 1 to 3 years building production web apps with React and TypeScript.
- Node.js and Express APIs.
- PostgreSQL.
- Writing automated tests (Jest, Playwright).
- REST API design.
- Clear written English for async remote work.

Bonus
- Docker.
- Experience in healthcare or with regulated data.

Salary 40,000 to 55,000 USD, fully remote between UTC+0 and UTC+6.`,
  }),
} as const;

export const FIXTURE_ASSESSMENTS: Record<keyof typeof FIXTURE_JOBS, JobMatchAssessment> = {
  inflated: {
    id: 'fx-match-inflated',
    postingLevel: 'entry',
    inflatedPosting: true,
    inflationNote: 'An entry-level title asks for 5+ years and a production AWS, Docker and Kubernetes stack.',
    requirements: [
      { text: 'React and TypeScript', importance: 'critical', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: '1.5 years of React and TypeScript at Kestrel Apps' },
      { text: 'Node.js and REST API design', importance: 'critical', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'Wrote the Node.js/Express REST API (14 endpoints)' },
      { text: '5+ years of professional experience', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 5, match: 'missing', proofKind: 'none', proof: '' },
      { text: 'PostgreSQL', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'Owns the PostgreSQL schema and migrations at Kestrel Apps' },
      { text: 'AWS (Lambda, S3, ECS)', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'partial', proofKind: 'learning', proof: 'currently learning' },
      { text: 'Docker in production', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'partial', proofKind: 'learning', proof: 'currently learning' },
      { text: 'Kubernetes in production', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'missing', proofKind: 'none', proof: '' },
      { text: 'CI/CD pipelines (GitHub Actions)', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'Set up GitHub Actions lint, test and preview deploys' },
      { text: 'GraphQL', importance: 'nice', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'missing', proofKind: 'none', proof: '' },
      { text: 'Computer science degree', importance: 'nice', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'BS Computer Science, FAST-NUCES 2024' },
    ],
    dimensions: { skills: 4, experience: 3, domain: 3, logistics: 5, compensation: 4, growth: 4 },
    legitimacy: 'ok',
    confidence: 'high',
    verdict: 'Apply: the core React, TypeScript, Node and PostgreSQL stack is all there, and the 5-year line is boilerplate on an entry-level role.',
    strengths: ['Same core stack in production at Kestrel Apps', 'Owns a REST API and its PostgreSQL schema', 'GitHub Actions CI already set up', 'Remote work with a distributed team'],
    gaps: ['Far short of the stated 5 years', 'No production Kubernetes', 'AWS and Docker only at the learning stage'],
    redFlags: [],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['React', 'TypeScript', 'Node.js', 'REST APIs', 'PostgreSQL', 'CI/CD', 'GitHub Actions'],
    seniorityFit: 'match',
  },
  clearance: {
    id: 'fx-match-clearance',
    postingLevel: 'mid',
    inflatedPosting: false,
    inflationNote: '',
    requirements: [
      { text: 'Active Secret security clearance', importance: 'critical', evidence: 'stated', blocker: true, blockerKind: 'clearance', yearsAsked: 0, match: 'missing', proofKind: 'none', proof: '' },
      { text: 'U.S. citizenship', importance: 'critical', evidence: 'stated', blocker: true, blockerKind: 'citizenship', yearsAsked: 0, match: 'missing', proofKind: 'none', proof: '' },
      { text: '3+ years of software engineering', importance: 'critical', evidence: 'stated', blocker: true, blockerKind: 'years', yearsAsked: 3, match: 'missing', proofKind: 'none', proof: '' },
      { text: 'TypeScript and React in production', importance: 'critical', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'Ships React and TypeScript features at Kestrel Apps' },
      { text: 'Node.js services', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'Maintains the Node.js/Express API at Kestrel Apps' },
      { text: 'AWS GovCloud', importance: 'nice', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'partial', proofKind: 'learning', proof: 'currently learning' },
      { text: 'DoD compliance (NIST 800-171, CMMC)', importance: 'nice', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'missing', proofKind: 'none', proof: '' },
    ],
    dimensions: { skills: 4, experience: 2, domain: 1, logistics: 1, compensation: 5, growth: 3 },
    legitimacy: 'ok',
    confidence: 'high',
    verdict: 'Skip: the role needs an active Secret clearance and U.S. citizenship, which the candidate cannot get past at the screen.',
    strengths: ['React and TypeScript match the front-end work', 'Node.js services experience'],
    gaps: ['No security clearance', 'Not a U.S. citizen', 'Short of the 3 years asked', 'No defence or compliance background'],
    redFlags: [],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['TypeScript', 'React', 'Node.js'],
    seniorityFit: 'under',
  },
  strong: {
    id: 'fx-match-strong',
    postingLevel: 'junior',
    inflatedPosting: false,
    inflationNote: '',
    requirements: [
      { text: '1-3 years of React and TypeScript', importance: 'critical', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 1, match: 'met', proofKind: 'direct', proof: '1.5 years of React and TypeScript at Kestrel Apps' },
      { text: 'Node.js and Express APIs', importance: 'critical', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'Wrote the Node.js/Express REST API (14 endpoints)' },
      { text: 'PostgreSQL', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'Owns the PostgreSQL schema and migrations' },
      { text: 'Automated tests (Jest, Playwright)', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'Added Jest and Playwright tests; coverage 31% to 74%' },
      { text: 'REST API design', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'Designed the booking platform REST API' },
      { text: 'Clear written English for async work', importance: 'important', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'met', proofKind: 'direct', proof: 'Works async with a UK PM; writes release notes' },
      { text: 'Docker', importance: 'nice', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'partial', proofKind: 'learning', proof: 'currently learning' },
      { text: 'Healthcare or regulated data', importance: 'nice', evidence: 'stated', blocker: false, blockerKind: 'none', yearsAsked: 0, match: 'partial', proofKind: 'transferable', proof: 'Built a booking platform used by 40 clinics' },
    ],
    dimensions: { skills: 5, experience: 4, domain: 4, logistics: 5, compensation: 4, growth: 4 },
    legitimacy: 'ok',
    confidence: 'high',
    verdict: 'Apply now: a near-exact match on stack, level and even the clinic-booking domain.',
    strengths: ['Same stack: React, TypeScript, Node/Express, PostgreSQL', 'Clinic booking platform maps to their product', 'Jest and Playwright testing with measured coverage gains', 'Proven async remote work'],
    gaps: ['Docker is still being learned', 'No formal healthcare compliance experience'],
    redFlags: [],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['React', 'TypeScript', 'Node.js', 'Express', 'PostgreSQL', 'Jest', 'Playwright', 'REST API', 'async'],
    seniorityFit: 'match',
  },
};

/**
 * Usage the recordings carry: the first call writes the rubric + profile to the
 * cache, later calls read it. Realistic sizes for Haiku 5.5 with low effort.
 */
export const FIXTURE_USAGE = {
  inflated: { input_tokens: 640, output_tokens: 1180, cache_creation_input_tokens: 2780, cache_read_input_tokens: 0 },
  clearance: { input_tokens: 560, output_tokens: 940, cache_creation_input_tokens: 0, cache_read_input_tokens: 2780 },
  strong: { input_tokens: 600, output_tokens: 1050, cache_creation_input_tokens: 0, cache_read_input_tokens: 2780 },
} as const;
