import { aiSettings, apiKey } from '../ai/claude.ts';
import { unitCosts } from '../ai/cost.ts';
import { get, getSetting, now, run, setSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { loadApplication } from './applications.ts';
import { browserAvailable } from './browser.ts';
import { emit } from './bus.ts';
import { applyViaForm } from './formFiller.ts';
import { smtpSettings } from './mailer.ts';
import { loadProfile } from './profileStore.ts';
import { secretHint } from '../security/vault.ts';
import type { Campaign } from '../contracts/campaign.ts';
import { campaignMeta, createCampaign, getEngine, isDryRun, listCampaigns, setMeta, updateCampaign } from '../campaign/index.ts';
import { defaultMatchConfig, matchSettings } from '../match/settings.ts';
import { loadMatchProfile } from '../match/profile.ts';

/**
 * v1 compatibility shim (A08). The hunt is now the campaign autopilot
 * (server/campaign/**): /api/hunt reads and drives "the active campaign". When
 * no campaign exists, switching the hunt on creates an open-ended "Hunt"
 * campaign from the v1 settings. Everything v1 callers import from here keeps
 * its name and shape.
 */

export interface HuntSettings {
  enabled: boolean;
  mode: 'live' | 'rehearse';
  intervalHours: number;
  applyThreshold: number;
  dailyCap: number;
  assessPerCycle: number;
  channels: { email: boolean; forms: boolean };
}

export const DEFAULT_HUNT: HuntSettings = {
  enabled: false,
  mode: 'live',
  intervalHours: 3,
  applyThreshold: 75,
  dailyCap: 10,
  assessPerCycle: 40,
  channels: { email: true, forms: true },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** The campaign /api/hunt speaks for: the first active one, else the hunt's own campaign. */
export function huntCampaign(): Campaign | null {
  const list = listCampaigns();
  return list.find((c) => c.status === 'active') ?? list.find((c) => c.status !== 'ended' && campaignMeta(c.id).compat) ?? null;
}

function savedV1(): HuntSettings {
  const saved = getSetting<Partial<HuntSettings>>('hunt', {});
  return { ...DEFAULT_HUNT, ...saved, channels: { ...DEFAULT_HUNT.channels, ...(saved.channels ?? {}) } };
}

export function huntSettings(): HuntSettings {
  const c = huntCampaign();
  if (!c) return { ...savedV1(), enabled: false };
  return {
    enabled: c.status === 'active',
    mode: isDryRun(c, getEngine().deps.clock.now()) ? 'rehearse' : 'live',
    intervalHours: clamp(c.config.scoutEveryHours, 1, 48),
    applyThreshold: clamp(c.config.minScore, 50, 100),
    dailyCap: clamp(c.config.dailyCap, 1, 40),
    assessPerCycle: clamp(matchSettings().assessPerCycle, 5, 200),
    channels: { email: c.config.channels.email, forms: c.config.channels.forms },
  };
}

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function saveHuntSettings(next: HuntSettings) {
  setSetting('hunt', next);
  const patch = {
    minScore: next.applyThreshold,
    dailyCap: next.dailyCap,
    scoutEveryHours: clamp(next.intervalHours, 1, 24),
  };
  let c = huntCampaign();
  if (!c) {
    if (!next.enabled) return;
    let profile = null;
    try {
      profile = loadMatchProfile();
    } catch {
      profile = null;
    }
    const base = defaultMatchConfig(profile, new Date().toISOString());
    c = createCampaign(
      {
        name: 'Hunt',
        config: {
          ...base,
          ...patch,
          endsAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
          // The v1 hunt ran around the clock; keep a human gap between applications.
          activeHours: { tz: localZone(), start: '00:00', end: '00:00' },
          pacingMinutes: { min: 5, max: 15 },
          channels: { ...base.channels, email: next.channels.email, forms: next.channels.forms },
        },
      },
      { compat: true, rehearseOnly: next.mode === 'rehearse' },
    );
  } else {
    c = updateCampaign(c.id, { config: { ...patch, channels: { ...c.config.channels, email: next.channels.email, forms: next.channels.forms } } });
    setMeta(c.id, { rehearseOnly: next.mode === 'rehearse' });
  }
  const e = getEngine();
  if (next.enabled && c.status !== 'active') e.startCampaign(c.id);
  if (!next.enabled && c.status === 'active') e.pauseCampaign(c.id, 'The hunt was switched off');
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function appliedToday(): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE auto = 1 AND status = 'sent' AND sent_at >= ?", startOfToday())?.n ?? 0;
}

export async function huntReadiness() {
  const profile = loadProfile();
  const p = profile?.preferences;
  return {
    apiKey: !!apiKey(),
    profile: !!profile,
    answers: !!p && !!p.workAuthorization,
    email: !!smtpSettings() && secretHint('smtp_password').set,
    browser: await browserAvailable(),
  };
}

export async function huntStatus() {
  const s = huntSettings();
  const c = huntCampaign();
  const e = getEngine();
  const st = e.status();
  const since = startOfToday();
  const count = (status: string) =>
    get<{ n: number }>('SELECT COUNT(*) AS n FROM applications WHERE auto = 1 AND status = ? AND updated_at >= ?', status, since)?.n ?? 0;
  const stats = c ? e.campaignStats(c) : null;
  const scout = stats?.tasks.scout;
  const last = scout?.lastRunAt
    ? { at: scout.lastRunAt, summary: scout.lastError ? `Last round had a problem: ${scout.lastError}` : 'Scouted, matched and queued' }
    : getSetting<{ at: string; summary: string } | null>('hunt.last', null);
  return {
    settings: s,
    running: st.current ? { startedAt: st.current.startedAt, step: st.current.step } : null,
    last,
    nextRunAt: s.enabled ? (stats?.nextScoutAt && stats.nextScoutAt !== 'soon' ? stats.nextScoutAt : now()) : null,
    today: { applied: appliedToday(), rehearsed: count('rehearsed'), needsYou: count('needs_you'), failed: count('failed') },
    needsYouTotal: get<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE status = 'needs_you'")?.n ?? 0,
    readiness: await huntReadiness(),
    costs: { ...unitCosts(), budget: aiSettings().monthlyBudgetUsd },
    campaign: c ? { id: c.id, name: c.name, status: c.status } : null,
    kill: st.kill,
  };
}

/** v1 "stop": let the current application finish, then hold off for a full pacing gap. */
export function stopHunt() {
  getEngine().softStop();
}

export async function runHuntCycle(trigger: 'timer' | 'manual'): Promise<void> {
  void trigger;
  if (!apiKey()) throw new AppError(412, 'NO_API_KEY', 'Add your Claude API key first.');
  if (!loadProfile()) throw new AppError(412, 'NO_PROFILE', 'Upload your CV first.');
  const c = huntCampaign();
  if (!c || c.status !== 'active') throw new AppError(409, 'NO_CAMPAIGN', 'Switch the hunt on (or start a campaign) first.');
  getEngine().runNow();
}

/** The autopilot (startAutopilot in server/campaign) now drives every round; kept for v1 callers. */
export function startHuntTimer() {}

function setOutcome(appId: string, status: string, reason: string, extra: { shot?: string | null; answers?: unknown } = {}) {
  run(
    'UPDATE applications SET status = ?, reason = ?, shot = COALESCE(?, shot), answers = COALESCE(?, answers), auto = 1, updated_at = ? WHERE id = ?',
    status,
    reason,
    extra.shot ?? null,
    extra.answers ? JSON.stringify(extra.answers) : null,
    now(),
    appId,
  );
  emit({ type: 'application', id: appId, status });
}

interface Target {
  id: string;
  title: string;
  company: string;
  source: string;
  external_id: string | null;
  url: string;
  description_text: string | null;
  apply_email: string | null;
  ai_score: number;
}

/** "Finish it for me": open a visible browser on the filled form so you can clear a CAPTCHA and press submit. */
export async function finishInBrowser(appId: string) {
  const app = loadApplication(appId);
  const job = get<Target>('SELECT id, title, company, source, external_id, url, description_text, apply_email, ai_score FROM jobs WHERE id = ?', app.job_id);
  if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
  const outcome = await applyViaForm(app, job, { submit: false, headful: true });
  setOutcome(appId, 'needs_you', outcome.reason, { shot: outcome.shot, answers: outcome.answers });
  return outcome;
}
