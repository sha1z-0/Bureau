import { all, now as nowIso } from '../db.ts';
import { transition } from '../campaign/pipeline.ts';
import type { CampaignConfig } from '../contracts/campaign.ts';
import { activityFor, byCompany, companyKeys, inFlight, recentSubmissions } from './companies.ts';
import { SENIORITY_CAP } from './scoring.ts';
import { setDecision, type StoredMatch } from './store.ts';

/**
 * Selection: the ordered, diversified queue for a campaign's open slots.
 * - Only `scored` jobs at or above the campaign's minimum, with no blocker.
 * - Company cooldown across all campaigns: nothing for a company applied to
 *   within N days, and only one application to a company in flight at a time.
 * - At most 2 per company per rolling week (matters when the cooldown is 0).
 * - Spread across categories: each pick from a category costs the next one
 *   from the same category a few points, so a strong role in another lane wins.
 * Deterministic for the same database state and clock.
 */

export const WEEKLY_COMPANY_CAP = 2;
export const CATEGORY_SPREAD_PENALTY = 4;

export interface PlanItem {
  jobId: string;
  title: string;
  company: string;
  category: string;
  score: number;
  /** Score after the category-spread penalty at the moment it was picked. */
  effective: number;
  reason: string;
}

export interface SelectionPlan {
  chosen: PlanItem[];
  /** Eligible now or later but not this pass (company busy, weekly cap, out of slots). Stays `scored`. */
  held: PlanItem[];
  /** Will never be worth applying to for this campaign. Moved to `skipped`. */
  skipped: PlanItem[];
}

interface Row {
  job_id: string;
  campaign_id: string | null;
  title: string;
  company: string;
  company_id: string | null;
  category: string;
  posted_at: string | null;
  status: string;
  match: string | null;
}

