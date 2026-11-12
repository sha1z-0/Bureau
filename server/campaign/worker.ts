import { get, now as dbNow, run } from '../db.ts';
import { AppError, redact } from '../errors.ts';
import { emit } from '../services/bus.ts';
import type { Campaign } from '../contracts/campaign.ts';
import type { FillOutcome } from '../contracts/forms.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { activityFor, byCompany, maybeSentSql, recentSubmissions } from '../match/companies.ts';
import { activeClaim, claimJob, releaseClaim } from './claims.ts';
import type { EngineDeps } from './deps.ts';
import { isNotImplemented } from './deps.ts';
import { lastOutcome, loadPacket, openSubmitIntent, recordStep, savePacket } from './journal.ts';
import { pipelineState, transition } from './pipeline.ts';
import { ruledOutNow } from './refilter.ts';
import { backoffMs } from './settings.ts';

/**
 * One application, start to finish: write → route → fill → verify → submit.
 *
 * Double-submit safety rests on three rules:
 *  1. A `submit_intent` row is committed BEFORE any live submit or email starts,
 *     and a result row after. Recovery treats an intent with no result as
 *     "maybe sent": the job goes to needs_you, never back into the queue.
 *  2. `submitted` is terminal in the state machine, and the job, its
 *     application row and same-posting/same-company submissions are re-checked
 *     right before the irreversible step.
 *  3. A claim (holder `autopilot`) is held for the whole run, so an external
 *     agent cannot apply to the same job at the same time.
 */

export const HOLDER = 'autopilot';
const CLAIM_MINUTES = 30;

export interface QueueItem {
  jobId: string;
  campaign: Campaign;
}

export interface WorkerCtx {
  deps: EngineDeps;
  live: boolean;
  signal: AbortSignal;
  maxAttempts: number;
  say(message: string, level?: 'info' | 'warn' | 'error', jobId?: string): void;
  /** A stage whose module is not built yet. Logged once by the engine. */
  unavailable(stage: string): void;
  /** Serious, owner-facing problem (pauses the campaign). */
  breach(campaign: Campaign, message: string): Promise<void>;
  /** Budget exhausted somewhere downstream. */
  budget(message: string): Promise<void>;
  setStep(step: string): void;
}

export type JobResult = 'worked' | 'quick' | 'unavailable' | 'stopped';

interface JobRow {
  id: string;
  title: string;
  company: string;
  apply_email: string | null;
  url: string;
  apply_url_canonical: string | null;
}

const job = (id: string) => get<JobRow>('SELECT id, title, company, apply_email, url, apply_url_canonical FROM jobs WHERE id = ?', id);

export function applicationSent(jobId: string): string | null {
  return get<{ id: string }>("SELECT id FROM applications WHERE job_id = ? AND status IN ('sent', 'submitted') LIMIT 1", jobId)?.id ?? null;
}

function updateApplication(appId: string | null, status: string, fields: { reason?: string; shot?: string | null; answers?: unknown; channel?: string; campaignId?: string | null; sent?: boolean }) {
  if (!appId) return;
  run(
    `UPDATE applications SET status = ?, reason = COALESCE(?, reason), shot = COALESCE(?, shot), answers = COALESCE(?, answers),
       channel = COALESCE(?, channel), campaign_id = COALESCE(?, campaign_id), auto = 1,
       sent_at = CASE WHEN ? THEN ? ELSE sent_at END, updated_at = ? WHERE id = ?`,
    status,
    fields.reason ?? null,
    fields.shot ?? null,
    fields.answers === undefined ? null : JSON.stringify(fields.answers),
    fields.channel ?? null,
    fields.campaignId ?? null,
    fields.sent ? 1 : 0,
    dbNow(),
    dbNow(),
    appId,
  );
  emit({ type: 'application', id: appId, status });
}

const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;

/** Sites Bureau never applies on (logged-in automation breaks their terms); the form engine refuses them too. */
const NOT_AUTOMATED = /^https?:\/\/([a-z0-9-]+\.)*(linkedin|indeed)\.[a-z.]+\//i;
/** A discussion thread (HN "Who is hiring", Reddit) holds no form; with no email in it, there is nothing to send. */
const THREAD_PAGE = /^https?:\/\/(news\.ycombinator\.com\/item|(www\.|old\.)?reddit\.com\/r\/)/i;
/**
 * Remote-job boards whose listing pages only link out to the employer (first live night: none of seven went through;
 * Cloudflare walls or an off-site apply button). Used when the resolver found no employer form for the listing.
 */
