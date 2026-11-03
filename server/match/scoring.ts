import { z } from 'zod/v4';
import type { Legitimacy } from '../contracts/job.ts';
import { Importance, RequirementMatch, STRETCH_ALLOWANCE, type Requirement, type StretchLevel } from '../contracts/match.ts';

/**
 * Deterministic scoring. Claude supplies structured judgements; this file turns
 * them into `screenPassScore`, the chance of passing the screen (0–100). No
 * clocks, no randomness: pass the same inputs (including `now`) and you get the
 * same number, byte for byte.
 */

// ── What Claude returns per job ──────────────────────────────────────────────

export const BlockerKind = z.enum(['none', 'licence', 'clearance', 'citizenship', 'degree', 'years', 'other']);
export type BlockerKind = z.infer<typeof BlockerKind>;
export const ProofKind = z.enum(['direct', 'transferable', 'learning', 'none']);
export type ProofKind = z.infer<typeof ProofKind>;
export const PostingLevel = z.enum(['intern', 'entry', 'junior', 'mid', 'senior', 'lead', 'unknown']);
export type PostingLevel = z.infer<typeof PostingLevel>;

export const AssessedRequirementSchema = z.object({
  // Pass 1: the posting alone.
  text: z.string(),
  importance: Importance,
  evidence: z.enum(['stated', 'inferred']),
  blocker: z.boolean(),
  blockerKind: BlockerKind,
  yearsAsked: z.number(),
  // Pass 2: against the candidate.
  match: RequirementMatch,
  proofKind: ProofKind,
  proof: z.string(),
});
export type AssessedRequirement = z.infer<typeof AssessedRequirementSchema>;

export const DimensionsSchema = z.object({
  skills: z.number(),
  experience: z.number(),
  domain: z.number(),
  logistics: z.number(),
  compensation: z.number(),
  growth: z.number(),
});
export type Dimensions = z.infer<typeof DimensionsSchema>;

export const JobMatchAssessmentSchema = z.object({
  id: z.string(),
  postingLevel: PostingLevel,
  inflatedPosting: z.boolean(),
  inflationNote: z.string(),
  requirements: z.array(AssessedRequirementSchema),
  dimensions: DimensionsSchema,
  legitimacy: z.enum(['ok', 'suspect', 'ghost', 'scam']),
  confidence: z.enum(['high', 'medium', 'low']),
  verdict: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  redFlags: z.array(z.string()),
  applyChannel: z.enum(['email', 'ats', 'dm', 'unknown']),
  applyEmail: z.string(),
  atsKeywords: z.array(z.string()),
  seniorityFit: z.enum(['under', 'match', 'over', 'unknown']),
});
export type JobMatchAssessment = z.infer<typeof JobMatchAssessmentSchema>;

export const MatchBatchSchema = z.object({ results: z.array(JobMatchAssessmentSchema) });

// ── Normalisation: the rubric's rules, enforced in code ──────────────────────

/** A requirement after code-side checks. `blocker` here means "a true gate", met or not. */
export interface NormalisedRequirement extends Requirement {
  blockerKind: BlockerKind;
  proofKind: ProofKind;
  /** What code changed and why, for the breakdown. Empty when the model's call stood. */
  adjusted: string;
}

export const MAX_REQUIREMENTS = 12;
const ENTRYISH: PostingLevel[] = ['intern', 'entry', 'junior'];

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim();
}

/** True when a learning-list skill is named in the requirement (all its words, as whole words). */
export function mentionsSkill(requirement: string, skill: string): boolean {
  const words = norm(skill).split(' ').filter(Boolean);
  if (!words.length) return false;
  const hay = ` ${norm(requirement)} `;
  return words.every((w) => hay.includes(` ${w} `));
}

/**
 * Years are a blocker only when they are far out of reach for a role that is
 * not entry-level: more than 2× the candidate's years and at least 3 years more.
 */
export function yearsOutOfReach(yearsAsked: number, candidateYears: number, level: PostingLevel, inflated: boolean): boolean {
  if (inflated || ENTRYISH.includes(level)) return false;
  if (!(yearsAsked > 0)) return false;
  const have = Math.max(0, candidateYears);
  return yearsAsked > 2 * have && yearsAsked - have >= 3;
}

