import { get, now as nowIso, run } from '../db.ts';
import { emailInText } from '../ai/prompts.ts';
import { MatchResultSchema, type MatchResult, type StretchLevel } from '../contracts/match.ts';
import type { MatchJob } from './jobs.ts';
import { MATCH_VERSION } from './rubric.ts';
import { v1Decision, type JobMatchAssessment, type NormalisedRequirement, type PostingLevel, type ScoreBreakdown } from './scoring.ts';
import type { FilterCode } from './filters.ts';

/**
 * What lands in `jobs.match`: the MatchResult contract plus the working the UI
 * and the writer use (requirement framing, the score breakdown). Readers that
 * only want the contract parse it with MatchResultSchema, which drops the rest.
 * The v1 columns (ai_score, ai_grade, ai_analysis) are kept filled too.
 */

export interface MatchExplain {
  version: number;
  asOf: string;
  campaignId: string | null;
  stretchLevel: StretchLevel;
  minScore: number | null;
  prefilter: number;
  similarity: number | null;
  embedModel: string | null;
  preRank: number;
  postingLevel: PostingLevel | null;
  inflationNote: string;
  confidence: 'high' | 'medium' | 'low' | null;
  redFlags: string[];
  applyChannel: string | null;
  seniorityFit: string | null;
  task: string | null;
  breakdown: ScoreBreakdown | null;
  filter: { code: FilterCode; reason: string } | null;
}

export type StoredRequirement = MatchResult['requirements'][number] & Partial<Pick<NormalisedRequirement, 'blockerKind' | 'proofKind' | 'adjusted'>>;
export type StoredMatch = Omit<MatchResult, 'requirements'> & { requirements: StoredRequirement[]; explain: MatchExplain };

export function readMatch(jobId: string): StoredMatch | null {
  const row = get<{ match: string | null }>('SELECT match FROM jobs WHERE id = ?', jobId);
  if (!row?.match) return null;
  try {
    const parsed = JSON.parse(row.match) as StoredMatch;
    return MatchResultSchema.safeParse(parsed).success ? parsed : null;
  } catch {
    return null;
  }
}

/** The contract view of a stored match (extra working stripped). */
export function contractView(m: StoredMatch): MatchResult {
  return MatchResultSchema.parse(m);
}

/** The v1 `ai_analysis` shape, so the existing Jobs page keeps rendering. */
export function v1Analysis(m: StoredMatch, a: JobMatchAssessment) {
  const legit = m.legitimacy === 'ok' ? 'high' : m.legitimacy === 'suspect' ? 'medium' : 'low';
  return {
    id: m.jobId,
    requirements: m.requirements.map((r) => ({ text: r.text, importance: r.importance, evidence: r.evidence, match: r.match, proof: r.proof })),
    dimensions: m.dimensions,
    legitimacy: legit,
    confidence: a.confidence,
    verdict: m.verdict,
    strengths: m.strengths,
    gaps: m.gaps,
    redFlags: a.redFlags.slice(0, 4),
    applyChannel: a.applyChannel,
    applyEmail: a.applyEmail,
    atsKeywords: m.atsKeywords,
    seniorityFit: a.seniorityFit,
    breakdown: {
      requirements: Math.round(m.explain.breakdown?.requirements ?? 0),
      dimensions: Math.round(m.explain.breakdown?.dimensions ?? 0),
      prefilter: Math.round(m.explain.preRank),
    },
    decision: v1Decision(m.screenPassScore, m.stretch.blockers.length > 0),
    // v2 extras the new UI can read without parsing jobs.match.
    screenPassScore: m.screenPassScore,
    scoreMeaning: 'chance of passing the screen',
    inflatedPosting: m.inflatedPosting,
    stretch: m.stretch,
  };
}

/** Persist an assessed match to jobs.match and the v1 columns. */
export function saveAssessed(job: MatchJob, m: StoredMatch, a: JobMatchAssessment) {
  const ts = nowIso();
  run(
    `UPDATE jobs SET match = ?, ai_score = ?, ai_grade = ?, ai_analysis = ?, scored_at = ?, updated_at = ?,
       apply_email = COALESCE(NULLIF(?, ''), apply_email) WHERE id = ?`,
    JSON.stringify(m),
    m.screenPassScore,
    m.grade === 'F' ? 'D' : m.grade,
    JSON.stringify(v1Analysis(m, a)),
    ts,
    ts,
    emailInText(a.applyEmail, `${job.title}\n${job.descriptionText}`) ?? '',
    job.id,
  );
}

/** Record a hard-filter rejection, keeping any earlier assessment's working. */
export function saveRejected(job: MatchJob, m: StoredMatch) {
  run('UPDATE jobs SET match = ?, updated_at = ? WHERE id = ?', JSON.stringify(m), nowIso(), job.id);
}

/** Update only the decision on a stored match (selection, cooldown skips). */
export function setDecision(jobId: string, decision: MatchResult['decision'], reason: string) {
  const m = readMatch(jobId);
  if (!m) return;
  m.decision = decision;
  m.reason = reason;
  run('UPDATE jobs SET match = ?, updated_at = ? WHERE id = ?', JSON.stringify(m), nowIso(), jobId);
}

export function rejectedMatch(
  job: MatchJob,
  filter: { code: FilterCode; reason: string },
  ctx: { asOf: string; campaignId: string | null; stretchLevel: StretchLevel; minScore: number | null },
  previous: StoredMatch | null,
): StoredMatch {
  const reason = `filter: ${filter.reason}`;
  if (previous && previous.requirements.length) {
    return { ...previous, decision: 'skipped', reason, explain: { ...previous.explain, filter, asOf: ctx.asOf } };
  }
  return {
    jobId: job.id,
    screenPassScore: 0,
    grade: 'F',
    requirements: [],
    dimensions: {},
    legitimacy: job.legitimacy ?? 'ok',
    verdict: `Not assessed: ${filter.reason}.`,
    strengths: [],
    gaps: [],
    atsKeywords: [],
    stretch: { unmetImportant: 0, blockers: [] },
    inflatedPosting: false,
    decision: 'skipped',
    reason,
    explain: {
      version: MATCH_VERSION,
      asOf: ctx.asOf,
      campaignId: ctx.campaignId,
      stretchLevel: ctx.stretchLevel,
      minScore: ctx.minScore,
      prefilter: job.prefilterScore,
      similarity: null,
      embedModel: null,
      preRank: 0,
      postingLevel: null,
      inflationNote: '',
      confidence: null,
      redFlags: [],
      applyChannel: null,
      seniorityFit: null,
      task: null,
      breakdown: null,
      filter,
    },
  };
}
