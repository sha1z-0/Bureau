import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { all, get } from '../db.ts';
import { AppError } from '../errors.ts';
import { pipelineState } from '../campaign/pipeline.ts';
import { CampaignConfigSchema, type CampaignConfig } from '../contracts/campaign.ts';
import { STRETCH_ALLOWANCE } from '../contracts/match.ts';
import { taskCost } from '../ai/cost.ts';
import { AI_LIMIT, body } from '../routes/util.ts';
import { explainMatch } from './explain.ts';
import { matchJobs, pendingForMatch } from './index.ts';
import { loadMatchProfile } from './profile.ts';
import { SCORE_LABEL, SCORE_TOOLTIP } from './rubric.ts';
import { BLEND, BLOCKER_CAP, DIMENSION_WEIGHTS, FRESH_BOOST, GROUP_WEIGHTS, MATCH_CREDIT, SIGNAL_BOOST, STRETCH_STEPS } from './scoring.ts';
import { planSelection } from './select.ts';
import { defaultMatchConfig, matchSettings, MatchSettingsPatch, saveMatchSettings } from './settings.ts';
import { contractView, readMatch } from './store.ts';

/**
 * UI-facing matcher routes, all under /api/match/*:
 *   GET  /api/match/meaning            what the score means (label, tooltip) and how it is weighted
 *   GET  /api/match/jobs/:id           the stored match for a job: contract, breakdown, explanation, pipeline state
 *   GET  /api/match/jobs/:id/explain   just the "chance of passing the screen" explanation
 *   POST /api/match/run                assess jobs now ({ jobIds?, campaignId? }); spends AI budget
 *   GET  /api/match/queue              preview of the selection queue for a campaign (moves nothing)
 *   GET  /api/match/stats              decisions, cost per assessed job and prompt-cache hit rate
 *   GET  /api/match/settings           matcher settings
 *   PUT  /api/match/settings           update matcher settings
 */

function campaignConfig(campaignId: string | undefined): CampaignConfig {
  if (!campaignId) return defaultMatchConfig(loadMatchProfile());
  const row = get<{ config: string }>('SELECT config FROM campaigns WHERE id = ?', campaignId);
  if (!row) throw new AppError(404, 'NO_CAMPAIGN', 'No such campaign.');
  const parsed = CampaignConfigSchema.safeParse(JSON.parse(row.config));
  if (!parsed.success) throw new AppError(422, 'BAD_CAMPAIGN', 'This campaign has an invalid configuration.');
  return parsed.data;
}

/** Measured cost and cache behaviour of the matcher's Claude calls (last 30 days). */
export function matchStats() {
  const usage = all<{ task: string; calls: number; input: number; output: number; cache_read: number; cache_write: number; cost: number }>(
    `SELECT task, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cache_read) AS cache_read,
            SUM(cache_write) AS cache_write, SUM(cost_usd) AS cost
       FROM ai_usage WHERE task IN ('match', 'score') AND ts >= date('now', '-30 day') GROUP BY task`,
  );
  const assessed =
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM jobs WHERE match IS NOT NULL AND json_extract(match, '$.explain.filter') IS NULL AND COALESCE(scored_at, '') >= date('now', '-30 day')",
    )?.n ?? 0;
  const decisions = all<{ decision: string; n: number }>(
    "SELECT json_extract(match, '$.decision') AS decision, COUNT(*) AS n FROM jobs WHERE match IS NOT NULL GROUP BY decision",
  );
  const m = usage.find((u) => u.task === 'match');
  const prompt = m ? m.input + m.cache_read + m.cache_write : 0;
  const estimatePerCall = taskCost('match');
  return {
    decisions: Object.fromEntries(decisions.map((d) => [d.decision ?? 'unknown', d.n])),
    usage,
    match: m
      ? {
          calls: m.calls,
          costUsd: m.cost,
          cacheHitRate: prompt ? m.cache_read / prompt : 0,
          costPerAssessedJob: assessed ? m.cost / assessed : null,
        }
      : null,
    estimate: { perCallUsd: estimatePerCall.usd, perJobUsd: estimatePerCall.usd / matchSettings().batchSize, measured: estimatePerCall.measured },
  };
}

export async function matchRoutes(app: FastifyInstance) {
  app.get('/api/match/meaning', async () => ({
    label: SCORE_LABEL,
    tooltip: SCORE_TOOLTIP,
    weights: { blend: BLEND, groups: GROUP_WEIGHTS, credit: MATCH_CREDIT, dimensions: DIMENSION_WEIGHTS },
    stretch: { allowance: STRETCH_ALLOWANCE, penaltySteps: STRETCH_STEPS },
    caps: { blocker: BLOCKER_CAP },
    boosts: { fresh: FRESH_BOOST, hiringSignal: SIGNAL_BOOST },
  }));

  app.get('/api/match/jobs/:id', async (req) => {
    const { id } = body(z.object({ id: z.string().min(1).max(64) }), req.params);
    if (!get('SELECT 1 AS x FROM jobs WHERE id = ?', id)) throw new AppError(404, 'NOT_FOUND', 'No such job.');
    const m = readMatch(id);
    const state = pipelineState(id);
    return {
      jobId: id,
      pipeline: state ? { state: state.state, campaignId: state.campaignId, updatedAt: state.updatedAt } : null,
      match: m ? contractView(m) : null,
      requirements: m?.requirements ?? [],
      breakdown: m?.explain.breakdown ?? null,
      explain: m ? { ...m.explain, breakdown: undefined } : null,
      explanation: m ? explainMatch(m) : null,
      label: SCORE_LABEL,
      tooltip: SCORE_TOOLTIP,
    };
  });

  app.get('/api/match/jobs/:id/explain', async (req) => {
    const { id } = body(z.object({ id: z.string().min(1).max(64) }), req.params);
    const m = readMatch(id);
    if (!m) throw new AppError(404, 'NOT_MATCHED', 'This job has not been matched yet.');
    return explainMatch(m);
  });

  app.post('/api/match/run', AI_LIMIT, async (req) => {
    const input = body(z.object({ jobIds: z.array(z.string().max(64)).max(200).optional(), campaignId: z.string().max(64).optional() }), req.body);
    const cfg = campaignConfig(input.campaignId);
    const ids = input.jobIds?.length ? input.jobIds : pendingForMatch(input.campaignId ?? null, matchSettings().assessPerCycle * 2);
    const results = await matchJobs(ids, cfg, { campaignId: input.campaignId ?? null });
    return {
      requested: ids.length,
      results: results.map((r) => ({ jobId: r.jobId, screenPassScore: r.screenPassScore, grade: r.grade, decision: r.decision, reason: r.reason })),
    };
  });

  app.get('/api/match/queue', async (req) => {
    const q = body(z.object({ campaignId: z.string().min(1).max(64), slots: z.coerce.number().int().min(0).max(200).optional() }), req.query);
    const cfg = campaignConfig(q.campaignId);
    return planSelection(cfg, q.campaignId, q.slots ?? cfg.dailyCap);
  });

  app.get('/api/match/stats', async () => matchStats());

  app.get('/api/match/settings', async () => matchSettings());

  app.put('/api/match/settings', async (req) => saveMatchSettings(body(MatchSettingsPatch, req.body)));
}