export function normaliseRequirements(
  a: Pick<JobMatchAssessment, 'requirements' | 'postingLevel' | 'inflatedPosting'>,
  ctx: { learning: string[]; yearsExperience: number },
): NormalisedRequirement[] {
  return a.requirements.slice(0, MAX_REQUIREMENTS).map((r) => {
    const notes: string[] = [];
    let { match, proof, proofKind, importance, blocker, blockerKind } = r;
    proof = proof.trim();

    // Never mark an inferred requirement critical.
    if (importance === 'critical' && r.evidence === 'inferred') {
      importance = 'important';
      notes.push('inferred, so not critical');
    }

    // Blockers: only critical, stated, hard gates. Years follow the 2× rule in code.
    if (blocker && (importance !== 'critical' || r.evidence !== 'stated' || blockerKind === 'none')) {
      blocker = false;
      notes.push('not a hard gate');
    }
    if (blockerKind === 'years' && importance === 'critical' && r.evidence === 'stated') {
      const out = yearsOutOfReach(r.yearsAsked, ctx.yearsExperience, a.postingLevel, a.inflatedPosting);
      if (blocker !== out) notes.push(out ? `${r.yearsAsked} years is far out of reach` : 'years within stretch range');
      blocker = out;
    }
    if (!blocker) blockerKind = 'none';

    // Truth: no proof, no credit. Transferable evidence is partial, never met.
    if (match !== 'missing' && !proof) {
      match = 'missing';
      proofKind = 'none';
      notes.push('no proof given');
    }
    if (proofKind === 'transferable' && match === 'met') {
      match = 'partial';
      notes.push('transferable counts as partial');
    }
    const learningSkill = ctx.learning.find((s) => mentionsSkill(r.text, s));
    if (proofKind === 'learning' && !learningSkill) {
      match = 'missing';
      proofKind = 'none';
      proof = '';
      notes.push('not on the learning list');
    }
    // Learning-list skills count as partial with the proof "currently learning". Gates can't be learned.
    if (learningSkill && match === 'missing' && !blocker) {
      match = 'partial';
      proofKind = 'learning';
      proof = 'currently learning';
      notes.push(`on the learning list (${learningSkill})`);
    }
    if (match === 'missing') {
      proofKind = 'none';
      proof = '';
    }
    return { text: r.text, importance, evidence: r.evidence, match, proof, blocker, blockerKind, proofKind, adjusted: notes.join('; ') };
  });
}

// ── The score ────────────────────────────────────────────────────────────────

/** Share of the requirement mass per importance group (renormalised over the groups present). */
export const GROUP_WEIGHTS = { critical: 0.5, important: 0.35, nice: 0.15 } as const;
export const MATCH_CREDIT = { met: 1, partial: 0.6, missing: 0 } as const;
export const DIMENSION_WEIGHTS: Record<keyof Dimensions, number> = {
  skills: 0.3,
  experience: 0.2,
  domain: 0.15,
  logistics: 0.15,
  compensation: 0.1,
  growth: 0.1,
};
/** How the base score blends its three parts. */
export const BLEND = { requirements: 0.55, dimensions: 0.3, preRank: 0.15 } as const;
export const BLOCKER_CAP = 35;
export const LOGISTICS_CAP = 40;
export const FRESH_HOURS = 48;
export const FRESH_BOOST = 5;
export const SIGNAL_BOOST = 3;
/** Penalty by number of unmet requirements beyond the stretch allowance; +15 for each one past the table. */
export const STRETCH_STEPS = [0, 6, 14, 24, 36, 50] as const;