const LINK_OUT_BOARD = /^https?:\/\/(www\.)?(remoteok\.com|weworkremotely\.com|himalayas\.app|jobicy\.com|4dayweek\.io|workingnomads\.com|remotive\.com|jobspresso\.co|python\.org\/jobs|larajobs\.com)\//i;

export type Route ={ kind: 'email'; to: string } | { kind: 'form'; url: string } | { kind: 'none'; reason: string };

export function chooseRoute(j: JobRow, c: Campaign, emailReady: boolean): Route {
  const ch = c.config.channels;
  if (ch.email && j.apply_email && EMAIL_RE.test(j.apply_email) && emailReady) return { kind: 'email', to: j.apply_email };
  // Canonical links stored before the case fix lowercased Ashby slugs: when the two differ only in case, the original works.
  const url = j.apply_url_canonical && j.apply_url_canonical.toLowerCase() === j.url.toLowerCase() ? j.url : j.apply_url_canonical || j.url;
  if (ch.forms && url && /^https?:\/\//i.test(url)) return { kind: 'form', url };
  if (ch.email && j.apply_email && !emailReady) return { kind: 'none', reason: 'This role applies by email and no email account is connected.' };
  return { kind: 'none', reason: 'No automatic route: no form this campaign may use and no email address.' };
}

/** Same posting or same company already submitted inside the cooldown. Null when clear. */
export function uniquenessProblem(jobId: string, c: Campaign, nowMs: number): string | null {
  const j = job(jobId);
  if (!j) return 'The job no longer exists.';
  if (j.apply_url_canonical) {
    const dup = get<{ job_id: string }>(
      `SELECT p.job_id FROM pipeline p JOIN jobs x ON x.id = p.job_id
        WHERE x.apply_url_canonical = ? AND p.job_id != ? AND (p.state = 'submitted' OR (p.state = 'needs_you' AND ${maybeSentSql('p.job_id')})) LIMIT 1`,
      j.apply_url_canonical,
      jobId,
    );
    if (dup) return 'Already applied to this posting (duplicate listing).';
  }
  const days = c.config.companyCooldownDays;
  if (days > 0) {
    // Pipeline timestamps are wall-clock, so the window is too (as in the matcher's selection).
    void nowMs;
    const index = byCompany(recentSubmissions(days, new Date().toISOString()));
    const hit = activityFor(index, { companyId: (get<{ company_id: string | null }>('SELECT company_id FROM jobs WHERE id = ?', jobId)?.company_id ?? null), company: j.company, jobId });
    if (hit.length) return `Applied to ${hit[0].company} on ${hit[0].at.slice(0, 10)} (cooldown ${days} days).`;
  }
  return null;
}

function failJob(ctx: WorkerCtx, item: QueueItem, message: string, appId: string | null) {
  const cur = pipelineState(item.jobId);
  const attempts = (cur?.attempts ?? 0) + 1;
  const giveUp = attempts >= ctx.maxAttempts;
  const at = ctx.deps.clock.now() + backoffMs(attempts);
  transition(item.jobId, 'failed', {
    reason: giveUp ? `${message} (gave up after ${attempts} attempts)` : message,
    error: message,
    countAttempt: true,
    nextActionAt: giveUp ? null : new Date(at).toISOString(),
  });
  updateApplication(appId, 'failed', { reason: message });
  ctx.say(`${giveUp ? 'Gave up on' : 'Will retry'} ${label(item.jobId)}: ${message}`, 'warn', item.jobId);
}

const label = (jobId: string) => {
  const j = job(jobId);
  return j ? `${j.title} at ${j.company}` : jobId;
};

/** Process one queued job. Never throws for job-level problems. */
export async function applyOne(ctx: WorkerCtx, item: QueueItem): Promise<JobResult> {
  const { deps } = ctx;
  const clock = deps.clock;
  const campaignId = item.campaign.id;
  const jobId = item.jobId;
  const j = job(jobId);
  if (!j) return 'quick';

  const claim = claimJob(jobId, HOLDER, CLAIM_MINUTES);
  if (!claim) {
    recordStep(clock.now(), { campaignId, jobId, step: 'claim', status: 'held_elsewhere', detail: { holder: activeClaim(jobId)?.holder ?? null } });
    return 'quick';
  }
  recordStep(clock.now(), { campaignId, jobId, step: 'claim', status: 'ok' });
  // Long fills outlive the lease; keep renewing it until we are done.
  let renew: unknown = null;
  const keep = () => {
    renew = clock.setTimeout(() => {
      claimJob(jobId, HOLDER, CLAIM_MINUTES);
      keep();
    }, 5 * 60_000);
  };
  keep();

  try {
    let row = pipelineState(jobId);
    if (!row) return 'quick';
    if (row.state === 'submitted') return 'quick';

    // Someone (the owner, an external agent) already sent it.
    const sentApp = applicationSent(jobId);
    if (sentApp) {
      if (['selected', 'written', 'filling', 'needs_you', 'rehearsed'].includes(row.state)) {
        transition(jobId, 'submitted', { reason: 'An application for this job was already sent' });
        recordStep(clock.now(), { campaignId, jobId, step: 'submitted', status: 'external', detail: { applicationId: sentApp, channel: 'elsewhere' } });
      }
      return 'quick';
    }

    // Retry after backoff.
    if (row.state === 'failed') {
      row = transition(jobId, loadPacket(jobId) ? 'written' : 'selected', { reason: `Retry ${row.attempts + 1}` });
    }

    // ── Write ──
    let packet = loadPacket(jobId);
    // A job with no route Bureau may use (only a LinkedIn or Indeed link, no form, no email) is set aside before
    // anything is paid for: writing it would only end in "needs you".
    if (row.state === 'selected' && !packet) {
      // The campaign's free filters as they stand now (they may have changed since the job was picked).
      const ruled = ruledOutNow(jobId, item.campaign.config);
      if (ruled) {
        transition(jobId, 'skipped', { reason: `No longer fits the campaign: ${ruled}` });
        recordStep(clock.now(), { campaignId, jobId, step: 'skip', status: 'ruled_out', detail: { reason: ruled } });
        return 'quick';
      }
      const pre = chooseRoute(j, item.campaign, deps.emailReady());
      const why =
        pre.kind === 'none'
          ? pre.reason
          : pre.kind === 'form' && NOT_AUTOMATED.test(pre.url)
            ? `It applies only through ${new URL(pre.url).hostname}, which Bureau never automates. Apply there yourself if you want it.`
            : pre.kind === 'form' && THREAD_PAGE.test(pre.url)
              ? 'The posting is a discussion thread with no form and no email to apply to. Use the link in the post yourself if you want it.'
              : pre.kind === 'form' && LINK_OUT_BOARD.test(pre.url)
                ? `${new URL(pre.url).hostname} only links out to the employer, and Bureau found no employer form for it. Apply from the listing yourself if you want it.`
                : null;
      if (why) {
        transition(jobId, 'skipped', { reason: why });
        recordStep(clock.now(), { campaignId, jobId, step: 'skip', status: 'no_route', detail: { reason: why } });
        ctx.say(`Set aside ${label(jobId)} before writing: ${why}`, 'info', jobId);
        return 'quick';
      }
      // Boards close roles between a scout and the apply: check the posting is still there before paying to write.
      // The same employer's form asked questions that are still waiting on the owner: its next form asks them too.
      const waiting = get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM unknown_questions q JOIN jobs x ON x.id = q.job_id
          WHERE q.status = 'open' AND q.job_id != ? AND (x.company = ? OR (x.company_id IS NOT NULL AND x.company_id = ?))`,
        jobId,
        j.company,
        get<{ company_id: string | null }>('SELECT company_id FROM jobs WHERE id = ?', jobId)?.company_id ?? '',
      )?.n;
      if (waiting) {
        const held = `${j.company}'s form has ${waiting} question${waiting === 1 ? '' : 's'} waiting for your answer (Questions). Its other roles wait until you answer.`;
        transition(jobId, 'skipped', { reason: held });
        recordStep(clock.now(), { campaignId, jobId, step: 'skip', status: 'questions_open', detail: { reason: held } });
        ctx.say(`Set aside ${label(jobId)} before writing: ${held}`, 'info', jobId);
        return 'quick';
      }
      const formUrl = pre.kind === 'form' ? pre.url : null;
      const posting = formUrl && deps.postingOpen ? await deps.postingOpen(formUrl) : 'unknown';
      if (formUrl) recordStep(clock.now(), { campaignId, jobId, step: 'route', status: `posting_${posting}`, detail: { url: formUrl } });
      if (formUrl && (posting === 'closed' || posting === 'blocked' || posting === 'unreachable')) {
        const why =
          posting === 'closed'
            ? 'The posting has closed since it was found.'
            : posting === 'unreachable'
              ? `The job is listed, but its page at ${new URL(formUrl).hostname} is switched off (the company takes applications on its own careers site). Apply there yourself if you want it.`
              : `${new URL(formUrl).hostname} puts a bot check in front of the page, which Bureau never solves. Apply there yourself if you want it.`;
        transition(jobId, 'skipped', { reason: why });
        recordStep(clock.now(), { campaignId, jobId, step: 'skip', status: posting, detail: { url: formUrl } });
        ctx.say(`Set aside ${label(jobId)} before writing: ${why}`, 'info', jobId);
        return 'quick';
      }
    }
    if (row.state === 'selected' || (row.state === 'writing' && !packet) || (row.state === 'written' && !packet)) {
      if (row.state === 'written') row = transition(jobId, 'selected', { reason: 'Packet missing; writing again' });
      ctx.setStep('Writing');
      transition(jobId, 'writing', { campaignId, reason: 'Writing the application' });
      recordStep(clock.now(), { campaignId, jobId, step: 'write', status: 'started' });
      ctx.say(`Writing for ${j.title} at ${j.company}`, 'info', jobId);
      let res;
      try {
        res = await deps.write(jobId, campaignId);
      } catch (err) {
        if (isNotImplemented(err)) {
          transition(jobId, 'selected', { reason: 'Writer not available yet' });
          recordStep(clock.now(), { campaignId, jobId, step: 'write', status: 'unavailable' });
          ctx.unavailable('writer');
          return 'unavailable';
        }
        if (err instanceof AppError && err.code === 'BUDGET') {
          transition(jobId, 'selected', { reason: 'AI budget reached before writing' });
          await ctx.budget(err.message);
          return 'stopped';
        }
        recordStep(clock.now(), { campaignId, jobId, step: 'write', status: 'error', detail: { message: redact((err as Error).message) } });
        failJob(ctx, item, `Writer failed: ${redact((err as Error).message)}`, null);
        return 'worked';
      }
      if ('skipped' in res) {
        transition(jobId, 'skipped', { reason: res.skipped });
        recordStep(clock.now(), { campaignId, jobId, step: 'skip', status: 'writer', detail: { reason: res.skipped } });
        ctx.say(`Writer held back ${j.title} at ${j.company}: ${res.skipped}`, 'info', jobId);
        return 'worked';
      }
      packet = res;
      savePacket(jobId, campaignId, packet, clock.now());
      run('UPDATE applications SET campaign_id = ?, auto = 1 WHERE id = ?', campaignId, packet.applicationId);
      recordStep(clock.now(), { campaignId, jobId, step: 'write', status: 'done', detail: { applicationId: packet.applicationId } });
      row = transition(jobId, 'written', { reason: 'Packet ready' });
    } else if (row.state === 'writing' && packet) {
      row = transition(jobId, 'written', { reason: 'Packet found after restart' });
    }
    if (!packet) return 'quick';
    if (ctx.signal.aborted) return 'stopped';

    // Send what the writer would send now: the owner may have edited the letter since it was written.
    const fresh = deps.freshPacket ? await deps.freshPacket(packet.applicationId) : undefined;
    if (fresh === null) {
      transition(jobId, 'filling', { reason: 'Checking the packet' });
      transition(jobId, 'needs_you', { reason: 'The letter was edited and no longer passes the quality gates.' });
      updateApplication(packet.applicationId, 'needs_you', { reason: 'Edited letter fails the gates', campaignId });
      return 'quick';
    }
    if (fresh) packet = fresh;

    // The owner may have narrowed the campaign (fields, places, remote only) since this was written.
    const ruledOut = ruledOutNow(jobId, item.campaign.config);
    if (ruledOut) {
      transition(jobId, 'skipped', { campaignId, reason: `filter: ${ruledOut}` });
      updateApplication(packet.applicationId, 'skipped', { reason: `No longer fits the campaign: ${ruledOut}`, campaignId });
      return 'quick';
    }

    // ── Route ──
    const route = chooseRoute(j, item.campaign, deps.emailReady());
    recordStep(clock.now(), { campaignId, jobId, step: 'route', status: route.kind });
    if (route.kind === 'none') {
      transition(jobId, 'filling', { reason: 'Choosing a channel' });
      transition(jobId, 'needs_you', { reason: route.reason });
      updateApplication(packet.applicationId, 'needs_you', { reason: route.reason, campaignId });
      return 'quick';
    }
    if (!packet.quality.truth.pass) {
      transition(jobId, 'filling', { reason: 'Checking the packet' });
      transition(jobId, 'needs_you', { reason: 'The truth lock did not pass; review the draft.' });
      updateApplication(packet.applicationId, 'needs_you', { reason: 'Truth lock not clean', campaignId });
      return 'quick';
    }

    const live = ctx.live;
    if (live) {
      const problem = uniquenessProblem(jobId, item.campaign, clock.now());
      if (problem) {
        transition(jobId, 'skipped', { reason: problem });
        recordStep(clock.now(), { campaignId, jobId, step: 'skip', status: 'unique', detail: { reason: problem } });
        return 'quick';
      }
    }

    return route.kind === 'email' ? await viaEmail(ctx, item, packet, route.to, live) : await viaForm(ctx, item, packet, live);
  } finally {
    if (renew !== null) clock.clearTimeout(renew);
    releaseClaim(jobId, HOLDER);
    recordStep(clock.now(), { campaignId, jobId, step: 'release', status: 'ok' });
  }
}

