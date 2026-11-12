import { all, now as nowIso } from '../db.ts';
import type { CampaignConfig } from '../contracts/campaign.ts';
import type { MatchResult } from '../contracts/match.ts';
import { runMatch, type MatchOptions } from './engine.ts';
import { applySelection, planSelection } from './select.ts';

/**
 * A02: picks the jobs worth applying to, stretch roles included.
 *
 * The score (`screenPassScore`) means the CHANCE OF PASSING THE SCREEN: how
 * likely a recruiter is to move the candidate to an interview. See
 * server/match/rubric.ts for the rubric and server/match/scoring.ts for the
 * deterministic formula.
 */

export { SCORE_LABEL, SCORE_TOOLTIP, MATCH_RUBRIC } from './rubric.ts';
export { explainMatch } from './explain.ts';
export { readMatch, contractView } from './store.ts';
export { planSelection } from './select.ts';
export { matchSettings, saveMatchSettings, defaultMatchConfig } from './settings.ts';
export type { MatchOptions, MatchRun } from './engine.ts';
export type { StoredMatch } from './store.ts';

/**
 * Hard filters, similarity pre-rank, Claude assessment and deterministic scoring.
 * Moves jobs found → filtered → scored, or → skipped with a reason. Returns a
 * result for every job decided in this call (filter rejections included, with
 * screenPassScore 0); jobs over the per-cycle limit stay at `filtered` and are
 * picked up by the next call (see `pendingForMatch`).
 *
 * Results carry extra working beyond the contract (`explain`, and
 * `proofKind` / `blockerKind` on each requirement) that the writer can use.
 */
export async function matchJobs(jobIds: string[], cfg: CampaignConfig, opts: MatchOptions = {}): Promise<MatchResult[]> {
  const run = await runMatch(jobIds, cfg, opts);
  return run.results;
}

/** The ordered, diversified queue for a campaign's open slots. Moves the chosen jobs to selected. */
export function selectForCampaign(cfg: CampaignConfig, campaignId: string, slots: number): string[] {
  return applySelection(planSelection(cfg, campaignId, Math.max(0, Math.floor(slots)), nowIso()), campaignId);
}

/** Jobs waiting for the matcher (pipeline `found` or `filtered`), oldest first, for this campaign or unassigned. */
export function pendingForMatch(campaignId: string | null = null, limit = 500): string[] {
  // Jobs a finished campaign found (ended, or past its end date) are free for the next one.
  // Freshest postings first: a backlog of older finds must not hold back today's roles.
  return all<{ job_id: string }>(
    `SELECT p.job_id FROM pipeline p JOIN jobs j ON j.id = p.job_id WHERE p.state IN ('found', 'filtered')
       AND (p.campaign_id IS ? OR p.campaign_id IS NULL OR p.campaign_id IN (SELECT id FROM campaigns WHERE status = 'ended' OR ends_at <= ?))
     ORDER BY COALESCE(j.posted_at, j.found_at) DESC, p.job_id ASC LIMIT ?`,
    campaignId,
    new Date().toISOString(),
    limit,
  ).map((r) => r.job_id);
}
