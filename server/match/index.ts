import type { CampaignConfig } from '../contracts/campaign.ts';
import type { MatchResult } from '../contracts/match.ts';
import { NotImplemented } from '../contracts/stub.ts';

/** A02 — picks the jobs worth applying to, stretch roles included. */

/** Hard filters, similarity pre-rank, Claude assessment and deterministic scoring. Moves jobs to scored / skipped. */
export async function matchJobs(jobIds: string[], cfg: CampaignConfig): Promise<MatchResult[]> {
  void jobIds;
  void cfg;
  throw new NotImplemented('A02', 'matchJobs');
}

/** The ordered, diversified queue for a campaign's open slots. Moves the chosen jobs to selected. */
export function selectForCampaign(cfg: CampaignConfig, campaignId: string, slots: number): string[] {
  void cfg;
  void campaignId;
  void slots;
  throw new NotImplemented('A02', 'selectForCampaign');
}
