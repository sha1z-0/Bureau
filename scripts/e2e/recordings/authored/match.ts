/**
 * The matcher's screen-pass assessments (task `match`) for every posting the
 * e2e scores, written as a careful recruiter would for Rania Haroon (two years
 * of TypeScript, Node.js and PostgreSQL in Lahore, UTC+5; Go and Kubernetes
 * on her learning list; AWS only queued). A batch's answer is assembled from
 * the per-posting assessments in the order of its <job_posting id="N"> keys.
 */
import { contentText, type Answer, type DumpedRequest } from './index.ts';

type Importance = 'critical' | 'important' | 'nice';
type MatchKind = 'met' | 'partial' | 'missing';
type ProofKind = 'direct' | 'transferable' | 'learning' | 'none';
interface Req {
  text: string;
  importance: Importance;
  evidence: 'stated' | 'inferred';
  blocker: boolean;
  blockerKind: 'none' | 'licence' | 'clearance' | 'citizenship' | 'degree' | 'years' | 'other';
  yearsAsked: number;
  match: MatchKind;
  proofKind: ProofKind;
  proof: string;
}
interface Assessment {
  postingLevel: 'intern' | 'entry' | 'junior' | 'mid' | 'senior' | 'lead' | 'unknown';
  inflatedPosting: boolean;
  inflationNote: string;
  requirements: Req[];
  dimensions: { skills: number; experience: number; domain: number; logistics: number; compensation: number; growth: number };
  legitimacy: 'ok' | 'suspect' | 'ghost' | 'scam';
  confidence: 'high' | 'medium' | 'low';
  verdict: string;
  strengths: string[];
  gaps: string[];
  redFlags: string[];
  applyChannel: 'email' | 'ats' | 'dm' | 'unknown';
  applyEmail: string;
  atsKeywords: string[];
  seniorityFit: 'under' | 'match' | 'over' | 'unknown';
}

const r = (text: string, importance: Importance, match: MatchKind, proofKind: ProofKind, proof: string, extra: Partial<Req> = {}): Req => ({
  text,
  importance,
  evidence: 'stated',
  blocker: false,
  blockerKind: 'none',
  yearsAsked: 0,
  match,
  proofKind,
  proof,
  ...extra,
});

/** The short generic posting several fixture employers share (TypeScript/Node.js/PostgreSQL, UTC+0 to +6, USD 28–36k). */
function generic(company: string, opts: { domain?: number; growth?: number; extraStrength?: string } = {}): Assessment {
  return {
    postingLevel: 'junior',
    inflatedPosting: false,
    inflationNote: '',
    requirements: [
      r('1+ years with TypeScript or Python', 'critical', 'met', 'direct', 'Two years of TypeScript/Node.js at Tessellate Labs', { yearsAsked: 1 }),
      r('comfort with SQL', 'critical', 'met', 'direct', 'Cut a 41-minute reconciliation job to 6 with set-based SQL'),
      r('TypeScript and Node.js services', 'important', 'met', 'direct', 'Built the Node.js/TypeScript invoicing service'),
      r('PostgreSQL', 'important', 'met', 'direct', 'Invoicing service and ledger-lite run on PostgreSQL'),
      r('write SQL migrations', 'important', 'met', 'direct', 'Schema design and migrations are her stated strength'),
      r('ship small features end to end', 'important', 'met', 'direct', 'Built React admin screens plus their API checks'),
      r('Remote within UTC+0 to UTC+6', 'critical', 'met', 'direct', 'Based in Lahore (UTC+5), remote only'),
      r('Docker', 'nice', 'met', 'direct', 'Moved four services to Docker Compose'),
      r('React', 'nice', 'met', 'direct', 'React admin screens for refunds and credit notes'),
      r('AWS', 'nice', 'missing', 'none', ''),
    ],
    dimensions: { skills: 5, experience: 4, domain: opts.domain ?? 3, logistics: 5, compensation: 4, growth: opts.growth ?? 3 },
    legitimacy: 'ok',
    confidence: 'medium',
    verdict: `Strong chance at ${company}: the stack named (TypeScript, Node.js, PostgreSQL) is exactly what she ships today, and Lahore sits inside the time zone window.`,
    strengths: ['Two years of production TypeScript and Node.js', 'Real PostgreSQL performance work (41 to 6 minutes)', 'Docker Compose migration and runbook', ...(opts.extraStrength ? [opts.extraStrength] : ['React admin screens'])],
    gaps: ['No AWS experience (only queued on her learning list)', 'The posting is short, so the team and product are unclear'],
    redFlags: [],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['TypeScript', 'Node.js', 'PostgreSQL', 'SQL', 'migrations', 'Docker', 'React'],
    seniorityFit: 'match',
  };
}

