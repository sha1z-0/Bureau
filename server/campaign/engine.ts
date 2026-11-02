import { all, get, logEvent } from '../db.ts';
import { AppError, redact } from '../errors.ts';
import { bus, emit, type BusEvent } from '../services/bus.ts';
import type { Campaign } from '../contracts/campaign.ts';
import {
  campaignDay0,
  campaignDayIndex,
  campaignMeta,
  getCampaign,
  isDryRun,
  liveAt,
  listCampaigns,
  requireCampaign,
  setMeta,
  setStatus,
} from './campaigns.ts';
import { claimedByOthers, releaseAllClaims } from './claims.ts';
import type { EngineDeps } from './deps.ts';
import { isNotImplemented } from './deps.ts';
import { buildDigest, digestExists, digestTitle, markDigestSent, renderDigestEmailHtml, renderDigestTelegram, renderDigestText, saveDigest, type DigestContent } from './digest.ts';
import { allTaskRuns, loadPacket, markTask, recordStep, taskRun } from './journal.ts';
import { killState, setKillState, stopFilePresent, type KillSource, type KillState } from './kill.ts';
import { pipelineState, transition } from './pipeline.ts';
import { autopilotSettings, type AutopilotSettings } from './settings.ts';
import { hhmm, inEmployerHours, employerTimeZone, inWindow, isoWeek, localParts, localTimeOnDay, nextWindowStart, startOfLocalDay } from './time.ts';
import { withCampaign } from '../ai/claude.ts';
import { applyOne, HOLDER, recoverJob, type JobResult, type QueueItem } from './worker.ts';

/**
 * The autopilot. One `tick()` checks the kill switch and budgets, ends,
 * pauses or switches campaigns live as their dates and money require, starts
 * whichever background tasks are due (scout + match, profile sync, inbox,
 * weekly reports, questions, digests), and hands the next job to the single
 * apply worker when pacing, active hours and caps allow. `start()` runs ticks
 * on a timer; tests call `tick()` directly with a fake clock.
 */

export interface CurrentJob {
  jobId: string;
  campaignId: string;
  step: string;
  startedAt: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Deterministic 0..1 from a string, for cadence jitter that survives restarts. */
function unit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

export class Engine {
  readonly deps: EngineDeps;
  private readonly tickMs: number;
  private timer: unknown = null;
  private started = false;
  private ticking: Promise<void> | null = null;
  private tasks = new Map<string, Promise<void>>();
  private worker: Promise<JobResult> | null = null;
  private current: CurrentJob | null = null;
  private abortCtl = new AbortController();
  private nextApplyAt = 0;
  private wake = false;
  /** Campaigns whose next tick should scout regardless of cadence (start, resume, run now). */
  private scoutNow = new Set<string>();
  private lastSelect = new Map<string, number>();
  private unavailableLogged = new Set<string>();
  private busListener: ((e: BusEvent) => void) | null = null;

  constructor(deps: EngineDeps, opts: { tickMs?: number } = {}) {
    this.deps = deps;
    this.tickMs = opts.tickMs ?? 15_000;
  }

  private get clock() {
    return this.deps.clock;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Recover anything a previous process left mid-step, then tick on a timer. */
  start() {
    if (this.started) return;
    this.started = true;
    this.recover();
    this.busListener = (e: BusEvent) => {
      if (e.type === 'question.answered' && e.jobId) this.requeueAnswered(e.jobId, e.questionId);
    };
    bus.on('event', this.busListener);
    const loop = () => {
      this.timer = this.clock.setTimeout(() => {
        this.tick()
          .catch((err) => this.say(`Autopilot tick failed: ${redact((err as Error).message)}`, 'error'))
          .finally(() => {
            if (this.started) loop();
          });
      }, this.tickMs);
    };
    // First pass soon after boot, then on the cadence.
    this.timer = this.clock.setTimeout(() => {
      this.tick()
        .catch(() => undefined)
        .finally(() => {
          if (this.started) loop();
        });
    }, 2_000);
  }

  stop() {
    this.started = false;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.busListener) bus.off('event', this.busListener);
    this.busListener = null;
    this.deps.keepAwake.release();
  }

