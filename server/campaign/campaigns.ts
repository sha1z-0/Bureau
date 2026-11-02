import crypto from 'node:crypto';
import { z } from 'zod/v4';
import { all, get, now as dbNow, run, tx } from '../db.ts';
import { AppError } from '../errors.ts';
import { emit } from '../services/bus.ts';
import { CampaignConfigSchema, type Campaign, type CampaignConfig, type CampaignStatus } from '../contracts/campaign.ts';
import './schema.ts';
import { localDaysBetween, validTimeZone } from './time.ts';

/**
 * Campaign CRUD and lifecycle. A campaign is `draft` until started, `active`
 * while the autopilot works it (it may still be waiting for startsAt),
 * `paused` by the owner, the kill switch or a budget, and `ended` at endsAt or
 * by hand. Every status change emits `campaign.status`.
 */

interface Row {
  id: string;
  name: string;
  status: CampaignStatus;
  starts_at: string;
  ends_at: string;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface CampaignMeta {
  firstActiveAt: string | null;
  liveSince: string | null;
  /** The v1 hunt switched to "rehearse": never goes live on its own. */
  rehearseOnly: boolean;
  /** Created by the /api/hunt compatibility shim. */
  compat: boolean;
  statusReason: string | null;
  finalDigestId: string | null;
}

const toCampaign = (r: Row): Campaign => {
  const parsed = CampaignConfigSchema.safeParse(JSON.parse(r.config));
  if (!parsed.success) throw new AppError(500, 'BAD_CAMPAIGN', `Campaign ${r.id} has an unreadable config`);
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    config: parsed.data,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

/** Checks the schema can't express. Throws a 400 with a plain message. */
export function validateConfig(input: unknown): CampaignConfig {
  const parsed = CampaignConfigSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError(400, 'BAD_CONFIG', `Campaign settings: ${first.path.join('.') || 'value'} ${first.message}`);
  }
  const cfg = parsed.data;
  const s = Date.parse(cfg.startsAt);
  const e = Date.parse(cfg.endsAt);
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw new AppError(400, 'BAD_CONFIG', 'Start and end must be dates.');
  if (e <= s) throw new AppError(400, 'BAD_CONFIG', 'The campaign must end after it starts.');
  if (cfg.pacingMinutes.min > cfg.pacingMinutes.max) throw new AppError(400, 'BAD_CONFIG', 'The shortest gap between applications is longer than the longest.');
  if (!validTimeZone(cfg.activeHours.tz)) throw new AppError(400, 'BAD_CONFIG', `Unknown time zone "${cfg.activeHours.tz}".`);
  return { ...cfg, startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() };
}

export function listCampaigns(status?: CampaignStatus): Campaign[] {
  const rows = status
    ? all<Row>('SELECT * FROM campaigns WHERE status = ? ORDER BY created_at ASC', status)
    : all<Row>('SELECT * FROM campaigns ORDER BY created_at ASC');
  // One unreadable row must not stop the autopilot for every other campaign.
  const out: Campaign[] = [];
  for (const r of rows) {
    try {
      out.push(toCampaign(r));
    } catch {
      /* skipped; requireCampaign still reports it */
    }
  }
  return out;
}

export function getCampaign(id: string): Campaign | null {
  const r = get<Row>('SELECT * FROM campaigns WHERE id = ?', id);
  return r ? toCampaign(r) : null;
}

export function requireCampaign(id: string): Campaign {
  const c = getCampaign(id);
  if (!c) throw new AppError(404, 'NOT_FOUND', 'No such campaign.');
  return c;
}

/** Find by id, id prefix or name (case-insensitive). For Telegram commands. */
export function findCampaign(ref: string): Campaign | null {
  const q = ref.trim().toLowerCase();
  if (!q) return null;
  const list = listCampaigns();
  return (
    list.find((c) => c.id === ref.trim()) ??
    list.find((c) => c.name.toLowerCase() === q) ??
    (q.length >= 4 ? list.find((c) => c.id.toLowerCase().startsWith(q)) : undefined) ??
    (() => {
      const partial = list.filter((c) => c.name.toLowerCase().includes(q));
      return partial.length === 1 ? partial[0] : undefined;
    })() ??
    null
  );
}

export const CreateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(80),
  config: z.unknown(),
});

export function createCampaign(input: { name: string; config: unknown }, opts: { compat?: boolean; rehearseOnly?: boolean } = {}): Campaign {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new AppError(400, 'BAD_NAME', 'Give the campaign a name.');
  const cfg = validateConfig(input.config);
  const id = crypto.randomUUID();
  const ts = dbNow();
  tx(() => {
    run(
      'INSERT INTO campaigns (id, name, status, starts_at, ends_at, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      name,
      'draft',
      cfg.startsAt,
      cfg.endsAt,
      JSON.stringify(cfg),
      ts,
      ts,
    );
    run(
      'INSERT INTO campaign_meta (campaign_id, rehearse_only, compat, updated_at) VALUES (?, ?, ?, ?)',
      id,
      opts.rehearseOnly ? 1 : 0,
      opts.compat ? 1 : 0,
      ts,
    );
  });
  emit({ type: 'campaign.status', campaignId: id, status: 'draft', message: `Campaign "${name}" created` });
  return requireCampaign(id);
}

