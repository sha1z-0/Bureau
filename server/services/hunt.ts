import type { Browser } from 'playwright-core';
import { aiSettings, apiKey } from '../ai/claude.ts';
import { unitCosts } from '../ai/cost.ts';
import { draftApplication } from '../ai/tailor.ts';
import { all, get, getSetting, logEvent, now, run, setSetting } from '../db.ts';
import { AppError, redact } from '../errors.ts';
import { highIssues, loadApplication, sendByEmail } from './applications.ts';
import { browserAvailable, launchBrowser } from './browser.ts';
import { emit } from './bus.ts';
import { applyUrlFor, applyViaForm } from './formFiller.ts';
import { smtpSettings } from './mailer.ts';
import { loadProfile } from './profileStore.ts';
import { currentScan, scanAndWait } from './scanner.ts';
import { secretHint } from '../security/vault.ts';

/**
 * The hunt: Bureau's autonomous loop. On a timer it scouts every source,
 * has Claude assess what's new, and for each role above your bar tailors the
 * CV and letter, repairs anything the fact lock flags, and applies by email or
 * through the company's own form. What it can't finish honestly (a CAPTCHA, a
 * question only you can answer) goes to "Needs you", already filled in.
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

export function huntSettings(): HuntSettings {
  const saved = getSetting<Partial<HuntSettings>>('hunt', {});
  return { ...DEFAULT_HUNT, ...saved, channels: { ...DEFAULT_HUNT.channels, ...(saved.channels ?? {}) } };
}

export function saveHuntSettings(next: HuntSettings) {
  setSetting('hunt', next);
}

let cycle: { startedAt: string; step: string } | null = null;
let stopRequested = false;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function appliedToday(): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE auto = 1 AND status = 'sent' AND sent_at >= ?", startOfToday())?.n ?? 0;
}

function say(message: string, jobId: string | null = null) {
  logEvent('hunt', message, jobId);
  emit({ type: 'activity', message });
}

function step(s: string) {
  if (cycle) cycle.step = s;
  emit({ type: 'hunt', status: 'running', step: s });
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
  const last = getSetting<{ at: string; summary: string } | null>('hunt.last', null);
  const since = startOfToday();
  const count = (status: string) =>
    get<{ n: number }>('SELECT COUNT(*) AS n FROM applications WHERE auto = 1 AND status = ? AND updated_at >= ?', status, since)?.n ?? 0;
  const lastAt = last ? new Date(last.at).getTime() : 0;
  return {
    settings: s,
    running: cycle,
    last,
    nextRunAt: s.enabled ? new Date(Math.max(Date.now(), lastAt + s.intervalHours * 3_600_000)).toISOString() : null,
    today: { applied: appliedToday(), rehearsed: count('rehearsed'), needsYou: count('needs_you'), failed: count('failed') },
    needsYouTotal: get<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE status = 'needs_you'")?.n ?? 0,
    readiness: await huntReadiness(),
    costs: { ...unitCosts(), budget: aiSettings().monthlyBudgetUsd },
  };
}

export function stopHunt() {
  stopRequested = true;
}

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

/** Tailor, repair, and apply for one role. Returns true if an application went out. */
async function pursue(job: Target, s: HuntSettings, getBrowser: () => Promise<Browser>): Promise<boolean> {
  say(`Tailoring for ${job.title} at ${job.company} (${job.ai_score})`, job.id);
  let appId = await draftApplication(job.id);
  let app = loadApplication(appId);

  // The fact lock is a gate, not a suggestion. Ask Claude to fix what it flagged, once.
  if (highIssues(app) > 0) {
    const issues = (JSON.parse(app.notes).issues as { claim: string; severity: string }[]).filter((i) => i.severity === 'high').map((i) => i.claim);
    say(`Fact lock flagged ${issues.length} claim(s); rewriting without them`, job.id);
    appId = await draftApplication(job.id, `Your previous draft included claims the CV does not support: ${issues.join('; ')}. Remove them entirely. Use only facts from the CV.`);
    app = loadApplication(appId);
    if (highIssues(app) > 0) {
      setOutcome(appId, 'needs_you', 'The fact lock still finds unsupported claims. Review the draft before it goes out.');
      say(`Held back ${job.title}: fact lock not clean`, job.id);
      return false;
    }
  }

  const live = s.mode === 'live';
  const emailReady = !!smtpSettings() && secretHint('smtp_password').set;

  if (s.channels.email && job.apply_email && emailReady) {
    run("UPDATE applications SET channel = 'email', to_email = ? WHERE id = ?", job.apply_email, appId);
    if (!live) {
      setOutcome(appId, 'rehearsed', `Rehearsal: would email ${job.apply_email}.`);
      return false;
    }
    run("UPDATE applications SET status = 'approved', auto = 1 WHERE id = ?", appId);
    try {
      await sendByEmail(appId, 'autopilot');
      say(`Applied by email to ${job.company} — ${job.title}`, job.id);
      return true;
    } catch (err) {
      setOutcome(appId, 'failed', `Email failed: ${redact((err as Error).message)}`);
      return false;
    }
  }

  if (s.channels.forms && applyUrlFor(job)) {
    run("UPDATE applications SET channel = 'ats' WHERE id = ?", appId);
    const outcome = await applyViaForm(loadApplication(appId), job, { submit: live, browser: await getBrowser() });
    if (outcome.status === 'submitted') {
      run("UPDATE applications SET status = 'sent', sent_at = ?, reason = ?, shot = ?, answers = ?, auto = 1, updated_at = ? WHERE id = ?",
        now(), outcome.reason, outcome.shot, JSON.stringify(outcome.answers), now(), appId);
      run("UPDATE jobs SET stage = 'applied', updated_at = ? WHERE id = ?", now(), job.id);
      say(`Applied through ${job.company}'s form — ${job.title}`, job.id);
      emit({ type: 'application', id: appId, status: 'sent' });
      return true;
    }
    setOutcome(appId, outcome.status, outcome.reason, { shot: outcome.shot, answers: outcome.answers });
    say(`${outcome.status === 'rehearsed' ? 'Rehearsed' : 'Needs you'}: ${job.title} at ${job.company}. ${outcome.reason}`, job.id);
    return false;
  }

  setOutcome(appId, 'needs_you', 'No automatic route: this role wants a DM or a channel Bureau can’t reach. Message and CV are ready.');
  return false;
}

