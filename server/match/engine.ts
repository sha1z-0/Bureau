import type { Task } from '../ai/claude.ts';
import { logEvent, now as nowIso } from '../db.ts';
import { AppError } from '../errors.ts';
import { emit } from '../services/bus.ts';
import { ensurePipeline, pipelineState, transition } from '../campaign/pipeline.ts';
import type { CampaignConfig, PipelineState } from '../contracts/campaign.ts';
import { MatchResultSchema, type MatchResult } from '../contracts/match.ts';
import { assessBatch, buildSystemBlocks, type BatchCall, type StructuredFn } from './assessment.ts';
import { companiesWithSignals, hasHiringSignal } from './companies.ts';
import { buildFilterContext, hardFilter } from './filters.ts';
import { loadJobs, type MatchJob } from './jobs.ts';
import { loadMatchProfile, profileEmbeddingText, type MatchProfile } from './profile.ts';
import { MATCH_VERSION } from './rubric.ts';
import { clampDimensions, isFresh, normaliseRequirements, scoreMatch, worseLegitimacy, type JobMatchAssessment } from './scoring.ts';
import { matchSettings } from './settings.ts';
import { jobSimilarity, preRank as combinePreRank } from './similarity.ts';
import { readMatch, rejectedMatch, saveAssessed, saveRejected, type StoredMatch } from './store.ts';

/**
 * The matcher's pipeline for a set of jobs:
 *   hard filters → similarity pre-rank → Claude assessment (batched, cached) →
 *   deterministic score → persist → move the pipeline (found → filtered →
 *   scored, or skipped with a reason).
 */

export interface MatchOptions {
  /** Campaign the jobs are being matched for; recorded on pipeline rows. */
  campaignId?: string | null;
  /** Inject a profile (tests, or a caller that already has one). Defaults to the master profile, else v1. */
  profile?: MatchProfile;
  /** Clock for freshness and cooldowns. Defaults to now. */
  now?: string;
  /** Override settings.assessPerCycle for this call. */
  assessLimit?: number;
  /** Override settings.batchSize for this call. */
  batchSize?: number;
  /** Claude task to meter under. `match` for campaigns; the v1 scanner uses `score`. */
  task?: Task;
  /** Move jobs through the pipeline (default true). The v1 scanner scores without a pipeline. */
  movePipeline?: boolean;
  /** Skip hard filters and the pre-rank floor (v1 "score these jobs" behaviour). */
  skipFilters?: boolean;
  /** Test seams. */
  structuredFn?: StructuredFn;
  onCall?: (c: BatchCall) => void;
  onProgress?: (assessed: number) => void;
}

export interface MatchRun {
  results: StoredMatch[];
  /** Passed the filters but not assessed this cycle (over the per-cycle limit, or a failed batch). */
  deferred: string[];
  errors: string[];
  calls: number;
}

/** States the matcher may (re)assess from. Anything later belongs to the writer and form engine. */
const MATCHABLE: PipelineState[] = ['found', 'filtered', 'scored'];