export function stretchPenalty(excess: number): number {
  if (excess <= 0) return 0;
  if (excess < STRETCH_STEPS.length) return STRETCH_STEPS[excess];
  return STRETCH_STEPS[STRETCH_STEPS.length - 1] + 15 * (excess - STRETCH_STEPS.length + 1);
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export function gradeFor(score: number): Grade {
  return score >= 88 ? 'S' : score >= 78 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
}

export interface ScoreInput {
  requirements: NormalisedRequirement[];
  dimensions: Dimensions;
  /** Worst of the scout's flag and the model's judgement. */
  legitimacy: Legitimacy;
  /** 0–100: similarity plus the cheap prefilter. */
  preRank: number;
  stretchLevel: StretchLevel;
  postedAt: string | null;
  hiringSignal: boolean;
  /** ISO time the score is computed for (freshness). */
  now: string;
  /** The posting's title and the candidate's level, for the seniority cap. */
  title?: string;
  candidateSeniority?: 'entry' | 'junior' | 'mid' | 'senior' | 'lead';
}

/** A senior title is years away for an entry or junior candidate: a long shot, not a stretch. */
export const SENIORITY_CAP = 45;
/** A critical requirement the candidate simply doesn't meet: just under the usual bar of 60. */
export const CRITICAL_CAP = 55;
const SENIOR_TITLE = /\b(senior|sr\.?|staff|principal|lead|head of|director|architect|middle\+)/i;
/** Being somewhere: an office, a country, a move. Unmet, it rules the job out like any blocker. */
const PRESENCE = /\b(on-?site|in[- ]office|office in|in the \w+ office|hybrid|days? (?:a|per) week|-based|based in|located in|must (?:live|reside|be located)|residen(?:t|cy|ce)|relocat\w*|work permit for|right to work in|authori[sz]ed to work in)/i;

export interface ScoreBreakdown {
  requirements: number;
  dimensions: number;
  preRank: number;
  base: number;
  groups: Record<'critical' | 'important' | 'nice', { count: number; earned: number }>;
  stretch: { level: StretchLevel; allowance: number; unmetImportant: number; unmetCritical: number; excess: number; penalty: number };
  caps: { reason: string; cap: number }[];
  adjustments: { reason: string; points: number }[];
  blockers: string[];
  final: number;
}

export interface ScoreOutput {
  screenPassScore: number;
  grade: Grade;
  breakdown: ScoreBreakdown;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function clampDimensions(d: Dimensions): Dimensions {
  const c = (n: number) => clamp(Math.round(Number.isFinite(n) ? n : 0), 0, 5);
  return { skills: c(d.skills), experience: c(d.experience), domain: c(d.domain), logistics: c(d.logistics), compensation: c(d.compensation), growth: c(d.growth) };
}

export function isFresh(postedAt: string | null, now: string): boolean {
  if (!postedAt) return false;
  const age = Date.parse(now) - Date.parse(postedAt);
  return Number.isFinite(age) && age >= -3_600_000 && age < FRESH_HOURS * 3_600_000;
}

/**
 * screenPassScore =
 *   requirements (critical .5 / important .35 / nice .15 of the mass; met 1, partial .6) × .55
 * + dimensions (skills .3, experience .2, domain .15, logistics .15, compensation .1, growth .1) × .30
 * + pre-rank (embedding similarity + prefilter) × .15
 * − stepped stretch penalty for unmet important/critical requirements beyond the level's allowance
 * then caps (blocker 35, logistics dealbreaker 40, ghost 30, scam 10), suspect −8,
 * then boosts (fresh <48h +5, hiring signal +3), clamped to 0–100 and rounded.
 */
export function scoreMatch(input: ScoreInput): ScoreOutput {
  const groups = {
    critical: { count: 0, earned: 0 },
    important: { count: 0, earned: 0 },
    nice: { count: 0, earned: 0 },
  };
  for (const r of input.requirements) {
    groups[r.importance].count++;
    groups[r.importance].earned += MATCH_CREDIT[r.match];
  }
  let mass = 0;
  let got = 0;
  for (const k of ['critical', 'important', 'nice'] as const) {
    if (!groups[k].count) continue;
    mass += GROUP_WEIGHTS[k];
    got += GROUP_WEIGHTS[k] * (groups[k].earned / groups[k].count);
  }
  const requirements = mass ? (got / mass) * 100 : 50;

  const d = clampDimensions(input.dimensions);
  let dimTotal = 0;
  for (const k of Object.keys(DIMENSION_WEIGHTS) as (keyof Dimensions)[]) dimTotal += DIMENSION_WEIGHTS[k] * d[k];
  const dimensions = (dimTotal / 5) * 100;

  const preRank = clamp(input.preRank, 0, 100);
  const base = requirements * BLEND.requirements + dimensions * BLEND.dimensions + preRank * BLEND.preRank;

  const presence = input.requirements.filter((r) => !r.blocker && r.match === 'missing' && r.importance !== 'nice' && PRESENCE.test(r.text)).map((r) => r.text);
  const blockers = [...input.requirements.filter((r) => r.blocker && r.match !== 'met').map((r) => r.text), ...presence];
  const unmetImportant = input.requirements.filter((r) => r.importance === 'important' && r.match === 'missing').length;
  const unmetCritical = input.requirements.filter((r) => r.importance === 'critical' && !r.blocker && r.match === 'missing' && !presence.includes(r.text)).length;
  const allowance = STRETCH_ALLOWANCE[input.stretchLevel];
  const excess = Math.max(0, unmetImportant + unmetCritical - allowance);
  const penalty = stretchPenalty(excess);

  const adjustments: ScoreBreakdown['adjustments'] = [];
  const caps: ScoreBreakdown['caps'] = [];
  let score = base;
  if (penalty) {
    score -= penalty;
    adjustments.push({ reason: `${excess} unmet requirement(s) beyond the ${input.stretchLevel} stretch allowance of ${allowance}`, points: -penalty });
  }
  if (input.legitimacy === 'suspect') {
    score -= 8;
    adjustments.push({ reason: 'posting looks suspect', points: -8 });
  }
  const capAt = (cap: number, reason: string) => {
    caps.push({ reason, cap });
    score = Math.min(score, cap);
  };
  if (blockers.length) capAt(BLOCKER_CAP, `blocker: ${blockers.join('; ')}`);
  if (unmetCritical) capAt(CRITICAL_CAP, `${unmetCritical} critical requirement(s) not met`);
  if (input.title && (input.candidateSeniority === 'entry' || input.candidateSeniority === 'junior') && SENIOR_TITLE.test(input.title)) {
    capAt(SENIORITY_CAP, `a ${input.title.match(SENIOR_TITLE)![1].toLowerCase()} role for an ${input.candidateSeniority}-level candidate`);
  }
  if (d.logistics === 0) capAt(LOGISTICS_CAP, 'logistics dealbreaker stated in the posting');
  if (input.legitimacy === 'ghost') capAt(30, 'ghost listing');
  if (input.legitimacy === 'scam') capAt(10, 'looks like a scam');

  // Boosts can't lift a capped score past its cap.
  const ceiling = caps.length ? Math.min(...caps.map((c) => c.cap)) : 100;
  if (isFresh(input.postedAt, input.now)) {
    adjustments.push({ reason: `posted within ${FRESH_HOURS} hours`, points: FRESH_BOOST });
    score += FRESH_BOOST;
  }
  if (input.hiringSignal) {
    adjustments.push({ reason: 'company is showing hiring signals', points: SIGNAL_BOOST });
    score += SIGNAL_BOOST;
  }
  score = Math.min(score, ceiling);

  const final = Math.round(clamp(score, 0, 100));
  return {
    screenPassScore: final,
    grade: gradeFor(final),
    breakdown: {
      requirements: round1(requirements),
      dimensions: round1(dimensions),
      preRank: round1(preRank),
      base: round1(base),
      groups: {
        critical: { count: groups.critical.count, earned: round1(groups.critical.earned) },
        important: { count: groups.important.count, earned: round1(groups.important.earned) },
        nice: { count: groups.nice.count, earned: round1(groups.nice.earned) },
      },
      stretch: { level: input.stretchLevel, allowance, unmetImportant, unmetCritical, excess, penalty },
      caps,
      adjustments,
      blockers,
      final,
    },
  };
}

/** Worse of two legitimacy readings. */
export function worseLegitimacy(a: Legitimacy | null | undefined, b: Legitimacy | null | undefined): Legitimacy {
  const order: Legitimacy[] = ['ok', 'suspect', 'ghost', 'scam'];
  return order[Math.max(order.indexOf(a ?? 'ok'), order.indexOf(b ?? 'ok'))];
}

/** v1 decision label for the old UI's score dial. */
export function v1Decision(score: number, blocked: boolean): 'apply' | 'consider' | 'research' | 'skip' {
  if (blocked) return 'skip';
  return score >= 78 ? 'apply' : score >= 65 ? 'consider' : score >= 50 ? 'research' : 'skip';
}