export function updateCampaign(id: string, patch: { name?: string; config?: unknown }): Campaign {
  const cur = requireCampaign(id);
  if (cur.status === 'ended') throw new AppError(409, 'ENDED', 'This campaign has ended. Create a new one instead.');
  const name = patch.name?.trim().slice(0, 80) || cur.name;
  const cfg = patch.config === undefined ? cur.config : validateConfig({ ...cur.config, ...(patch.config as object) });
  run(
    'UPDATE campaigns SET name = ?, starts_at = ?, ends_at = ?, config = ?, updated_at = ? WHERE id = ?',
    name,
    cfg.startsAt,
    cfg.endsAt,
    JSON.stringify(cfg),
    dbNow(),
    id,
  );
  return requireCampaign(id);
}

export function deleteCampaign(id: string) {
  const cur = requireCampaign(id);
  if (cur.status === 'active') throw new AppError(409, 'ACTIVE', 'Pause or end the campaign before deleting it.');
  tx(() => {
    run('DELETE FROM campaigns WHERE id = ?', id);
    run('DELETE FROM campaign_meta WHERE campaign_id = ?', id);
    run("DELETE FROM campaign_tasks WHERE scope = ?", id);
  });
}

// ── Meta ─────────────────────────────────────────────────────────────────────

interface MetaRow {
  campaign_id: string;
  first_active_at: string | null;
  live_since: string | null;
  rehearse_only: number;
  compat: number;
  status_reason: string | null;
  final_digest_id: string | null;
}

export function campaignMeta(id: string): CampaignMeta {
  const r = get<MetaRow>('SELECT * FROM campaign_meta WHERE campaign_id = ?', id);
  return {
    firstActiveAt: r?.first_active_at ?? null,
    liveSince: r?.live_since ?? null,
    rehearseOnly: !!r?.rehearse_only,
    compat: !!r?.compat,
    statusReason: r?.status_reason ?? null,
    finalDigestId: r?.final_digest_id ?? null,
  };
}

export function setMeta(id: string, patch: Partial<CampaignMeta>) {
  const cur = campaignMeta(id);
  const next = { ...cur, ...patch };
  run(
    `INSERT INTO campaign_meta (campaign_id, first_active_at, live_since, rehearse_only, compat, status_reason, final_digest_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id) DO UPDATE SET first_active_at = excluded.first_active_at, live_since = excluded.live_since,
       rehearse_only = excluded.rehearse_only, compat = excluded.compat, status_reason = excluded.status_reason,
       final_digest_id = excluded.final_digest_id, updated_at = excluded.updated_at`,
    id,
    next.firstActiveAt,
    next.liveSince,
    next.rehearseOnly ? 1 : 0,
    next.compat ? 1 : 0,
    next.statusReason,
    next.finalDigestId,
    dbNow(),
  );
}

// ── Status ───────────────────────────────────────────────────────────────────

const LEGAL_STATUS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['active', 'ended'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],
};

/** Move a campaign's status. Same-status is a no-op. Returns the campaign. */
export function setStatus(id: string, status: CampaignStatus, reason: string | null, nowMs: number): Campaign {
  const cur = requireCampaign(id);
  if (cur.status === status) return cur;
  if (!LEGAL_STATUS[cur.status].includes(status)) {
    throw new AppError(409, 'BAD_STATUS', `A ${cur.status} campaign cannot become ${status}.`);
  }
  run('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?', status, dbNow(), id);
  const meta = campaignMeta(id);
  setMeta(id, {
    statusReason: reason,
    firstActiveAt: status === 'active' && !meta.firstActiveAt ? new Date(Math.max(nowMs, Date.parse(cur.startsAt))).toISOString() : meta.firstActiveAt,
  });
  emit({ type: 'campaign.status', campaignId: id, status, message: reason ?? undefined });
  return requireCampaign(id);
}

// ── Dry run ──────────────────────────────────────────────────────────────────

/** When the campaign effectively started: its first activation, never before startsAt. */
export function campaignDay0(c: Campaign): number {
  const meta = campaignMeta(c.id);
  const start = Date.parse(c.startsAt);
  return meta.firstActiveAt ? Math.max(start, Date.parse(meta.firstActiveAt)) : start;
}

/** 0-based local day index of the campaign at `nowMs`. */
export function campaignDayIndex(c: Campaign, nowMs: number): number {
  return Math.max(0, localDaysBetween(campaignDay0(c), nowMs, c.config.activeHours.tz));
}

/** True while the campaign should rehearse (fill and verify, never submit). */
export function isDryRun(c: Campaign, nowMs: number): boolean {
  const meta = campaignMeta(c.id);
  if (meta.rehearseOnly) return true;
  return campaignDayIndex(c, nowMs) < c.config.dryRunDays;
}

/** When dry-run ends and live begins (local midnight of day N), or null when there is no dry run. */
export function liveAt(c: Campaign): string | null {
  if (campaignMeta(c.id).rehearseOnly) return null;
  if (c.config.dryRunDays <= 0) return null;
  const day0 = campaignDay0(c);
  // Walk local days forward; robust across DST.
  let t = day0;
  const tz = c.config.activeHours.tz;
  while (localDaysBetween(day0, t, tz) < c.config.dryRunDays) t += 3_600_000;
  // t is within the first hour of the live day; snap back to its midnight.
  while (localDaysBetween(day0, t - 60_000, tz) >= c.config.dryRunDays) t -= 60_000;
  return new Date(t).toISOString();
}
