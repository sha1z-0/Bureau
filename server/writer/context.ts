import { fence } from '../ai/prompts.ts';
import type { LearningItem, MasterProfile } from '../contracts/profile.ts';
import { MatchResultSchema, type MatchResult } from '../contracts/match.ts';
import type { ResearchBrief } from '../contracts/research.ts';
import { get, logEvent } from '../db.ts';
import { AppError } from '../errors.ts';
import { factsForPrompt, invalidateMasterProfile, loadMasterProfile } from '../profile/index.ts';
import { syncCvFacts } from '../profile/cv.ts';
import { researchForJob } from '../research/index.ts';
import { clip } from '../profile/text.ts';
import { loadProfile } from '../services/profileStore.ts';
import type { TruthSource } from './truth.ts';

/**
 * Everything one application is written from: the job, the matcher's
 * requirements, the master profile (the only source of truth) and the company
 * research. Also renders the stable prompt blocks every writer task shares, so
 * the profile block rides the prompt cache across tasks.
 */

export interface WriterJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  description_text: string | null;
  apply_email: string | null;
  apply_url_canonical: string | null;
  ats: string | null;
}

export interface WriterContext {
  job: WriterJob;
  match: MatchResult | null;
  master: MasterProfile;
  brief: ResearchBrief | null;
  /** Learning-list items with status `learning`: the only ones a CV or letter may present as learning. */
  learning: LearningItem[];
  source: TruthSource;
}

export interface ContextOptions {
  /** Supply the research instead of calling researchForJob (tests, regenerate with a cached brief). */
  brief?: ResearchBrief | null;
  research?: (jobId: string) => Promise<ResearchBrief>;
}

export function loadJob(jobId: string): WriterJob {
  const job = get<WriterJob>(
    'SELECT id, title, company, location, url, description_text, apply_email, apply_url_canonical, ats FROM jobs WHERE id = ?',
    jobId,
  );
  if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
  return job;
}