  /** Wait until every running task and the worker have finished (tests, shutdown). */
  async settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const pending = [...this.tasks.values(), ...(this.worker ? [this.worker] : []), ...(this.ticking ? [this.ticking] : [])];
      if (!pending.length) return;
      await Promise.allSettled(pending);
    }
  }

  /** Put every job a dead process left mid-step into a safe state. */
  recover(): { jobId: string; to: string }[] {
    releaseAllClaims(HOLDER);
    const rows = all<{ job_id: string; campaign_id: string | null }>(
      `SELECT p.job_id, p.campaign_id FROM pipeline p
        WHERE p.state IN ('writing', 'filling', 'verified')
          AND EXISTS (SELECT 1 FROM campaign_steps s WHERE s.job_id = p.job_id)`,
    );
    const out: { jobId: string; to: string }[] = [];
    for (const r of rows) {
      try {
        const to = recoverJob(r.job_id, r.campaign_id ? getCampaign(r.campaign_id) : null, this.clock.now());
        if (to) {
          out.push({ jobId: r.job_id, to });
          this.say(`Recovered an interrupted job after restart → ${to}`, to === 'needs_you' ? 'warn' : 'info', r.job_id);
        }
      } catch (err) {
        this.say(`Could not recover job ${r.job_id}: ${redact((err as Error).message)}`, 'error', r.job_id);
      }
    }
    return out;
  }

  // ── Activity ───────────────────────────────────────────────────────────────

  say(message: string, level: 'info' | 'warn' | 'error' = 'info', jobId?: string) {
    logEvent('campaign', message, jobId ?? null);
    emit({ type: 'activity', message, level, ...(jobId ? { jobId } : {}) });
  }

  private unavailable(stage: string) {
    if (this.unavailableLogged.has(stage)) return;
    this.unavailableLogged.add(stage);
    this.say(`The ${stage} is not available yet; that stage is skipped until it lands.`, 'warn');
  }

  private async alert(title: string, body: string, campaignId: string | null = null) {
    try {
      await this.deps.notify('alert', { title, body, campaignId });
    } catch {
      /* notify never blocks the engine */
    }
  }

  // ── The tick ───────────────────────────────────────────────────────────────

  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.tickOnce().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async tickOnce(): Promise<void> {
    const now = this.clock.now();
    const settings = autopilotSettings();

    if (stopFilePresent()) {
      if (!killState()) await this.kill('The data/STOP file is present', 'file');
      this.deps.keepAwake.release();
      return;
    }
    if (killState()) {
      this.deps.keepAwake.release();
      return;
    }

    const active = listCampaigns('active');
    if (active.length) {
      const b = this.deps.monthBudget();
      if (b.budgetUsd > 0 && b.spentUsd >= b.budgetUsd) {
        await this.kill(`The monthly AI budget of $${b.budgetUsd} is used up`, 'budget');
        return;
      }
    }

    const running: Campaign[] = [];
    for (const c of active) {
      if (now >= Date.parse(c.endsAt)) {
        await this.endCampaign(c.id, 'Reached its end date');
        continue;
      }
      if (now < Date.parse(c.startsAt)) continue;
      if (c.config.budgetUsd > 0) {
        const spent = this.deps.spendSince(new Date(campaignDay0(c)).toISOString(), c.id);
        if (spent >= c.config.budgetUsd) {
          setStatus(c.id, 'paused', `Campaign budget of $${c.config.budgetUsd} reached`, now);
          this.say(`Paused "${c.name}": its $${c.config.budgetUsd} budget is used up`, 'warn');
          await this.alert(`Campaign paused: ${c.name}`, `Its AI budget of $${c.config.budgetUsd} is used up ($${spent.toFixed(2)} spent). Raise it and resume to continue.`, c.id);
          continue;
        }
      }
      this.checkGoLive(c, now);
      running.push(c);
      this.campaignTasks(c, now);
      await this.maybeDigest(c, now, settings);
    }

    if (!running.length) {
      this.deps.keepAwake.release();
      return;
    }
    this.globalTasks(running, now, settings);
    this.updateAwake(running, now, settings);
    this.maybeStartWorker(running, now, settings);
  }

  // ── Background tasks ───────────────────────────────────────────────────────

  private runTask(scope: string, name: string, label: string, fn: () => Promise<unknown>) {
    const key = `${scope}:${name}`;
    if (this.tasks.has(key)) return;
    const p = (async () => {
      try {
        await fn();
        markTask(scope, name, this.clock.now(), { ok: true });
      } catch (err) {
        if (isNotImplemented(err)) {
          markTask(scope, name, this.clock.now(), { ok: false, error: 'unavailable' });
          this.unavailable(label);
          return;
        }
        if (err instanceof AppError && err.code === 'BUDGET') {
          markTask(scope, name, this.clock.now(), { ok: false, error: 'budget' });
          await this.kill(err.message, 'budget');
          return;
        }
        const message = redact((err as Error).message);
        markTask(scope, name, this.clock.now(), { ok: false, error: message });
        this.say(`${label} failed: ${message}`, 'warn');
      }
    })().finally(() => {
      this.tasks.delete(key);
    });
    this.tasks.set(key, p);
  }

  private due(scope: string, task: string, everyMs: number, now: number, jitter = 0): boolean {
    const last = taskRun(scope, task).lastRunAt;
    if (!last) return true;
    const factor = 1 - jitter * unit(`${scope}:${task}:${last}`);
    return now - Date.parse(last) >= everyMs * factor;
  }

  /** Scout → match → select for one campaign. */
  private campaignTasks(c: Campaign, now: number) {
    const every = c.config.scoutEveryHours * HOUR;
    // "Every 2–3 hours" at the default of 3: a 0–20% early jitter keeps it from looking like a cron job.
    if (this.scoutNow.has(c.id) || this.due(c.id, 'scout', every, now, 0.2)) {
      this.scoutNow.delete(c.id);
      this.runTask(c.id, 'scout', 'scout', async () => {
        try {
          const r = await this.deps.scout({ campaignId: c.id });
          this.say(`Scouted for "${c.name}": ${r.found} found, ${r.added.length} new`);
        } catch (err) {
          if (!isNotImplemented(err)) throw err;
          this.unavailable('scout');
        }
        if (killState()) return;
        await this.matchCampaign(c);
      });
    } else if (this.due(c.id, 'match', 30 * MIN, now) && this.deps.pendingForMatch(c.id).length) {
      // Jobs can arrive between scouts (v1 scanner, external agents): match them on a half-hour beat.
      this.runTask(c.id, 'match', 'matcher', () => this.matchCampaign(c));
    }
    const lastSel = this.lastSelect.get(c.id) ?? 0;
    if (now - lastSel >= 5 * MIN && !this.tasks.has(`${c.id}:scout`) && !this.tasks.has(`${c.id}:match`)) {
      this.lastSelect.set(c.id, now);
      this.select(c, now);
    }
  }

  private async matchCampaign(c: Campaign) {
    const ids = this.deps.pendingForMatch(c.id);
    if (ids.length) {
      try {
        const res = await this.deps.match(ids, c.config, { campaignId: c.id });
        this.say(`Matched ${res.length} role${res.length === 1 ? '' : 's'} for "${c.name}"`);
      } catch (err) {
        if (isNotImplemented(err)) this.unavailable('matcher');
        else throw err;
      }
    }
    this.select(c, this.clock.now());
  }

  /** Top the campaign's queue up to today's remaining room. */
  private select(c: Campaign, now: number) {
    const fresh = getCampaign(c.id);
    if (!fresh || fresh.status !== 'active' || killState()) return;
    const room = Math.min(this.roomFor(fresh, now), this.globalRoom(now));
    const queued =
      get<{ n: number }>("SELECT COUNT(*) AS n FROM pipeline WHERE campaign_id = ? AND state IN ('selected', 'writing', 'written')", c.id)?.n ?? 0;
    const slots = room - queued;
    if (slots <= 0) return;
    try {
      const chosen = this.deps.selectForCampaign(fresh.config, c.id, slots);
      if (chosen.length) this.say(`Queued ${chosen.length} role${chosen.length === 1 ? '' : 's'} for "${c.name}"`);
    } catch (err) {
      if (isNotImplemented(err)) this.unavailable('matcher');
      else this.say(`Selection failed for "${c.name}": ${redact((err as Error).message)}`, 'warn');
    }
  }

  private globalTasks(running: Campaign[], now: number, s: AutopilotSettings) {
    const tz = running[0].config.activeHours.tz;
    // Profile sync daily at 06:00 local.
    const syncAt = localTimeOnDay(now, tz, s.profileSyncAt);
    const lastSync = taskRun('global', 'profile_sync').lastRunAt;
    if (now >= syncAt && (!lastSync || Date.parse(lastSync) < syncAt)) {
      this.runTask('global', 'profile_sync', 'profile sync', async () => {
        const r = await this.deps.syncProfile();
        this.say(`Profile refreshed: ${r.added} new fact${r.added === 1 ? '' : 's'}`);
      });
    }
    // Inbox every few minutes.
    if (this.due('global', 'inbox', s.inboxEveryMinutes * MIN, now)) {
      this.runTask('global', 'inbox', 'inbox', async () => {
        const n = await this.deps.pollInbox();
        if (n) this.say(`Inbox: ${n} new message${n === 1 ? '' : 's'}`);
      });
    }
    // Weekly gap report and company discovery.
    const p = localParts(now, tz);
    const isoDay = p.weekday === 0 ? 7 : p.weekday;
    const weekStart = startOfLocalDay(now, tz) - (isoDay - 1) * 24 * HOUR;
    const weeklyAt = weekStart + (s.weeklyDay - 1) * 24 * HOUR + hhmm(s.weeklyAt) * MIN;
    for (const [task, label, fn] of [
      ['gap_report', 'weekly gap report', async () => void (await this.deps.buildGapReport(isoWeek(now, tz)))],
      ['discovery', 'company discovery', async () => void (await this.deps.discoverCompanies({ campaignId: running[0].id }))],
    ] as const) {
      const last = taskRun('global', task).lastRunAt;
      if (now >= weeklyAt && (!last || Date.parse(last) < weeklyAt)) this.runTask('global', task, label, fn);
    }
    // Recipe compile and shadow jobs (A06), a few times a day.
    if (this.due('global', 'recipes', 6 * HOUR, now)) this.runTask('global', 'recipes', 'recipe learning jobs', () => this.deps.recipeJobs());
    // New unknown questions to Telegram, every tick (cheap when there are none).
    if (!this.tasks.has('global:questions')) {
      const p2 = this.deps
        .pushQuestions()
        .then((n) => {
          if (n) this.say(`Sent ${n} new question${n === 1 ? '' : 's'} to Telegram`);
        })
        .catch(() => undefined)
        .finally(() => this.tasks.delete('global:questions'));
      this.tasks.set('global:questions', p2);
    }
  }

  private updateAwake(running: Campaign[], now: number, s: AutopilotSettings) {
    const inHours = running.some((c) => inWindow(now, c.config.activeHours));
    if (s.keepAwake && inHours) this.deps.keepAwake.hold();
    else this.deps.keepAwake.release();
  }

  // ── Caps ───────────────────────────────────────────────────────────────────

  /** Applications (live + rehearsed) the campaign made on its local day. */
  doneToday(c: Campaign, now: number): number {
    const from = startOfLocalDay(now, c.config.activeHours.tz);
    const to = startOfLocalDay(from + 30 * HOUR, c.config.activeHours.tz);
    return (
      get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM campaign_steps WHERE campaign_id = ? AND step IN ('submitted', 'rehearsed') AND status = 'ok' AND ts >= ? AND ts < ?",
        c.id,
        new Date(from).toISOString(),
        new Date(to).toISOString(),
      )?.n ?? 0
    );
  }

  roomFor(c: Campaign, now: number): number {
    return Math.max(0, c.config.dailyCap - this.doneToday(c, now));
  }

  /** The global cap counts every campaign's work on the server's local day. */
  globalRoom(now: number): number {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const from = startOfLocalDay(now, tz);
    const to = startOfLocalDay(from + 30 * HOUR, tz);
    const done =
      get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM campaign_steps WHERE step IN ('submitted', 'rehearsed') AND status = 'ok' AND ts >= ? AND ts < ?",
        new Date(from).toISOString(),
        new Date(to).toISOString(),
      )?.n ?? 0;
    return Math.max(0, autopilotSettings().globalDailyCap - done);
  }

  // ── The apply worker ───────────────────────────────────────────────────────

  private maybeStartWorker(running: Campaign[], now: number, s: AutopilotSettings) {
    if (this.worker) return;
    if (!this.wake && now < this.nextApplyAt) return;
    if (this.globalRoom(now) <= 0) return;
    const eligible = running
      .filter((c) => inWindow(now, c.config.activeHours) && this.roomFor(c, now) > 0)
      .sort((a, b) => this.doneToday(a, now) / Math.max(1, a.config.dailyCap) - this.doneToday(b, now) / Math.max(1, b.config.dailyCap));
    for (const c of eligible) {
      const jobId = this.pickJob(c, now, s);
      if (!jobId) continue;
      this.wake = false;
      this.runJob({ jobId, campaign: c }, now, s);
      return;
    }
  }

  /** Next job for a campaign: finished packets first, then priority and score, preferring employers in business hours. */
  pickJob(c: Campaign, now: number, s: AutopilotSettings): string | null {
    const others = claimedByOthers(HOLDER);
    const rows = all<{ job_id: string; location: string | null }>(
      `SELECT p.job_id, j.location FROM pipeline p JOIN jobs j ON j.id = p.job_id
        WHERE p.campaign_id = ?
          AND (p.state IN ('selected', 'written')
               OR (p.state = 'failed' AND p.attempts < ? AND p.next_action_at IS NOT NULL AND p.next_action_at <= ?))
        ORDER BY CASE p.state WHEN 'written' THEN 0 WHEN 'selected' THEN 1 ELSE 2 END,
                 j.priority DESC,
                 COALESCE(CASE WHEN json_valid(j.match) THEN json_extract(j.match, '$.screenPassScore') END, j.ai_score, 0) DESC,
                 p.updated_at ASC, p.job_id ASC
        LIMIT 25`,
      c.id,
      s.maxAttempts,
      new Date(now).toISOString(),
    ).filter((r) => !others.has(r.job_id));
    if (!rows.length) return null;
    if (!s.preferEmployerHours) return rows[0].job_id;
    // Known zone and outside its business hours → after everything else.
    const ranked = [...rows].sort((a, b) => {
      const ka = inEmployerHours(now, employerTimeZone(a.location)) === false ? 1 : 0;
      const kb = inEmployerHours(now, employerTimeZone(b.location)) === false ? 1 : 0;
      return ka - kb;
    });
    return ranked[0].job_id;
  }

  private runJob(item: QueueItem, now: number, s: AutopilotSettings) {
    const live = !isDryRun(item.campaign, now);
    this.current = { jobId: item.jobId, campaignId: item.campaign.id, step: 'Starting', startedAt: new Date(now).toISOString() };
    emit({ type: 'hunt', status: 'running', step: 'Applying' });
    const signal = this.abortCtl.signal;
    this.worker = withCampaign(item.campaign.id, () => applyOne(
      {
        deps: this.deps,
        live,
        signal,
        maxAttempts: s.maxAttempts,
        say: (m, level, jobId) => this.say(m, level, jobId),
        unavailable: (stage) => this.unavailable(stage),
        breach: async (c, message) => {
          try {
            setStatus(c.id, 'paused', message, this.clock.now());
          } catch {
            /* already paused or ended */
          }
          this.say(message, 'error');
          await this.alert(`Campaign paused: ${c.name}`, message, c.id);
        },
        // Not awaited: kill() waits for this very worker to finish.
        budget: async (message) => {
          void this.kill(message, 'budget');
        },
        setStep: (step) => {
          if (this.current) this.current.step = step;
          emit({ type: 'hunt', status: 'running', step });
        },
      },
      item,
    ))
      .catch((err): JobResult => {
        this.say(`Unexpected error on a job: ${redact((err as Error).message)}`, 'error', item.jobId);
        void this.alert('Campaign error', `Something went wrong applying to a job: ${redact((err as Error).message)}`, item.campaign.id);
        return 'worked';
      })
      .then((result) => {
        const t = this.clock.now();
        const { min, max } = item.campaign.config.pacingMinutes;
        // Human pacing after real work; a short breather after a skip or an unavailable stage.
        const gap = result === 'worked' ? (min + this.clock.random() * (max - min)) * MIN : result === 'unavailable' ? 15 * MIN : 30_000;
        this.nextApplyAt = Math.max(this.nextApplyAt, t + gap);
        return result;
      })
      .finally(() => {
        this.current = null;
        this.worker = null;
        emit({ type: 'hunt', status: 'idle' });
      });
  }

  // ── Dry run → live ─────────────────────────────────────────────────────────

  private checkGoLive(c: Campaign, now: number) {
    if (c.config.dryRunDays <= 0) return;
    const meta = campaignMeta(c.id);
    if (meta.rehearseOnly || meta.liveSince || isDryRun(c, now)) return;
    setMeta(c.id, { liveSince: new Date(now).toISOString() });
    const rows = all<{ job_id: string }>("SELECT job_id FROM pipeline WHERE campaign_id = ? AND state = 'rehearsed'", c.id);
    let requeued = 0;
    for (const r of rows) {
      try {
        transition(r.job_id, loadPacket(r.job_id) ? 'written' : 'selected', { reason: 'Dry run over: queued for a live submit' });
        recordStep(now, { campaignId: c.id, jobId: r.job_id, step: 'requeue', status: 'go_live' });
        requeued++;
      } catch {
        /* moved meanwhile */
      }
    }
    const msg = `"${c.name}" finished its ${c.config.dryRunDays}-day dry run and is now live. ${requeued} rehearsed role${requeued === 1 ? '' : 's'} queued to be sent for real.`;
    this.say(msg);
    emit({ type: 'campaign.status', campaignId: c.id, status: 'active', message: 'Dry run over: live' });
    void this.deps.notify('info', { title: `Live: ${c.name}`, body: msg, campaignId: c.id })?.catch?.(() => undefined);
  }

  // ── Digests ────────────────────────────────────────────────────────────────

  private async maybeDigest(c: Campaign, now: number, s: AutopilotSettings) {
    const tz = c.config.activeHours.tz;
    // Round-the-clock campaigns report just before midnight; others just after their window closes.
    const end = c.config.activeHours.start === c.config.activeHours.end ? '23:30' : c.config.activeHours.end;
    const at = Math.min(localTimeOnDay(now, tz, end) + s.digestDelayMinutes * MIN, startOfLocalDay(now, tz) + 24 * HOUR - MIN);
    if (now < at) return;
    const date = localParts(now, tz).date;
    const firstActive = campaignMeta(c.id).firstActiveAt;
    if (firstActive && Date.parse(firstActive) > at) return; // started after today's digest time
    if (digestExists(c.id, date)) return;
    if (this.tasks.has(`${c.id}:digest`)) return;
    this.runTask(c.id, 'digest', 'daily digest', () => this.sendDigest(c, now, false));
  }

  async sendDigest(c: Campaign | null, now: number, final: boolean): Promise<{ id: string; content: DigestContent; via: string[] }> {
    const content = buildDigest(c, now, { final, sourceHealth: () => this.deps.sourceHealth() });
    const id = saveDigest(content);
    let via: string[] = [];
    try {
      const res = await this.deps.notify('digest', {
        title: digestTitle(content),
        body: renderDigestText(content),
        html: renderDigestTelegram(content),
        emailHtml: renderDigestEmailHtml(content),
        campaignId: c?.id ?? null,
      });
      via = res && 'via' in res ? res.via : [];
    } catch {
      via = [];
    }
    markDigestSent(id, via, c?.id ?? null);
    this.say(`${final ? 'Final digest' : 'Digest'} for ${c ? `"${c.name}"` : 'all campaigns'}${via.length ? ` sent via ${via.join(', ')}` : ' saved'}`);
    return { id, content, via };
  }

  // ── Owner actions ──────────────────────────────────────────────────────────

  startCampaign(id: string): Campaign {
    if (stopFilePresent()) throw new AppError(409, 'STOP_FILE', 'Delete data/STOP before starting a campaign.');
    const c = requireCampaign(id);
    if (Date.parse(c.endsAt) <= this.clock.now()) throw new AppError(409, 'PAST_END', 'This campaign’s end date has passed. Move it later first.');
    setKillState(null);
    const out = setStatus(id, 'active', 'Started', this.clock.now());
    this.say(`Campaign "${c.name}" started${isDryRun(out, this.clock.now()) ? ' in dry-run mode' : ''}`);
    this.wake = true;
    this.scoutNow.add(id);
    void this.tick().catch(() => undefined);
    return out;
  }

  pauseCampaign(id: string, reason = 'Paused by you'): Campaign {
    const c = setStatus(id, 'paused', reason, this.clock.now());
    this.say(`Campaign "${c.name}" paused: ${reason}`);
    return c;
  }

  resumeCampaign(id: string): Campaign {
    if (stopFilePresent()) throw new AppError(409, 'STOP_FILE', 'Delete data/STOP before resuming.');
    const cur = requireCampaign(id);
    if (cur.status === 'draft') return this.startCampaign(id);
    if (Date.parse(cur.endsAt) <= this.clock.now()) throw new AppError(409, 'PAST_END', 'This campaign’s end date has passed.');
    setKillState(null);
    const c = setStatus(id, 'active', 'Resumed', this.clock.now());
    this.say(`Campaign "${c.name}" resumed`);
    this.wake = true;
    void this.tick().catch(() => undefined);
    return c;
  }

  async endCampaign(id: string, reason = 'Ended by you'): Promise<{ campaign: Campaign; digestId: string | null }> {
    const cur = requireCampaign(id);
    if (cur.status === 'ended') return { campaign: cur, digestId: campaignMeta(id).finalDigestId };
    const c = setStatus(id, 'ended', reason, this.clock.now());
    this.say(`Campaign "${c.name}" ended: ${reason}`);
    let digestId: string | null = null;
    try {
      const d = await this.sendDigest(c, this.clock.now(), true);
      digestId = d.id;
      setMeta(id, { finalDigestId: d.id });
    } catch (err) {
      this.say(`Final digest failed: ${redact((err as Error).message)}`, 'warn');
    }
    return { campaign: c, digestId };
  }

  /** v1 "stop": finish the current application, then wait one full pacing gap. */
  softStop() {
    const c = listCampaigns('active')[0];
    const max = c?.config.pacingMinutes.max ?? 30;
    this.nextApplyAt = Math.max(this.nextApplyAt, this.clock.now() + max * MIN);
    this.wake = false;
  }

  /** Scout and apply now, skipping the pacing wait once. */
  runNow() {
    this.wake = true;
    for (const c of listCampaigns('active')) this.scoutNow.add(c.id);
    this.nextApplyAt = 0;
    void this.tick().catch(() => undefined);
  }

  /** An answered question re-queues the job that asked it. */
  requeueAnswered(jobId: string, questionId?: string) {
    const row = pipelineState(jobId);
    if (!row) return;
    // Wait until every question this job raised is answered; re-filling earlier would only stop at the next one.
    if (get("SELECT 1 FROM unknown_questions WHERE job_id = ? AND status = 'open'", jobId)) return;
    try {
      let to: 'written' | 'selected' | null = null;
      if (row.state === 'needs_you') to = loadPacket(jobId) ? 'written' : 'selected';
      else if (row.state === 'skipped') to = 'selected';
      if (!to) return;
      transition(jobId, to, { reason: 'Question answered: queued again' });
      recordStep(this.clock.now(), { campaignId: row.campaignId, jobId, step: 'requeue', status: 'answered', detail: { questionId: questionId ?? null } });
      this.say('A question was answered; the job is queued again', 'info', jobId);
    } catch (err) {
      this.say(`Could not re-queue after an answer: ${redact((err as Error).message)}`, 'warn', jobId);
    }
  }

  // ── Kill switch ────────────────────────────────────────────────────────────

  /**
   * Stop everything: abort the running fill (the form engine closes its
   * browser on abort), pause every active campaign, run the close hooks and
   * release keep-awake. Resolves within 5 seconds.
   */
  async kill(reason: string, source: KillSource): Promise<{ ms: number; settled: boolean; state: KillState }> {
    const t0 = Date.now();
    const state: KillState = { at: new Date(this.clock.now()).toISOString(), reason, source };
    setKillState(state);
    this.abortCtl.abort(new Error(`Kill switch: ${reason}`));
    for (const c of listCampaigns('active')) {
      try {
        setStatus(c.id, 'paused', `Kill switch: ${reason}`, this.clock.now());
      } catch {
        /* raced */
      }
    }
    this.deps.keepAwake.release();
    const worker = this.worker;
    let timer: NodeJS.Timeout | undefined;
    const settled = await Promise.race([
      Promise.all([worker ?? Promise.resolve(), this.deps.closeBrowsers(reason).catch(() => undefined)]).then(() => true),
      new Promise<boolean>((r) => {
        timer = setTimeout(() => r(false), 4500);
      }),
    ]);
    clearTimeout(timer);
    this.abortCtl = new AbortController();
    this.nextApplyAt = 0;
    this.say(`Kill switch (${source}): ${reason}. Everything is stopped.`, 'error');
    void this.alert('Kill switch', `${reason}. All campaigns are paused. Resume one to continue.`);
    return { ms: Date.now() - t0, settled, state };
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  status() {
    const now = this.clock.now();
    return {
      now: new Date(now).toISOString(),
      kill: killState(),
      stopFile: stopFilePresent(),
      current: this.current,
      nextApplyAt: this.nextApplyAt ? new Date(this.nextApplyAt).toISOString() : null,
      awake: this.deps.keepAwake.held,
      tasksRunning: [...this.tasks.keys()],
      globalTasks: allTaskRuns('global'),
      globalRoom: this.globalRoom(now),
      settings: autopilotSettings(),
    };
  }

  campaignStats(c: Campaign) {
    const now = this.clock.now();
    const tz = c.config.activeHours.tz;
    const counts = Object.fromEntries(all<{ state: string; n: number }>('SELECT state, COUNT(*) AS n FROM pipeline WHERE campaign_id = ? GROUP BY state', c.id).map((r) => [r.state, r.n]));
    const from = new Date(startOfLocalDay(now, tz)).toISOString();
    const today = Object.fromEntries(
      all<{ step: string; n: number }>(
        "SELECT step, COUNT(*) AS n FROM campaign_steps WHERE campaign_id = ? AND ts >= ? AND status = 'ok' AND step IN ('submitted', 'rehearsed', 'skip', 'requeue') GROUP BY step",
        c.id,
        from,
      ).map((r) => [r.step, r.n]),
    );
    const meta = campaignMeta(c.id);
    const tasks = allTaskRuns(c.id);
    const lastScout = tasks.scout?.lastRunAt;
    const open = inWindow(now, c.config.activeHours);
    return {
      counts,
      today: { submitted: today.submitted ?? 0, rehearsed: today.rehearsed ?? 0, done: this.doneToday(c, now), cap: c.config.dailyCap, room: this.roomFor(c, now) },
      dryRun: {
        active: c.status !== 'ended' && isDryRun(c, now),
        day: campaignDayIndex(c, now) + 1,
        days: c.config.dryRunDays,
        liveAt: liveAt(c),
        liveSince: meta.liveSince,
        rehearseOnly: meta.rehearseOnly,
      },
      spend: { campaignUsd: Math.round(this.deps.spendSince(new Date(campaignDay0(c)).toISOString(), c.id) * 100) / 100, budgetUsd: c.config.budgetUsd },
      activeHours: { open, nextOpenAt: open ? null : new Date(nextWindowStart(now, c.config.activeHours)).toISOString() },
      nextScoutAt: c.status === 'active' ? (lastScout ? new Date(Date.parse(lastScout) + c.config.scoutEveryHours * HOUR * 0.8).toISOString() : 'soon') : null,
      nextApplyAt: c.status === 'active' && this.nextApplyAt ? new Date(Math.max(this.nextApplyAt, now)).toISOString() : null,
      tasks,
      meta,
    };
  }
}
