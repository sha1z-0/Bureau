import './schema.ts';
import { emailInText } from '../ai/prompts.ts';
import { NotImplemented } from '../contracts/stub.ts';
import { getCampaign, isDryRun } from '../campaign/campaigns.ts';
import { killState, stopFilePresent } from '../campaign/kill.ts';
import { all, get, getSetting, logEvent, now as dbNow, run, setSetting } from '../db.ts';
import { redact } from '../errors.ts';
import { emit } from '../services/bus.ts';
import { inboxDeps } from './deps.ts';
import { atsFamilyOf, baseDomain, isEmployerHost, hostOf } from './domains.ts';
import { inboxSettings } from './settings.ts';
import { REPLY_CLASSES } from './stage.ts';

/**
 * One polite follow-up per application, after N days of silence, only to a
 * hiring contact published in the posting (or the company's own pages), drafted
 * by A04 (lint + truth lock), capped per day, and never after any reply that
 * moved the application, least of all a rejection. Scheduling, interviews and
 * offers are never answered by Bureau.
 */

export interface FollowUpCandidate {
  applicationId: string;
  jobId: string;
  company: string;
  title: string;
  sentAt: string;
  dueAt: string;
  to: string | null;
  campaignId: string | null;
  dryRun: boolean;
  blocked: string | null;
}

export interface FollowUpRun {
  sent: number;
  rehearsed: number;
  skipped: number;
  failed: number;
  capReached: boolean;
  writerUnavailable: boolean;
  details: { applicationId: string; result: string }[];
}

const NOREPLY = /^(no-?reply|do-?not-?reply|donotreply|notifications?|mailer-daemon|postmaster|bounce[s]?|alerts?|jobs-noreply|careers-noreply)([+._-]|$)/i;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * The hiring contact for an application: an address that appears in the
 * posting itself (so one posting can never point Bureau at someone else), that
 * is not a no-reply or ATS robot, preferring the one we applied to.
 */
export function hiringContact(app: { toEmail: string | null; applyEmail: string | null; description: string; jobUrl: string; companyDomain: string | null }): string | null {
  const text = app.description ?? '';
  const ok = (addr: string | null | undefined): string | null => {
    if (!addr) return null;
    const e = emailInText(addr, text);
    if (!e) return null;
    const [local, domain] = e.split('@');
    if (NOREPLY.test(local) || atsFamilyOf(domain)) return null;
    return e;
  };
  const direct = ok(app.toEmail) ?? ok(app.applyEmail);
  if (direct) return direct;
  // Otherwise an address on the employer's own domain written in the posting ("questions to talent@acme.com").
  const employer = new Set<string>();
  for (const h of [hostOf(app.jobUrl), app.companyDomain]) if (h && isEmployerHost(h)) employer.add(baseDomain(h));
  for (const m of text.matchAll(EMAIL_IN_TEXT)) {
    const e = ok(m[0]);
    if (e && (employer.size === 0 ? false : employer.has(baseDomain(e.split('@')[1])))) return e;
  }
  return null;
}

function campaignFor(id: string | null, nowMs: number): { followUpDays: number | null; status: string | null; dryRun: boolean } {
  if (!id) return { followUpDays: null, status: null, dryRun: false };
  const c = getCampaign(id);
  if (!c) return { followUpDays: null, status: null, dryRun: false };
  // A08 decides what "dry run" means (campaign-local days, rehearse-only); ask it, never re-derive.
  return { followUpDays: c.config.followUpDays, status: c.status, dryRun: isDryRun(c, nowMs) };
}

function killed(): boolean {
  return !!killState() || stopFilePresent();
}