function move(jobId: string, to: PipelineState, campaignId: string | null, reason: string, enabled: boolean) {
  if (!enabled) return;
  transition(jobId, to, { campaignId, reason: reason.slice(0, 500) });
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

export async function runMatch(jobIds: string[], cfg: CampaignConfig, opts: MatchOptions = {}): Promise<MatchRun> {
  const profile = opts.profile ?? loadMatchProfile();
  if (!profile) throw new AppError(412, 'NO_PROFILE', 'Upload your CV first: the matcher scores jobs against your profile.');
  const now = opts.now ?? nowIso();
  const settings = matchSettings();
  const pipelineOn = opts.movePipeline ?? true;
  const campaignId = opts.campaignId ?? null;
  const task = opts.task ?? 'match';
  const base = { asOf: now, campaignId, stretchLevel: cfg.stretchLevel, minScore: pipelineOn ? cfg.minScore : null };

  const run: MatchRun = { results: [], deferred: [], errors: [], calls: 0 };
  let jobs = loadJobs(jobIds);

  // Only jobs at found / filtered / scored are the matcher's to move.
  if (pipelineOn) {
    jobs = jobs.filter((j) => {
      const state = pipelineState(j.id)?.state ?? ensurePipeline(j.id, campaignId).state;
      return MATCHABLE.includes(state);
    });
  }

  // 1. Hard filters.
  const passing: MatchJob[] = [];
  if (opts.skipFilters) passing.push(...jobs);
  else {
    const fctx = buildFilterContext(cfg, profile, now, settings.legitimacyFloor);
    for (const j of jobs) {
      const v = hardFilter(j, fctx);
      if (v.pass) {
        passing.push(j);
        continue;
      }
      const m = rejectedMatch(j, { code: v.code!, reason: v.reason! }, base, readMatch(j.id));
      saveRejected(j, m);
      move(j.id, 'skipped', campaignId, m.reason, pipelineOn);
      run.results.push(m);
    }
  }
  for (const j of passing) {
    if (pipelineOn && pipelineState(j.id)?.state === 'found') move(j.id, 'filtered', campaignId, 'passed hard filters', true);
  }

  // 2. Similarity pre-rank. Fresh jobs first, then the strongest pre-rank.
  const sim = passing.length ? await jobSimilarity(passing, profileEmbeddingText(profile, cfg.roles)) : null;
  const ranked = passing
    .map((j) => {
      const similarity = sim?.score.get(j.id) ?? null;
      return { job: j, similarity, preRank: combinePreRank(j.prefilterScore, similarity), fresh: isFresh(j.postedAt, now) };
    })
    .sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.preRank - a.preRank || a.job.id.localeCompare(b.job.id));

  const queue: typeof ranked = [];
  for (const r of ranked) {
    if (!opts.skipFilters && r.preRank < settings.minPreRank) {
      const m = rejectedMatch(r.job, { code: 'weak_match', reason: `weak match before assessment (pre-rank ${r.preRank}, floor ${settings.minPreRank})` }, base, readMatch(r.job.id));
      m.explain.similarity = r.similarity;
      m.explain.preRank = r.preRank;
      m.explain.embedModel = sim?.model ?? null;
      saveRejected(r.job, m);
      move(r.job.id, 'skipped', campaignId, m.reason, pipelineOn);
      run.results.push(m);
      continue;
    }
    queue.push(r);
  }
  const limit = opts.assessLimit ?? settings.assessPerCycle;
  const toAssess = queue.slice(0, limit);
  run.deferred.push(...queue.slice(limit).map((r) => r.job.id));

  // 3. Claude, in batches. The first batch runs alone so the cache is warm for the rest.
  const size = opts.batchSize ?? settings.batchSize;
  const batches: (typeof toAssess)[] = [];
  for (let i = 0; i < toAssess.length; i += size) batches.push(toAssess.slice(i, i + size));
  const system = buildSystemBlocks(profile);
  const signals = companiesWithSignals(now);
  let stop = false;
  let assessed = 0;

  const handle = async (batch: typeof toAssess) => {
    if (stop) {
      run.deferred.push(...batch.map((b) => b.job.id));
      return;
    }
    let out: Map<string, JobMatchAssessment>;
    try {
      run.calls++;
      out = await assessBatch(
        batch.map((b) => b.job),
        system,
        { task, structuredFn: opts.structuredFn, onCall: opts.onCall },
      );
    } catch (err) {
      const msg = (err as Error).message;
      run.errors.push(msg);
      run.deferred.push(...batch.map((b) => b.job.id));
      if (err instanceof AppError && ['BUDGET', 'NO_API_KEY', 'AI_AUTH'].includes(err.code)) stop = true;
      return;
    }
    for (const b of batch) {
      const a = out.get(b.job.id);
      if (!a) {
        run.deferred.push(b.job.id);
        run.errors.push(`no assessment returned for ${b.job.id}`);
        continue;
      }
      const m = finalise(b.job, a, { ...b, profile, cfg, now, campaignId, task, embedModel: sim?.model ?? null, signals, pipelineOn });
      saveAssessed(b.job, m, a);
      if (pipelineOn) {
        move(b.job.id, 'scored', campaignId, `screen-pass ${m.screenPassScore} (${m.grade})`, true);
        if (m.decision === 'skipped') move(b.job.id, 'skipped', campaignId, m.reason, true);
      }
      run.results.push(m);
      assessed++;
    }
    opts.onProgress?.(assessed);
  };

  if (batches.length) {
    await handle(batches[0]);
    await pool(batches.slice(1), settings.concurrency, handle);
  }

  if (batches.length && !assessed && run.errors.length) {
    // Nothing got through: surface the outage (budget, key, network) to the caller.
    throw new AppError(502, 'MATCH_FAILED', `The matcher could not assess any job: ${run.errors[0]}`);
  }
  if (run.errors.length) logEvent('match', `Matcher: ${run.errors.length} problem(s); ${run.deferred.length} job(s) wait for the next cycle. First: ${run.errors[0].slice(0, 200)}`);

  const skipped = run.results.filter((r) => r.decision === 'skipped').length;
  if (run.results.length) {
    emit({
      type: 'activity',
      message: `Matcher: ${assessed} assessed, ${skipped} skipped, ${run.deferred.length} deferred`,
      level: run.errors.length ? 'warn' : 'info',
    });
    emit({ type: 'jobs-changed' });
  }
  return run;
}