export function planSelection(cfg: CampaignConfig, campaignId: string, slots: number, now = nowIso()): SelectionPlan {
  const plan: SelectionPlan = { chosen: [], held: [], skipped: [] };
  const rows = all<Row>(
    `SELECT p.job_id, p.campaign_id, j.title, j.company, j.company_id, j.category, j.posted_at, j.status, j.match
       FROM pipeline p JOIN jobs j ON j.id = p.job_id
      WHERE p.state = 'scored'
        AND (p.campaign_id = ? OR p.campaign_id IS NULL OR p.campaign_id IN (SELECT id FROM campaigns WHERE status = 'ended' OR ends_at <= ?))`,
    campaignId,
    now,
  );

  const submitted = byCompany(recentSubmissions(Math.max(cfg.companyCooldownDays, 7), now));
  const flying = byCompany(inFlight());
  const cooldownSince = new Date(Date.parse(now) - cfg.companyCooldownDays * 86_400_000).toISOString();
  const weekSince = new Date(Date.parse(now) - 7 * 86_400_000).toISOString();

  interface Cand extends PlanItem {
    keys: string[];
    postedAt: string;
    companyId: string | null;
  }
  const cands: Cand[] = [];
  for (const r of rows) {
    let m: StoredMatch | null = null;
    try {
      m = r.match ? (JSON.parse(r.match) as StoredMatch) : null;
    } catch {
      m = null;
    }
    const own = r.campaign_id === campaignId;
    const item: Cand = {
      jobId: r.job_id,
      title: r.title,
      company: r.company,
      category: r.category,
      score: m?.screenPassScore ?? 0,
      effective: m?.screenPassScore ?? 0,
      reason: '',
      keys: companyKeys({ companyId: r.company_id, company: r.company }),
      postedAt: r.posted_at ?? '',
      companyId: r.company_id,
    };
    // Rows another context left unassigned are only held back, never skipped, in case another campaign wants them.
    const drop = (reason: string) => (own ? plan.skipped : plan.held).push({ ...item, reason });
    if (!m) {
      plan.held.push({ ...item, reason: 'no v2 match result yet' });
      continue;
    }
    if (r.status === 'dismissed') {
      drop('dismissed by you');
      continue;
    }
    if (m.stretch.blockers.length) {
      drop(`blocker: ${m.stretch.blockers.join('; ')}`);
      continue;
    }
    // A senior, staff or lead title is years away for an entry or junior candidate. Its score is capped at 45, and a
    // low campaign minimum must not let that cap through: never applied to.
    const senior = m.explain?.breakdown?.caps?.find((c) => c.cap === SENIORITY_CAP);
    if (senior) {
      drop(`${senior.reason}: years away, never applied to`);
      continue;
    }
    if (m.screenPassScore < cfg.minScore) {
      drop(`screen-pass ${m.screenPassScore} is below the campaign minimum of ${cfg.minScore}`);
      continue;
    }
    if (cfg.categories.length && !(cfg.categories as string[]).includes(r.category)) {
      plan.held.push({ ...item, reason: `${r.category} is not one of this campaign's categories` });
      continue;
    }
    if (r.posted_at && (Date.parse(now) - Date.parse(r.posted_at)) / 86_400_000 > cfg.maxAgeDays) {
      drop(`posted more than ${cfg.maxAgeDays} days ago`);
      continue;
    }
    cands.push(item);
  }

  cands.sort((a, b) => b.score - a.score || b.postedAt.localeCompare(a.postedAt) || a.jobId.localeCompare(b.jobId));

  const pickedPerCompany = new Map<string, number>();
  const pickedPerCategory = new Map<string, number>();
  const remaining = [...cands];
  while (remaining.length) {
    // Walk out anything blocked by a company rule; it is held or skipped, not chosen.
    const open: Cand[] = [];
    for (const c of remaining) {
      const ref = { companyId: c.companyId, company: c.company, jobId: c.jobId };
      const sent = activityFor(submitted, ref);
      const sentInCooldown = cfg.companyCooldownDays > 0 ? sent.filter((a) => a.at >= cooldownSince) : [];
      if (sentInCooldown.length) {
        plan.skipped.push({ ...c, reason: `applied to ${sentInCooldown[0].company} on ${sentInCooldown[0].at.slice(0, 10)} (cooldown ${cfg.companyCooldownDays} days)` });
        continue;
      }
      const busy = activityFor(flying, ref);
      const picked = Math.max(0, ...c.keys.map((k) => pickedPerCompany.get(k) ?? 0));
      if (cfg.companyCooldownDays > 0 && (busy.length || picked)) {
        plan.held.push({ ...c, reason: `an application to ${c.company} is already under way` });
        continue;
      }
      const week = sent.filter((a) => a.at >= weekSince).length + busy.length + picked;
      if (week >= WEEKLY_COMPANY_CAP) {
        plan.held.push({ ...c, reason: `already ${week} applications to ${c.company} this week` });
        continue;
      }
      open.push(c);
    }
    if (!open.length || plan.chosen.length >= slots) {
      for (const c of open) plan.held.push({ ...c, reason: 'no slot left this pass' });
      break;
    }
    // Best effective score, with the category-spread penalty applied.
    let best = open[0];
    let bestEff = -Infinity;
    for (const c of open) {
      const eff = c.score - CATEGORY_SPREAD_PENALTY * (pickedPerCategory.get(c.category) ?? 0);
      if (eff > bestEff) {
        best = c;
        bestEff = eff;
      }
    }
    plan.chosen.push({ jobId: best.jobId, title: best.title, company: best.company, category: best.category, score: best.score, effective: bestEff, reason: `screen-pass ${best.score}, pick ${plan.chosen.length + 1}` });
    for (const k of best.keys) pickedPerCompany.set(k, (pickedPerCompany.get(k) ?? 0) + 1);
    pickedPerCategory.set(best.category, (pickedPerCategory.get(best.category) ?? 0) + 1);
    remaining.length = 0;
    remaining.push(...open.filter((c) => c !== best));
  }
  return plan;
}

/** Choose and move up to `slots` jobs to `selected`; skip the ones that can never qualify. Returns the chosen ids, best first. */
export function applySelection(plan: SelectionPlan, campaignId: string): string[] {
  for (const s of plan.skipped) {
    transition(s.jobId, 'skipped', { campaignId, reason: s.reason.slice(0, 500) });
    setDecision(s.jobId, 'skipped', s.reason);
  }
  for (const c of plan.chosen) {
    transition(c.jobId, 'selected', { campaignId, reason: c.reason });
    setDecision(c.jobId, 'selected', c.reason);
  }
  return plan.chosen.map((c) => c.jobId);
}