const ASSESSMENTS: Record<string, Assessment> = {
  'Lumen Ledger': generic('Lumen Ledger', {
    domain: 4,
    growth: 4,
    extraStrength: 'ledger-lite: balanced journal entries enforced in Postgres',
  }),
  'Meridian Freight': {
    ...generic('Meridian Freight', { domain: 3 }),
    postingLevel: 'entry',
    verdict:
      'Strong chance: the graduate title undersells what she has, but the stack named (TypeScript, Node.js, PostgreSQL) is her daily work and the time zone fits.',
    seniorityFit: 'over',
  },
  'Atlas Mutual': {
    ...generic('Atlas Mutual', { domain: 2 }),
    verdict: 'Good chance at Atlas Mutual: the posting asks for exactly her stack and time zone; nothing in it is a gate she misses.',
  },
  'Kranich Software GmbH': {
    postingLevel: 'junior',
    inflatedPosting: false,
    inflationNote: '',
    requirements: [
      r('1-2 years of professional experience with Node.js and TypeScript', 'critical', 'met', 'direct', 'Two years on Node.js/TypeScript services at Tessellate Labs', { yearsAsked: 1 }),
      r('solid SQL, ideally PostgreSQL', 'critical', 'met', 'direct', 'Reconciliation job cut from 41 to 6 minutes in PostgreSQL'),
      r('English at B2 level or better', 'critical', 'met', 'direct', 'English listed as fluent'),
      r('Design PostgreSQL schemas for tables with hundreds of millions of rows', 'important', 'partial', 'transferable', 'Schema and index work on invoicing data, smaller scale'),
      r('Integrations with ERP and accounting systems (SAP, DATEV)', 'important', 'partial', 'transferable', 'Invoicing service for logistics clients; no SAP or DATEV'),
      r('Automated tests and code reviews', 'important', 'met', 'direct', 'Reviews pull requests for the billing team'),
      r('Docker', 'nice', 'met', 'direct', 'Moved four services to Docker Compose'),
      r('RabbitMQ', 'nice', 'missing', 'none', ''),
      r('experience with logistics software', 'nice', 'partial', 'transferable', 'Invoicing for logistics clients at Tessellate'),
    ],
    dimensions: { skills: 5, experience: 4, domain: 4, logistics: 4, compensation: 5, growth: 4 },
    legitimacy: 'ok',
    confidence: 'high',
    verdict: 'Strong chance: Node.js, TypeScript and PostgreSQL are her daily stack, English is fluent, and Kranich hires in South Asia through an employer of record.',
    strengths: ['Node.js and TypeScript in production for two years', 'Set-based SQL and partial indexes on a slow job', 'Invoicing for logistics clients is close to warehouse software', 'Docker Compose'],
    gaps: ['No SAP or DATEV integrations', 'Has not worked at hundreds-of-millions-of-rows scale', 'No RabbitMQ'],
    redFlags: [],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'code reviews', 'automated tests', 'Docker'],
    seniorityFit: 'match',
  },
  'Northwind Labs': {
    postingLevel: 'junior',
    inflatedPosting: false,
    inflationNote: '',
    requirements: [
      r('1+ years of professional experience with Node.js and TypeScript', 'critical', 'met', 'direct', 'Two years on Node.js/TypeScript at Tessellate Labs', { yearsAsked: 1 }),
      r('Solid SQL skills and experience with PostgreSQL or MySQL', 'critical', 'met', 'direct', 'Set-based SQL rewrite took a job from 41 to 6 minutes'),
      r('migrations that run safely on large tables', 'important', 'met', 'direct', 'Schema design and migrations; partial indexes in production'),
      r('clear pull-request descriptions; ask questions early', 'important', 'met', 'direct', 'Reviews pull requests for the billing team'),
      r('Improve our test suite', 'important', 'met', 'direct', 'Raised loader test coverage from 0 to 71% with pytest'),
      r('Remote between UTC-1 and UTC+6', 'critical', 'met', 'direct', 'Lahore, UTC+5'),
      r('NestJS', 'nice', 'partial', 'transferable', 'Fastify and Express APIs, not NestJS'),
      r('Redis or message queues (BullMQ, SQS)', 'nice', 'missing', 'none', ''),
      r('Docker', 'nice', 'met', 'direct', 'Moved four services to Docker Compose'),
      r('designing public APIs and webhooks', 'nice', 'partial', 'transferable', 'REST APIs for invoicing and ledger-lite'),
    ],
    dimensions: { skills: 5, experience: 4, domain: 3, logistics: 5, compensation: 4, growth: 4 },
    legitimacy: 'ok',
    confidence: 'high',
    verdict: 'Strong chance: Node.js, TypeScript and PostgreSQL migrations are her daily work, the time zone fits and Northwind hires through an employer of record.',
    strengths: ['Node.js and TypeScript in production', 'PostgreSQL performance work', 'Writes tests and reviews pull requests', 'Fastify and Express REST APIs'],
    gaps: ['No NestJS', 'No Redis or queue experience'],
    redFlags: [],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'migrations', 'test suite', 'Docker', 'pull-request'],
    seniorityFit: 'match',
  },
  'Orchard Robotics': {
    postingLevel: 'junior',
    inflatedPosting: false,
    inflationNote: '',
    requirements: [
      r('1-2 years of professional experience with React and TypeScript', 'critical', 'met', 'direct', 'React (TypeScript) admin screens at Tessellate Labs', { yearsAsked: 1 }),
      r('Experience building REST APIs in Node.js', 'critical', 'met', 'direct', 'Node.js invoicing service; Fastify API in ledger-lite'),
      r('Working knowledge of SQL', 'critical', 'met', 'direct', 'Set-based SQL rewrite, 41 to 6 minutes'),
      r('Node.js (Fastify) API and PostgreSQL schema', 'important', 'met', 'direct', 'ledger-lite is Fastify on PostgreSQL'),
      r('Write tests, review pull requests', 'important', 'met', 'direct', 'Reviews pull requests for the billing team'),
      r('Leaflet, Mapbox or another web mapping library', 'nice', 'met', 'direct', 'Bus Tracker Lahore: React + Leaflet map'),
      r('PostGIS or time-series data', 'nice', 'missing', 'none', ''),
      r('hardware or IoT tinkering', 'nice', 'missing', 'none', ''),
      r('core team hours 10:00-16:00 UTC', 'important', 'met', 'direct', 'Lahore (UTC+5): 15:00-21:00 local'),
    ],
    dimensions: { skills: 5, experience: 4, domain: 3, logistics: 5, compensation: 5, growth: 4 },
    legitimacy: 'ok',
    confidence: 'high',
    verdict: 'Strong chance: React, TypeScript and a Fastify/PostgreSQL API are exactly her stack, and her Leaflet bus map covers the mapping bonus.',
    strengths: ['React and TypeScript in production', 'Fastify and PostgreSQL in ledger-lite', 'Leaflet map used by about 300 people a month', 'Reviews pull requests'],
    gaps: ['No PostGIS or time-series work', 'No hardware or IoT experience'],
    redFlags: [],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['React', 'TypeScript', 'Node.js', 'Fastify', 'PostgreSQL', 'SQL', 'Leaflet', 'review pull requests'],
    seniorityFit: 'match',
  },
  Quillstack: {
    postingLevel: 'junior',
    inflatedPosting: false,
    inflationNote: '',
    requirements: [
      r('Up to 2 years of professional experience with TypeScript and React', 'critical', 'met', 'direct', 'React (TypeScript) admin screens at Tessellate Labs', { yearsAsked: 2 }),
      r('Some backend experience with Node.js', 'critical', 'met', 'direct', 'Built the Node.js invoicing service'),
      r('Comfortable with Git and pull-request workflows', 'important', 'met', 'direct', 'Reviews pull requests for the billing team'),
      r('Ship features in the React editor and its collaboration layer', 'important', 'partial', 'transferable', 'React admin screens; no editor work'),
      r('Node.js services that render Markdown and MDX', 'important', 'partial', 'transferable', 'Node.js services, but not rendering pipelines'),
      r('Write tests and take part in code review', 'important', 'met', 'direct', 'Raised loader test coverage from 0 to 71%'),
      r('ProseMirror, CRDTs or real-time collaboration', 'nice', 'missing', 'none', ''),
      r('An interest in technical writing', 'nice', 'met', 'direct', 'Wrote the on-call runbook; portfolio write-ups'),
      r('four hours of overlap with 08:00-16:00 UTC', 'important', 'met', 'direct', 'Lahore (UTC+5) overlaps fully'),
    ],
    dimensions: { skills: 4, experience: 4, domain: 3, logistics: 5, compensation: 5, growth: 4 },
    legitimacy: 'ok',
    confidence: 'high',
    verdict: 'Good chance: TypeScript, React and Node.js are all in her work history; the editor and collaboration layer would be new to her.',
    strengths: ['TypeScript, React and Node.js in production', 'Writes things down: runbook and portfolio write-ups', 'Pull-request reviews', 'Mentored interns'],
    gaps: ['No rich-text editor or ProseMirror experience', 'No CRDT or real-time collaboration work'],
    redFlags: [],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['TypeScript', 'React', 'Node.js', 'code review', 'pull-request workflows', 'technical writing', 'write tests'],
    seniorityFit: 'match',
  },
  'Copperline Payments': {
    postingLevel: 'junior',
    inflatedPosting: false,
    inflationNote: '',
    requirements: [
      r('1-2 years of professional software engineering experience', 'critical', 'met', 'direct', 'Two years at Tessellate Labs since Jul 2023', { yearsAsked: 1 }),
      r('Node.js and TypeScript', 'critical', 'met', 'direct', 'Built the Node.js/TypeScript invoicing service'),
      r('Solid SQL and an understanding of database transactions', 'critical', 'met', 'direct', 'ledger-lite: deferred constraint checks balance per transaction'),
      r('idempotent, well-tested code for money movement', 'important', 'partial', 'transferable', 'Invoicing about 9,000 invoices a month; not payouts'),
      r('internal React tools for operations', 'important', 'met', 'direct', 'React admin screens for refunds and credit notes'),
      r('code review and blameless incident reviews', 'important', 'met', 'direct', 'Reviews billing team pull requests; weekly risk review'),
      r('Experience with payments, ledgers or financial data', 'nice', 'met', 'direct', 'Invoicing service and ledger-lite'),
      r('Go', 'nice', 'partial', 'learning', 'currently learning'),
      r('Docker', 'nice', 'met', 'direct', 'Moved four services to Docker Compose'),
      r('AWS', 'nice', 'missing', 'none', ''),
    ],
    dimensions: { skills: 5, experience: 4, domain: 5, logistics: 5, compensation: 5, growth: 4 },
    legitimacy: 'ok',
    confidence: 'high',
    verdict: 'Very strong chance: billing and ledger work in Node.js and PostgreSQL is a direct match for the Payouts team, and the time zone fits.',
    strengths: ['Invoicing service issuing about 9,000 invoices a month', 'ledger-lite enforces balanced entries in Postgres', 'React refund and credit-note tools', 'Set-based SQL performance work'],
    gaps: ['Has not built payouts or bank-return handling', 'Go is still being learned', 'No AWS'],
    redFlags: [],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['Node.js', 'TypeScript', 'PostgreSQL', 'SQL', 'database transactions', 'React', 'code review', 'ledgers'],
    seniorityFit: 'match',
  },
  'Harbor & Pine': {
    postingLevel: 'entry',
    inflatedPosting: true,
    inflationNote: 'Called entry level, yet asks 5+ years, 3+ years of production Kubernetes and cross-team leadership.',
    requirements: [
      r('5+ years of professional software engineering experience', 'important', 'missing', 'none', '', { yearsAsked: 5 }),
      r('3+ years operating Kubernetes in production', 'important', 'partial', 'learning', 'currently learning', { yearsAsked: 3 }),
      r('Go and TypeScript services', 'important', 'partial', 'transferable', 'TypeScript services in production; Go only being learned'),
      r('Deep experience with Kafka or a comparable streaming system', 'important', 'missing', 'none', ''),
      r('24/7 on-call rotation from your first month', 'important', 'partial', 'transferable', 'Wrote the runbook the on-call rotation uses'),
      r('A track record of leading projects across multiple teams', 'important', 'missing', 'none', ''),
      r('BS in Computer Science or equivalent', 'important', 'met', 'direct', 'BS Computer Science, Lahore Institute of Computing'),
      r('at least four hours of overlap with US Pacific time', 'critical', 'partial', 'transferable', 'Remote from Lahore; overlap means late nights'),
      r('Terraform, AWS and Datadog', 'nice', 'missing', 'none', ''),
      r('Experience in payments or marketplaces', 'nice', 'partial', 'transferable', 'Invoicing service; not marketplace payments'),
    ],
    dimensions: { skills: 2, experience: 1, domain: 3, logistics: 2, compensation: 5, growth: 5 },
    legitimacy: 'ok',
    confidence: 'high',
    verdict: 'Long shot: the entry-level label is real but the work described is senior platform ownership, and US Pacific overlap is hard from Lahore.',
    strengths: ['TypeScript services in production', 'Docker Compose migration and on-call runbook', 'Kubernetes and Go on her learning list', 'CS degree'],
    gaps: ['Kubernetes only on kind, never in production', 'No Kafka or event streaming', 'Has not led cross-team work', 'Two years of experience, not five'],
    redFlags: ['Entry-level title with senior responsibilities and 24/7 on-call from month one'],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['TypeScript', 'on-call', 'Docker', 'payments', 'reliability'],
    seniorityFit: 'under',
  },
  'Pebble Analytics': {
    postingLevel: 'junior',
    inflatedPosting: false,
    inflationNote: '',
    requirements: [
      r('Junior software development experience', 'important', 'met', 'direct', 'Two years as a junior engineer at Tessellate Labs', { evidence: 'inferred' }),
      r('Full-time remote work', 'important', 'met', 'direct', 'Remote only, based in Lahore', { evidence: 'inferred' }),
    ],
    dimensions: { skills: 3, experience: 4, domain: 3, logistics: 4, compensation: 4, growth: 3 },
    legitimacy: 'ok',
    confidence: 'low',
    verdict: 'Fair chance, but the posting names no stack or requirements, so this rests on her general junior profile; read the full ad before applying.',
    strengths: ['Two years of production web work', 'Salary range above her floor'],
    gaps: ['The posting does not say what stack or skills they need'],
    redFlags: ['Posting text has no description of the role'],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: [],
    seniorityFit: 'match',
  },
  'Saffron Studio': {
    postingLevel: 'junior',
    inflatedPosting: false,
    inflationNote: '',
    requirements: [
      r('Up to 2 years of professional experience with JavaScript or TypeScript', 'critical', 'met', 'direct', 'Two years of TypeScript at Tessellate Labs', { yearsAsked: 2 }),
      r('Experience with React', 'critical', 'met', 'direct', 'React (TypeScript) admin screens'),
      r('building REST APIs in Node.js', 'critical', 'met', 'direct', 'Node.js invoicing service; Fastify in ledger-lite'),
      r('Basic SQL', 'critical', 'met', 'direct', 'Set-based SQL rewrite, 41 to 6 minutes'),
      r('Model menus, orders and loyalty points in PostgreSQL', 'important', 'met', 'direct', 'Designs PostgreSQL schemas for invoicing'),
      r('Remote within CET +/- 4 hours', 'critical', 'met', 'direct', 'Lahore is CET+4 in winter'),
      r('Next.js', 'nice', 'missing', 'none', ''),
      r('Prisma or Stripe integrations', 'nice', 'missing', 'none', ''),
      r('mobile (React Native)', 'nice', 'partial', 'transferable', 'Final-year project: React Native attendance app'),
    ],
    dimensions: { skills: 5, experience: 4, domain: 3, logistics: 4, compensation: 3, growth: 4 },
    legitimacy: 'ok',
    confidence: 'high',
    verdict: 'Strong chance: React, Node.js REST APIs and PostgreSQL cover every must-have; Next.js would be new, and Lahore is at the edge of the CET window.',
    strengths: ['React and Node.js in production', 'PostgreSQL schema design', 'React Native final-year project', 'Ships small changes often'],
    gaps: ['No Next.js', 'No Prisma or Stripe', 'Contractor pay outside Sweden is not stated'],
    redFlags: [],
    applyChannel: 'ats',
    applyEmail: '',
    atsKeywords: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'SQL', 'write tests', 'review code'],
    seniorityFit: 'match',
  },
};

/** Widget Works pages are test employers that reuse the generic posting. */
function assessmentFor(company: string): Assessment | null {
  if (ASSESSMENTS[company]) return ASSESSMENTS[company];
  if (/^Widget Works\b/.test(company)) {
    return {
      ...generic(company),
      verdict: 'Strong chance: TypeScript, Node.js and PostgreSQL are her daily stack and the time zone fits; the company itself says little about the team.',
    };
  }
  return null;
}

export function matchAnswer(req: DumpedRequest): Answer {
  const text = contentText(req);
  const postings = [...text.matchAll(/<job_posting id="([^"]+)">\nTitle: ([^\n]*)\nCompany: ([^\n]*)\n/g)].map((m) => ({ key: m[1], title: m[2], company: m[3] }));
  if (!postings.length) return { skip: 'match: no postings found in the prompt' };
  const results = [];
  for (const p of postings) {
    const a = assessmentFor(p.company);
    if (!a) return { skip: `match: no assessment for ${p.company} (${p.title})` };
    results.push({ id: p.key, ...a });
  }
  return { label: `batch: ${postings.map((p) => p.company).join(', ')}`, body: { output: { results } } };
}