async function viaEmail(ctx: WorkerCtx, item: QueueItem, packet: ApplicationPacket, to: string, live: boolean): Promise<JobResult> {
  const { deps } = ctx;
  const clock = deps.clock;
  const { jobId } = item;
  const campaignId = item.campaign.id;
  ctx.setStep('Emailing');
  transition(jobId, 'filling', { reason: `Email to ${to}` });
  run("UPDATE applications SET channel = 'email', to_email = ? WHERE id = ?", to, packet.applicationId);
  // Verify: recipient and packet are both present and sane.
  if (!packet.subject.trim() || !packet.coverLetter.trim()) {
    transition(jobId, 'needs_you', { reason: 'The packet has no subject or letter to email.' });
    return 'quick';
  }
  transition(jobId, 'verified', { reason: 'Recipient and packet checked' });
  if (!live) {
    transition(jobId, 'rehearsed', { reason: `Rehearsal: would email ${to}` });
    updateApplication(packet.applicationId, 'rehearsed', { reason: `Rehearsal: would email ${to}.`, channel: 'email', campaignId });
    recordStep(clock.now(), { campaignId, jobId, step: 'rehearsed', status: 'ok', detail: { applicationId: packet.applicationId, channel: 'email' } });
    ctx.say(`Rehearsed: would email ${label(jobId)}`, 'info', jobId);
    return 'worked';
  }
  if (pipelineState(jobId)?.state === 'submitted' || applicationSent(jobId)) return 'quick';
  recordStep(clock.now(), { campaignId, jobId, step: 'submit_intent', status: 'email', detail: { applicationId: packet.applicationId, to } });
  try {
    const messageId = await deps.sendEmail({ to, packet });
    recordStep(clock.now(), { campaignId, jobId, step: 'submit_done', status: 'email', detail: { messageId } });
  } catch (err) {
    // The SMTP server refused or was unreachable: nothing went out.
    recordStep(clock.now(), { campaignId, jobId, step: 'submit_done', status: 'error', detail: { message: redact((err as Error).message) } });
    transition(jobId, 'failed', { reason: `Email failed: ${redact((err as Error).message)}`, countAttempt: true, nextActionAt: new Date(clock.now() + backoffMs(1)).toISOString() });
    updateApplication(packet.applicationId, 'failed', { reason: `Email failed: ${redact((err as Error).message)}` });
    return 'worked';
  }
  transition(jobId, 'submitted', { reason: `Emailed ${to}` });
  updateApplication(packet.applicationId, 'sent', { reason: `Emailed ${to}`, channel: 'email', campaignId, sent: true });
  run("UPDATE jobs SET stage = 'applied', updated_at = ? WHERE id = ?", dbNow(), jobId);
  recordStep(clock.now(), { campaignId, jobId, step: 'submitted', status: 'ok', detail: { applicationId: packet.applicationId, channel: 'email' } });
  emit({ type: 'application.outcome', applicationId: packet.applicationId, jobId, outcome: 'submitted', detail: `email to ${to}` });
  ctx.say(`Applied by email: ${label(jobId)}`, 'info', jobId);
  return 'worked';
}