/** Every application that is, or will be, due a follow-up, with the reason it is blocked if it is. */
export function followUpCandidates(nowMs = inboxDeps().now()): FollowUpCandidate[] {
  const s = inboxSettings();
  const rows = all<{
    id: string;
    job_id: string;
    stage: string | null;
    sent_at: string;
    to_email: string | null;
    campaign_id: string | null;
    company: string;
    title: string;
    apply_email: string | null;
    description_text: string | null;
    url: string;
    company_domain: string | null;
    fu_status: string | null;
    fu_attempts: number | null;
    replied: number | null;
  }>(
    `SELECT a.id, a.job_id, a.stage, a.sent_at, a.to_email, a.campaign_id, j.company, j.title, j.apply_email, j.description_text, j.url,
            c.domain AS company_domain, f.status AS fu_status, f.attempts AS fu_attempts, o.replied
       FROM applications a JOIN jobs j ON j.id = a.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       LEFT JOIN inbox_followups f ON f.application_id = a.id
       LEFT JOIN outcomes o ON o.application_id = a.id
      WHERE a.sent_at IS NOT NULL AND a.status IN ('sent', 'submitted')
      ORDER BY a.sent_at ASC`,
  );
  const out: FollowUpCandidate[] = [];
  for (const r of rows) {
    const camp = campaignFor(r.campaign_id, nowMs);
    const days = camp.followUpDays ?? s.followUps.defaultDays;
    const sentMs = Date.parse(r.sent_at);
    const dueMs = sentMs + days * 86_400_000;
    const to = hiringContact({ toEmail: r.to_email, applyEmail: r.apply_email, description: r.description_text ?? '', jobUrl: r.url, companyDomain: r.company_domain });
    const replyCount =
      get<{ n: number }>(`SELECT COUNT(*) AS n FROM inbox_messages WHERE application_id = ? AND class IN (${REPLY_CLASSES.map(() => '?').join(',')})`, r.id, ...REPLY_CLASSES)?.n ?? 0;
    let blocked: string | null = null;
    if (r.fu_status === 'sent' || r.fu_status === 'intent') blocked = 'already followed up';
    else if (r.fu_status === 'skipped') blocked = 'skipped earlier';
    else if (r.fu_status === 'failed' && (r.fu_attempts ?? 0) >= 3) blocked = 'failed three times';
    else if ((r.stage ?? 'applied') === 'rejected') blocked = 'rejected';
    else if ((r.stage ?? 'applied') !== 'applied' || r.replied === 1 || replyCount > 0) blocked = 'they replied';
    else if (days <= 0) blocked = 'follow-ups off for this campaign';
    else if (camp.status && camp.status !== 'active') blocked = `campaign is ${camp.status}`;
    else if (!to) blocked = 'no published hiring contact';
    else if (nowMs < dueMs) blocked = 'not due yet';
    else if (nowMs > dueMs + 21 * 86_400_000) blocked = 'too long ago to follow up';
    out.push({
      applicationId: r.id,
      jobId: r.job_id,
      company: r.company,
      title: r.title,
      sentAt: r.sent_at,
      dueAt: new Date(dueMs).toISOString(),
      to,
      campaignId: r.campaign_id,
      dryRun: camp.dryRun,
      blocked,
    });
  }
  return out;
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function followUpsSentToday(nowMs = inboxDeps().now()): number {
  const from = new Date(startOfLocalDay(nowMs)).toISOString();
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM inbox_followups WHERE status IN ('intent', 'sent') AND created_at >= ?", from)?.n ?? 0;
}

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** Send the follow-ups that are due, within today's cap. */
export async function runFollowUps(opts: { force?: boolean } = {}): Promise<FollowUpRun> {
  const deps = inboxDeps();
  const s = inboxSettings();
  const res: FollowUpRun = { sent: 0, rehearsed: 0, skipped: 0, failed: 0, capReached: false, writerUnavailable: false, details: [] };
  if (!s.followUps.enabled && !opts.force) return res;
  if (killed()) return res;
  const nowMs = deps.now();
  let room = Math.max(0, s.followUps.perDay - followUpsSentToday(nowMs));
  for (const c of followUpCandidates(nowMs)) {
    if (c.blocked) continue;
    if (room <= 0) {
      res.capReached = true;
      break;
    }
    let draft: { subject: string; body: string } | null;
    try {
      draft = await deps.draftFollowUp(c.applicationId);
    } catch (err) {
      if (err instanceof NotImplemented) {
        res.writerUnavailable = true;
        const day = new Date(nowMs).toISOString().slice(0, 10);
        if (getSetting<string | null>('inbox.followups.writerNotice', null) !== day) {
          setSetting('inbox.followups.writerNotice', day);
          logEvent('inbox', 'Follow-ups are due but the writer (A04) cannot draft them yet: none sent today.');
        }
        break;
      }
      logEvent('inbox', `Follow-up draft failed for ${c.company}: ${redact((err as Error).message).slice(0, 160)}`, c.jobId);
      res.failed++;
      res.details.push({ applicationId: c.applicationId, result: 'draft failed' });
      continue;
    }
    if (!draft || !draft.body.trim()) {
      run(
        `INSERT INTO inbox_followups (application_id, status, to_addr, reason, created_at) VALUES (?, 'skipped', ?, ?, ?)
         ON CONFLICT(application_id) DO UPDATE SET status = 'skipped', reason = excluded.reason`,
        c.applicationId,
        c.to,
        'The writer declined to draft a follow-up.',
        dbNow(),
      );
      res.skipped++;
      res.details.push({ applicationId: c.applicationId, result: 'writer declined' });
      continue;
    }
    const subject = oneLine(draft.subject || `Following up: ${c.title}`, 150);
    const body = draft.body.trim().slice(0, 2_000);

    // Re-check right before the irreversible step: a reply may have landed while drafting.
    const fresh = followUpCandidates(deps.now()).find((x) => x.applicationId === c.applicationId);
    if (!fresh || fresh.blocked) {
      res.details.push({ applicationId: c.applicationId, result: `blocked: ${fresh?.blocked ?? 'gone'}` });
      continue;
    }

    if (c.dryRun) {
      run(
        `INSERT INTO inbox_followups (application_id, status, to_addr, subject, body, reason, created_at) VALUES (?, 'rehearsed', ?, ?, ?, 'campaign in dry run', ?)
         ON CONFLICT(application_id) DO UPDATE SET status = 'rehearsed', to_addr = excluded.to_addr, subject = excluded.subject, body = excluded.body, reason = excluded.reason`,
        c.applicationId,
        c.to,
        subject,
        body,
        dbNow(),
      );
      res.rehearsed++;
      res.details.push({ applicationId: c.applicationId, result: 'rehearsed' });
      continue;
    }

    // Journal the intent first: a crash after this line never sends a second follow-up.
    run(
      `INSERT INTO inbox_followups (application_id, status, to_addr, subject, body, attempts, created_at) VALUES (?, 'intent', ?, ?, ?, 1, ?)
       ON CONFLICT(application_id) DO UPDATE SET status = 'intent', to_addr = excluded.to_addr, subject = excluded.subject, body = excluded.body,
         attempts = inbox_followups.attempts + 1, created_at = excluded.created_at, reason = NULL`,
      c.applicationId,
      c.to,
      subject,
      body,
      new Date(nowMs).toISOString(),
    );
    room--;
    try {
      const messageId = await deps.sendMail({ to: c.to!, subject, text: body });
      run("UPDATE inbox_followups SET status = 'sent', message_id = ?, sent_at = ? WHERE application_id = ?", messageId ? (messageId.startsWith('<') ? messageId : `<${messageId}>`) : null, dbNow(), c.applicationId);
      logEvent('inbox', `Followed up with ${c.company} (${c.title})`, c.jobId);
      emit({ type: 'activity', message: `Followed up with ${c.company} about ${c.title}`, jobId: c.jobId });
      res.sent++;
      res.details.push({ applicationId: c.applicationId, result: 'sent' });
    } catch (err) {
      run("UPDATE inbox_followups SET status = 'failed', reason = ? WHERE application_id = ?", redact((err as Error).message).slice(0, 300), c.applicationId);
      res.failed++;
      res.details.push({ applicationId: c.applicationId, result: 'send failed' });
    }
  }
  return res;
}

export function listFollowUps(limit = 100) {
  return all<{ application_id: string; status: string; to_addr: string | null; subject: string; body: string; reason: string | null; attempts: number; created_at: string; sent_at: string | null; company: string | null; title: string | null }>(
    `SELECT f.*, j.company, j.title FROM inbox_followups f LEFT JOIN applications a ON a.id = f.application_id LEFT JOIN jobs j ON j.id = a.job_id
      ORDER BY f.created_at DESC LIMIT ?`,
    limit,
  ).map((r) => ({
    applicationId: r.application_id,
    status: r.status,
    to: r.to_addr,
    subject: r.subject,
    body: r.body,
    reason: r.reason,
    attempts: r.attempts,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    company: r.company,
    title: r.title,
  }));
}