export async function runHuntCycle(trigger: 'timer' | 'manual'): Promise<void> {
  if (cycle) throw new AppError(409, 'HUNT_RUNNING', 'The hunt is already under way.');
  if (!apiKey()) throw new AppError(412, 'NO_API_KEY', 'Add your Claude API key first.');
  if (!loadProfile()) throw new AppError(412, 'NO_PROFILE', 'Upload your CV first.');
  const s = huntSettings();
  cycle = { startedAt: now(), step: 'Scouting' };
  stopRequested = false;
  let browser: Browser | null = null;
  const getBrowser = async () => (browser ??= await launchBrowser(true));
  let applied = 0;
  let considered = 0;
  emit({ type: 'hunt', status: 'running', step: 'Scouting' });
  say(`Hunt ${trigger === 'manual' ? 'started' : 'woke up'}: scouting every source`);

  void (async () => {
    try {
      if (!currentScan()) await scanAndWait('sources', { scoreLimit: s.assessPerCycle });
      if (stopRequested) return;

      const room = s.mode === 'live' ? Math.max(0, s.dailyCap - appliedToday()) : s.dailyCap;
      if (room === 0) {
        say(`Daily cap of ${s.dailyCap} reached. Resting until tomorrow.`);
        return;
      }
      step('Applying');
      const targets = all<Target>(
        `SELECT j.id, j.title, j.company, j.source, j.external_id, j.url, j.description_text, j.apply_email, j.ai_score
         FROM jobs j
         WHERE j.ai_score >= ? AND j.status != 'dismissed' AND j.stage IN ('found', 'drafted')
           AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND a.status IN ('sent', 'needs_you', 'rehearsed', 'failed', 'approved'))
         ORDER BY j.ai_score DESC, j.found_at DESC
         LIMIT ?`,
        s.applyThreshold,
        room * 2,
      );
      if (!targets.length) say(`No new roles at or above ${s.applyThreshold} this round.`);
      for (const job of targets) {
        if (stopRequested || applied >= room) break;
        considered++;
        try {
          if (await pursue(job, s, getBrowser)) applied++;
        } catch (err) {
          say(`Skipped ${job.title} at ${job.company}: ${redact((err as Error).message)}`, job.id);
          if (err instanceof AppError && ['BUDGET', 'AI_AUTH', 'NO_API_KEY'].includes(err.code)) break;
        }
      }
    } catch (err) {
      say(`Hunt stopped: ${redact((err as Error).message)}`);
    } finally {
      await (browser as Browser | null)?.close().catch(() => {});
      const summary = `${applied} applied, ${considered} pursued${stopRequested ? ' (stopped early)' : ''}`;
      setSetting('hunt.last', { at: now(), summary });
      say(`Hunt round finished: ${summary}`);
      cycle = null;
      emit({ type: 'hunt', status: 'idle' });
      emit({ type: 'jobs-changed' });
    }
  })();
}

/** Wakes the hunt every few minutes and starts a round once the interval has passed. */
export function startHuntTimer() {
  const tick = () => {
    const s = huntSettings();
    if (!s.enabled || cycle || currentScan()) return;
    const last = getSetting<{ at: string } | null>('hunt.last', null);
    if (last && Date.now() - new Date(last.at).getTime() < s.intervalHours * 3_600_000) return;
    runHuntCycle('timer').catch((err) => say(`Hunt couldn't start: ${(err as Error).message}`));
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 3 * 60_000).unref();
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