/** Normalise, score and decide one assessed job. Pure apart from the clock passed in. */
export function finalise(
  job: MatchJob,
  a: JobMatchAssessment,
  ctx: {
    similarity: number | null;
    preRank: number;
    profile: MatchProfile;
    cfg: Pick<CampaignConfig, 'stretchLevel' | 'minScore'>;
    now: string;
    campaignId: string | null;
    task: string;
    embedModel: string | null;
    signals: Set<string>;
    pipelineOn: boolean;
  },
): StoredMatch {
  const requirements = normaliseRequirements(a, { learning: ctx.profile.learning, yearsExperience: ctx.profile.yearsExperience });
  const legitimacy = worseLegitimacy(job.legitimacy, a.legitimacy);
  const s = scoreMatch({
    requirements,
    dimensions: a.dimensions,
    legitimacy,
    preRank: ctx.preRank,
    stretchLevel: ctx.cfg.stretchLevel,
    postedAt: job.postedAt,
    hiringSignal: hasHiringSignal(ctx.signals, { companyId: job.companyId, company: job.company, priority: job.priority }),
    now: ctx.now,
  });
  const blockers = s.breakdown.blockers;
  let decision: MatchResult['decision'] = 'scored';
  let reason = '';
  if (blockers.length) {
    decision = 'skipped';
    reason = `blocker: ${blockers.join('; ')}`;
  } else if (ctx.pipelineOn && s.screenPassScore < ctx.cfg.minScore) {
    decision = 'skipped';
    reason = `screen-pass ${s.screenPassScore} is below the campaign minimum of ${ctx.cfg.minScore}`;
  }

  const m: StoredMatch = {
    jobId: job.id,
    screenPassScore: s.screenPassScore,
    grade: s.grade,
    requirements,
    dimensions: clampDimensions(a.dimensions),
    legitimacy,
    verdict: a.verdict,
    strengths: a.strengths.slice(0, 4),
    gaps: a.gaps.slice(0, 4),
    atsKeywords: a.atsKeywords.slice(0, 12),
    stretch: { unmetImportant: s.breakdown.stretch.unmetImportant, blockers },
    inflatedPosting: a.inflatedPosting,
    decision,
    reason,
    explain: {
      version: MATCH_VERSION,
      asOf: ctx.now,
      campaignId: ctx.campaignId,
      stretchLevel: ctx.cfg.stretchLevel,
      minScore: ctx.pipelineOn ? ctx.cfg.minScore : null,
      prefilter: job.prefilterScore,
      similarity: ctx.similarity,
      embedModel: ctx.embedModel,
      preRank: ctx.preRank,
      postingLevel: a.postingLevel,
      inflationNote: a.inflatedPosting ? a.inflationNote : '',
      confidence: a.confidence,
      redFlags: a.redFlags.slice(0, 4),
      applyChannel: a.applyChannel,
      seniorityFit: a.seniorityFit,
      task: ctx.task,
      breakdown: s.breakdown,
      filter: null,
    },
  };
  MatchResultSchema.parse(m); // the contract must hold for every stored result
  return m;
}