async function viaForm(ctx: WorkerCtx, item: QueueItem, packet: ApplicationPacket, live: boolean): Promise<JobResult> {
  const { deps } = ctx;
  const clock = deps.clock;
  const { jobId } = item;
  const campaign = item.campaign;
  const campaignId = campaign.id;
  ctx.setStep(live ? 'Filling and submitting' : 'Rehearsing the form');
  if (pipelineState(jobId)?.state === 'submitted' || applicationSent(jobId)) return 'quick';
  transition(jobId, 'filling', { reason: live ? 'Filling the form (live)' : 'Filling the form (rehearsal)' });
  run("UPDATE applications SET channel = 'ats' WHERE id = ?", packet.applicationId);
  recordStep(clock.now(), { campaignId, jobId, step: 'fill', status: 'started', detail: { live } });
  if (live) recordStep(clock.now(), { campaignId, jobId, step: 'submit_intent', status: 'form', detail: { applicationId: packet.applicationId } });
  ctx.say(`${live ? 'Applying through the form' : 'Rehearsing the form'}: ${label(jobId)}`, 'info', jobId);

  let outcome: FillOutcome;
  try {
    outcome = await deps.fill(packet, {
      submit: live,
      campaignId,
      onUnknown: campaign.config.onUnknownQuestion,
      allowAgent: campaign.config.channels.agent,
      signal: ctx.signal,
    });
  } catch (err) {
    const aborted = ctx.signal.aborted;
    if (isNotImplemented(err)) {
      // Nothing was opened, let alone submitted.
      recordStep(clock.now(), { campaignId, jobId, step: 'outcome', status: 'unavailable' });
      transition(jobId, 'written', { reason: 'Form engine not available yet' });
      ctx.unavailable('form engine');
      return 'unavailable';
    }
    if (aborted && live) {
      recordStep(clock.now(), { campaignId, jobId, step: 'recover', status: 'killed_mid_submit' });
      recordStep(clock.now(), { campaignId, jobId, step: 'maybe_sent', status: 'killed_mid_submit' });
      transition(jobId, 'needs_you', { reason: 'Stopped by the kill switch during a live fill. Check the employer site before retrying.' });
      updateApplication(packet.applicationId, 'needs_you', { reason: 'Stopped mid-fill by the kill switch.' });
      return 'stopped';
    }
    if (aborted) {
      recordStep(clock.now(), { campaignId, jobId, step: 'outcome', status: 'aborted' });
      transition(jobId, 'written', { reason: 'Stopped by the kill switch during a rehearsal' });
      return 'stopped';
    }
    if (err instanceof AppError && err.code === 'BUDGET') {
      recordStep(clock.now(), { campaignId, jobId, step: 'outcome', status: 'budget' });
      transition(jobId, live ? 'needs_you' : 'written', { reason: 'AI budget ran out during the fill' });
      await ctx.budget(err.message);
      return 'stopped';
    }
    const message = redact((err as Error).message);
    // A thrown error from a live fill: we cannot be sure the form was not sent.
    if (live) {
      recordStep(clock.now(), { campaignId, jobId, step: 'outcome', status: 'error', detail: { message } });
      recordStep(clock.now(), { campaignId, jobId, step: 'maybe_sent', status: 'crashed_mid_fill' });
      transition(jobId, 'needs_you', { reason: `The form engine crashed during a live fill (${message}). Check before retrying.` });
      updateApplication(packet.applicationId, 'needs_you', { reason: message });
      return 'worked';
    }
    recordStep(clock.now(), { campaignId, jobId, step: 'outcome', status: 'error', detail: { message } });
    failJob(ctx, item, `Form engine error: ${message}`, packet.applicationId);
    return 'worked';
  }

  recordStep(clock.now(), {
    campaignId,
    jobId,
    step: 'outcome',
    status: outcome.status,
    detail: { verified: outcome.verified, reason: outcome.reason.slice(0, 500), shot: outcome.shotPath, via: outcome.via, live },
  });
  await settleOutcome(ctx, item, packet, outcome, live);
  return 'worked';
}