export function loadMatch(jobId: string): MatchResult | null {
  const row = get<{ match: string | null }>('SELECT match FROM jobs WHERE id = ?', jobId);
  if (!row?.match) return null;
  try {
    const parsed = MatchResultSchema.safeParse(JSON.parse(row.match));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The master profile, with CV facts synced first if this profile predates the fact store. */
export function loadSourceProfile(): MasterProfile {
  let master = loadMasterProfile();
  if (!master) throw new AppError(412, 'NO_PROFILE', 'Upload your CV in Profile before Bureau can write applications.');
  if (!master.facts.length) {
    const profile = loadProfile();
    if (profile) syncCvFacts(profile);
    invalidateMasterProfile();
    master = loadMasterProfile()!;
  }
  return master;
}

export function briefText(brief: ResearchBrief | null): string {
  if (!brief) return '';
  return [
    brief.whatTheyBuild,
    ...brief.products.map((p) => p.text),
    ...brief.recent.map((p) => p.text),
    ...brief.techSignals.map((p) => p.text),
    ...brief.values.map((p) => p.text),
  ].join('\n');
}

export function briefUrls(brief: ResearchBrief | null): Set<string> {
  if (!brief) return new Set();
  return new Set([...brief.products, ...brief.recent, ...brief.techSignals, ...brief.values].map((c) => c.sourceUrl));
}

export async function loadContext(jobId: string, opts: ContextOptions = {}): Promise<WriterContext> {
  const job = loadJob(jobId);
  const master = loadSourceProfile();
  const match = loadMatch(jobId);
  let brief: ResearchBrief | null = opts.brief ?? null;
  if (opts.brief === undefined) {
    try {
      brief = await (opts.research ?? researchForJob)(jobId);
    } catch (err) {
      // Research makes letters better; its absence is not a reason to skip. The hook strategy falls back to the posting.
      logEvent('writer', `Research unavailable for ${job.company}: ${(err as Error).message}`, jobId);
      brief = null;
    }
  }
  const learning = master.learning.filter((l) => l.status === 'learning');
  const source: TruthSource = {
    profile: master,
    facts: master.facts,
    learning: master.learning,
    targetCompany: job.company,
    employerText: `${job.title}\n${job.company}\n${job.description_text ?? ''}\n${briefText(brief)}`,
    // The role's own title ("Happiness Engineer") names the job applied for, not a claim; tools in it stay watched
    // through the lexicon.
    watchTerms: (match?.atsKeywords ?? []).filter((t) => !job.title.toLowerCase().includes(t.toLowerCase())),
  };
  return { job, match, master, brief, learning, source };
}

// ── Prompt blocks ────────────────────────────────────────────────────────────

/** The candidate: identity, verbatim history, every active fact with its id, and the learning list. Stable per profile. */
export function profileBlock(m: MasterProfile): string {
  const lines = [
    '# The candidate (the only source of truth)',
    `Name: ${m.name}`,
    `Location: ${m.location}`,
    `Email: ${m.email} | Phone: ${m.phone}`,
    `Links: ${[m.links.github, m.links.portfolio, m.links.linkedin, ...m.links.socials.map((s) => s.url)].filter(Boolean).join(' · ')}`,
    `Years of experience: ${m.yearsExperience} | Seniority: ${m.seniority}`,
    '',
    '## Employment history (copy employer, title, location and dates exactly)',
    ...m.experience.map((e) => `- ${e.role} | ${e.company} | ${e.location} | ${e.start} – ${e.end}`),
    '',
    '## Education (copy exactly)',
    ...m.education.map((e) => `- ${e.degree} | ${e.school} | ${e.start} – ${e.end}${e.details ? ` | ${e.details}` : ''}`),
    '',
    `## Certifications: ${m.certifications.join('; ') || 'none'}`,
    '',
    '## Profile facts (cite these ids)',
    factsForPrompt(m.facts),
    '',
    '## Learning list (may appear only as learning, never as experience)',
    ...(m.learning.filter((l) => l.status === 'learning').map((l) => `- [${l.id}] ${l.skill}${l.notes ? ` (${l.notes})` : ''}`) || []),
  ];
  if (!m.learning.some((l) => l.status === 'learning')) lines.push('- (empty)');
  return lines.join('\n');
}

/** The voice bank and the fingerprint the lint measures letters against. */
export function voiceBlock(m: MasterProfile): string {
  const fp = m.style;
  const lines = ['# Voice bank (the candidate\'s own words; build letters by editing these)'];
  for (const p of m.voiceBank) lines.push('', `[${p.id}] Prompt: ${p.prompt}`, p.text.trim());
  if (fp) {
    lines.push(
      '',
      `Style fingerprint: mean sentence length ${fp.sentenceLenMean} words (SD ${fp.sentenceLenStd}); type-token ratio ${fp.typeTokenRatio}; contractions ${(fp.contractionRate * 100).toFixed(1)} per 100 words; first person ${(fp.firstPersonRate * 100).toFixed(1)} per 100 words; favourite connectives: ${fp.connectives.join(', ') || 'none'}.`,
    );
  }
  return lines.join('\n');
}

/** The posting, the matcher's requirements and the research, all fenced (third-party text). */
export function jobBlock(ctx: WriterContext): string {
  const { job, match, brief } = ctx;
  const parts = [
    // No database id here: it is a random UUID, which would change the prompt (and its replay key) every run.
    '<job_posting>',
    `Title: ${fence(job.title)}`,
    `Company: ${fence(job.company)}`,
    `Location: ${fence(job.location ?? '')}`,
    `URL: ${job.url}`,
    '',
    fence(clip(job.description_text ?? '', 12_000)),
    '</job_posting>',
  ];
  if (match) {
    parts.push('', '<matcher_assessment>');
    parts.push(`Chance of passing the screen: ${match.screenPassScore}/100 (${match.grade}).${match.inflatedPosting ? ' The posting over-asks for its level.' : ''}`);
    for (const r of match.requirements) {
      parts.push(`- [${r.importance}] ${fence(r.text)} | match: ${r.match} | cover: ${r.proofKind ?? (r.match === 'missing' ? 'none' : 'direct')}${r.proof ? ` | proof: ${fence(r.proof)}` : ''}`);
    }
    if (match.atsKeywords.length) parts.push(`Posting keywords (mirror only where true): ${match.atsKeywords.map(fence).join(', ')}`);
    parts.push('</matcher_assessment>');
  }
  if (brief) {
    parts.push('', `<research company="${fence(brief.company)}">`, `What they build: ${fence(brief.whatTheyBuild)}`);
    const list = (label: string, items: { text: string; sourceUrl: string; date?: string | null }[]) => {
      if (!items.length) return;
      parts.push(`${label}:`);
      for (const c of items) parts.push(`- ${fence(c.text)}${c.date ? ` (${c.date})` : ''} [source: ${c.sourceUrl}]`);
    };
    list('Products', brief.products);
    list('Recent', brief.recent);
    list('Engineering signals', brief.techSignals);
    list('Values (their words)', brief.values);
    parts.push(`Stage: ${fence(brief.stage)} | Team size: ${fence(brief.teamSize)}`);
    if (brief.hiringContact) parts.push(`Hiring contact named publicly: ${fence(brief.hiringContact.name)}, ${fence(brief.hiringContact.role)}`);
    parts.push('</research>');
  } else {
    parts.push('', '<research>No company research is available. Hooks must come from the posting itself.</research>');
  }
  return parts.join('\n');
}
