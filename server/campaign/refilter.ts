import { all, now as nowIso } from '../db.ts';
import type { CampaignConfig } from '../contracts/campaign.ts';
import { buildFilterContext, hardFilter, type FilterCode } from '../match/filters.ts';
import { loadJobs } from '../match/jobs.ts';
import { loadMatchProfile } from '../match/profile.ts';
import { matchSettings } from '../match/settings.ts';
import { activeClaim } from './claims.ts';
import { transition } from './pipeline.ts';

/**
 * The owner changed what a campaign is looking for (roles, fields, places,
 * remote-only, stretch, minimum score…). Jobs the old settings set aside get
 * another look, and jobs picked under the old settings that the new ones rule
 * out are dropped before anything is written or sent for them.
 *
 * Never re-opened: scams and ghost listings, true blockers Claude found,
 * company cooldowns, jobs already applied to, jobs the owner dismissed.
 */

/** Settings that change which jobs a campaign wants. */
const FILTER_FIELDS = ['roles', 'categories', 'locations', 'remoteOnly', 'stretchLevel', 'minScore', 'maxAgeDays'] as const;

/** Skips that came from the campaign's own settings, so new settings may undo them. */
const REOPEN_CODES = new Set<FilterCode>(['category', 'location', 'remote_only', 'remote_region', 'stale', 'weak_match']);

export function filtersChanged(before: CampaignConfig, after: CampaignConfig): boolean {
  return FILTER_FIELDS.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

interface Row {
  job_id: string;
  state: string;
  match: string | null;
}

function skipCause(match: string | null): { code: FilterCode | null; belowMinimum: boolean } {
  try {
    const m = JSON.parse(match ?? 'null') as { reason?: string; explain?: { filter?: { code?: FilterCode } } } | null;
    return { code: m?.explain?.filter?.code ?? null, belowMinimum: /below the campaign minimum/.test(m?.reason ?? '') };
  } catch {
    return { code: null, belowMinimum: false };
  }
}

/** Settings the owner can narrow while a written application waits to go out. */
const GATE_CODES = new Set<FilterCode>(['category', 'location', 'remote_only', 'remote_region']);

/** Why the campaign's current settings rule this job out, or null when it still fits. */
export function ruledOutNow(jobId: string, cfg: CampaignConfig): string | null {
  const profile = loadMatchProfile();
  const [j] = loadJobs([jobId]);
  if (!profile || !j) return null;
  const v = hardFilter(j, buildFilterContext(cfg, profile, nowIso(), matchSettings().legitimacyFloor));
  return !v.pass && v.code && GATE_CODES.has(v.code) ? (v.reason ?? v.code) : null;
}

/** A new CV or edited profile changes every score: running and paused campaigns sort their jobs again. */
export function refilterAfterProfileChange(): RefilterResult {
  const total: RefilterResult = { reopened: 0, dropped: 0, rechecked: 0 };
  const open = all<{ id: string; config: string }>("SELECT id, config FROM campaigns WHERE status IN ('active', 'paused')");
  for (const c of open) {
    const r = refilterCampaign(c.id, JSON.parse(c.config) as CampaignConfig);
    total.reopened += r.reopened;
    total.dropped += r.dropped;
    total.rechecked += r.rechecked;
  }
  return total;
}

export interface RefilterResult {
  reopened: number;
  dropped: number;
  rechecked: number;
}

export function refilterCampaign(campaignId: string, cfg: CampaignConfig): RefilterResult {
  const out: RefilterResult = { reopened: 0, dropped: 0, rechecked: 0 };
  const rows = all<Row>(
    `SELECT p.job_id, p.state, j.match FROM pipeline p JOIN jobs j ON j.id = p.job_id
      WHERE p.campaign_id = ? AND p.state IN ('skipped', 'scored', 'selected')`,
    campaignId,
  );
  const reason = 'Campaign settings changed: checking again';

  // Picked or scored under the old settings: drop what the new hard filters rule out, re-score the rest.
  const live = rows.filter((r) => r.state !== 'skipped' && !activeClaim(r.job_id));
  const profile = loadMatchProfile();
  if (profile && live.length) {
    const fctx = buildFilterContext(cfg, profile, nowIso(), matchSettings().legitimacyFloor);
    const byId = new Map(loadJobs(live.map((r) => r.job_id)).map((j) => [j.id, j]));
    for (const r of live) {
      const j = byId.get(r.job_id);
      if (!j) continue;
      const v = hardFilter(j, fctx);
      if (!v.pass) {
        transition(r.job_id, 'skipped', { campaignId, reason: `filter: ${v.reason}` });
        out.dropped++;
      } else {
        // Stretch level and minimum score decide the pick, so the matcher scores it again.
        transition(r.job_id, 'skipped', { campaignId, reason });
        transition(r.job_id, 'found', { campaignId, reason });
        out.rechecked++;
      }
    }
  }

  // Set aside by the old settings: back to the matcher.
  for (const r of rows) {
    if (r.state !== 'skipped') continue;
    const cause = skipCause(r.match);
    if (!cause.belowMinimum && !(cause.code && REOPEN_CODES.has(cause.code))) continue;
    transition(r.job_id, 'found', { campaignId, reason });
    out.reopened++;
  }
  return out;
}