/** Turn a FillOutcome into pipeline and application state. Also used by recovery. */
export async function settleOutcome(ctx: Pick<WorkerCtx, 'deps' | 'say' | 'breach'>, item: QueueItem, packet: ApplicationPacket, outcome: FillOutcome, live: boolean) {
  const clock = ctx.deps.clock;
  const { jobId } = item;
  const campaignId = item.campaign.id;
  const appFields = { shot: outcome.shotPath, answers: outcome.answers, campaignId, channel: 'ats' };
  const state = pipelineState(jobId)?.state;

  if (outcome.status === 'submitted') {
    // The truth first: it went out, so it is recorded as submitted (never retried).
    if (state === 'filling') transition(jobId, 'verified', { reason: outcome.verified ? 'Form verified' : 'Form engine reported submitted WITHOUT verification' });
    transition(jobId, 'submitted', { reason: outcome.reason || 'Submitted through the form' });
    updateApplication(packet.applicationId, 'sent', { ...appFields, reason: outcome.reason, sent: true });
    run("UPDATE jobs SET stage = 'applied', updated_at = ? WHERE id = ?", dbNow(), jobId);
    recordStep(clock.now(), { campaignId, jobId, step: 'submitted', status: 'ok', detail: { applicationId: packet.applicationId, channel: 'form', shot: outcome.shotPath } });
    emit({ type: 'application.outcome', applicationId: packet.applicationId, jobId, outcome: 'submitted', detail: outcome.via ?? undefined });
    ctx.say(`Applied through the form: ${label(jobId)}`, 'info', jobId);
    if (!outcome.verified || !live) {
      await ctx.breach(item.campaign, `The form engine submitted ${label(jobId)} ${!live ? 'during a rehearsal' : 'without verifying it'}. The campaign is paused until you check it.`);
    }
    return;
  }

  if (outcome.status === 'rehearsed') {
    if (!outcome.verified) {
      transition(jobId, 'needs_you', { reason: `Rehearsal could not verify the form: ${outcome.reason}` });
      updateApplication(packet.applicationId, 'needs_you', { ...appFields, reason: outcome.reason });
      return;
    }
    if (state === 'filling') transition(jobId, 'verified', { reason: 'Form filled and verified' });
    transition(jobId, 'rehearsed', { reason: outcome.reason || 'Rehearsed: filled and verified, not submitted' });
    updateApplication(packet.applicationId, 'rehearsed', { ...appFields, reason: outcome.reason || 'Rehearsal: filled and verified, not submitted.' });
    recordStep(clock.now(), { campaignId, jobId, step: 'rehearsed', status: 'ok', detail: { applicationId: packet.applicationId, channel: 'form', shot: outcome.shotPath } });
    ctx.say(`Rehearsed: ${label(jobId)}`, 'info', jobId);
    return;
  }

  if (outcome.status === 'needs_you') {
    // Submit was pressed, then a CAPTCHA, a form error or no confirmation: it may have gone out.
    if (live && outcome.submitPressed) recordStep(clock.now(), { campaignId, jobId, step: 'maybe_sent', status: 'no_confirmation' });
    transition(jobId, 'needs_you', { reason: outcome.reason });
    updateApplication(packet.applicationId, 'needs_you', { ...appFields, reason: outcome.reason });
    ctx.say(`Needs you: ${label(jobId)}. ${outcome.reason}`, 'info', jobId);
    return;
  }

  if (outcome.status === 'skipped') {
    transition(jobId, 'skipped', { reason: outcome.reason });
    updateApplication(packet.applicationId, 'skipped', { ...appFields, reason: outcome.reason });
    ctx.say(`Skipped ${label(jobId)}: ${outcome.reason}`, 'info', jobId);
    return;
  }

  // failed
  const cur = pipelineState(jobId);
  const attempts = (cur?.attempts ?? 0) + 1;
  transition(jobId, 'failed', {
    reason: outcome.reason,
    error: outcome.reason,
    countAttempt: true,
    nextActionAt: new Date(clock.now() + backoffMs(attempts)).toISOString(),
  });
  updateApplication(packet.applicationId, 'failed', { ...appFields, reason: outcome.reason });
  ctx.say(`Form failed for ${label(jobId)}: ${outcome.reason}`, 'warn', jobId);
}

// ── Crash recovery ───────────────────────────────────────────────────────────

/**
 * Put every job a dead process left mid-step into a safe state. Rehearsals and
 * unfinished writes go back to the queue; anything that might have been
 * submitted goes to needs_you (or submitted, when proof exists). Never re-runs
 * a submit.
 */
export function recoverJob(jobId: string, campaign: Campaign | null, nowMs: number): string | null {
  const row = pipelineState(jobId);
  if (!row || !['writing', 'filling', 'verified'].includes(row.state)) return null;
  const holder = activeClaim(jobId)?.holder;
  if (holder && holder !== HOLDER) return null; // an external agent owns it
  const campaignId = campaign?.id ?? row.campaignId;
  const note = (status: string, detail: Record<string, unknown> = {}) => recordStep(nowMs, { campaignId, jobId, step: 'recover', status, detail: { from: row.state, ...detail } });
  const packet = loadPacket(jobId);
  const sent = applicationSent(jobId);

  if (row.state === 'writing') {
    if (packet) {
      transition(jobId, 'written', { reason: 'Recovered after restart: packet was already written' });
      note('written');
      return 'written';
    }
    transition(jobId, 'selected', { reason: 'Recovered after restart: writing again' });
    note('selected');
    return 'selected';
  }

  if (sent) {
    transition(jobId, 'submitted', { reason: 'Recovered after restart: the application was sent' });
    note('submitted', { applicationId: sent });
    recordStep(nowMs, { campaignId, jobId, step: 'submitted', status: 'recovered', detail: { applicationId: sent, channel: 'unknown' } });
    return 'submitted';
  }

  const intent = openSubmitIntent(jobId);
  const outcome = lastOutcome(jobId);
  if (outcome && outcome.status === 'submitted') {
    if (row.state === 'filling') transition(jobId, 'verified', { reason: 'Recovered: outcome was recorded' });
    transition(jobId, 'submitted', { reason: 'Recovered after restart: the form engine reported it submitted' });
    note('submitted');
    recordStep(nowMs, { campaignId, jobId, step: 'submitted', status: 'recovered', detail: { applicationId: packet?.applicationId ?? null, channel: 'form' } });
    return 'submitted';
  }
  if (intent) {
    // It may or may not have gone out. Never guess "no".
    recordStep(nowMs, { campaignId, jobId, step: 'maybe_sent', status: 'interrupted' });
    transition(jobId, 'needs_you', { reason: 'Bureau stopped while submitting. Check the employer site or your inbox before applying again.' });
    note('needs_you', { intent: intent.status });
    if (packet) updateApplication(packet.applicationId, 'needs_you', { reason: 'Interrupted during submit; may already be sent.' });
    return 'needs_you';
  }
  if (outcome && outcome.status === 'rehearsed' && outcome.detail.verified) {
    if (row.state === 'filling') transition(jobId, 'verified', { reason: 'Recovered: rehearsal outcome was recorded' });
    transition(jobId, 'rehearsed', { reason: 'Recovered after restart: rehearsal had finished' });
    note('rehearsed');
    return 'rehearsed';
  }
  // A rehearsal (or a route check) that never reached submit: safe to redo.
  if (packet) {
    transition(jobId, 'written', { reason: 'Recovered after restart: redoing the fill' });
    note('written');
    return 'written';
  }
  // No packet to fill with (should not happen): park it as a failure the queue retries from the writer.
  transition(jobId, 'failed', { reason: 'Recovered after restart without a packet', error: 'packet missing', nextActionAt: new Date(nowMs).toISOString() });
  note('failed');
  return 'failed';
}
