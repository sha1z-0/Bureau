import crypto from 'node:crypto';
import { all, get, run } from '../db.ts';
import { PORT } from '../config.ts';
import { emit } from '../services/bus.ts';
import type { Campaign } from '../contracts/campaign.ts';
import { escapeHtml } from '../notify/telegram.ts';
import { shortIdFor } from '../notify/questions.ts';
import { campaignDay0, campaignDayIndex, campaignMeta, isDryRun, liveAt } from './campaigns.ts';
import { stepsBetween } from './journal.ts';
import { localParts, startOfLocalDay } from './time.ts';

/**
 * The daily digest: what went out, what was rehearsed or skipped and why,
 * what needs the owner, new questions, replies, spend and the week's top gaps.
 * Built from the database for one campaign and one local day, stored in
 * `digests`, and rendered short enough to read on a phone.
 */

export interface DigestApp {
  jobId: string;
  applicationId: string | null;
  company: string;
  role: string;
  score: number | null;
  channel: string;
  shotUrl: string | null;
}

export interface DigestContent {
  version: 1;
  date: string;
  tz: string;
  window: { from: string; to: string };
  campaignId: string | null;
  campaignName: string | null;
  final: boolean;
  mode: 'dry_run' | 'live';
  modeNote: string | null;
  sent: DigestApp[];
  rehearsed: DigestApp[];
  skipped: { reason: string; count: number; examples: string[] }[];
  needsYou: { jobId: string; company: string; role: string; reason: string }[];
  failed: { jobId: string; company: string; role: string; reason: string }[];
  questions: { id: string; shortId: string; question: string; company: string | null }[];
  inbox: {
    interviews: { company: string; kind: string; summary: string; deadline: string | null }[];
    replies: number;
    rejections: number;
  };
  spend: { todayUsd: number; campaignUsd: number; campaignBudgetUsd: number; monthUsd: number };
  gaps: { skill: string; count: number }[];
  recipesPromoted: { ats: string; scope: string; scopeKey: string }[];
  sourceWarnings: { source: string; status: string; error: string | null }[];
  totals: { sent: number; rehearsed: number; skipped: number; needsYou: number; queued: number; sentAllTime: number; rehearsedAllTime: number };
}

export interface SourceHealthLite {
  id: string;
  label: string;
  status: string;
  lastError: string | null;
}

export interface DigestOptions {
  final?: boolean;
  sourceHealth?: () => SourceHealthLite[];
}

const SKIP_FAMILIES: [RegExp, string][] = [
  [/unknown[_ ]question/i, 'Unknown question on the form'],
  [/blocker/i, 'Hard blocker (licence, clearance, citizenship…)'],
  [/below the campaign minimum|screen-pass|score/i, 'Score below the minimum'],
  [/cooldown|applied to .+ on \d{4}/i, 'Company cooldown'],
  [/posted more than|too old|stale/i, 'Posting too old'],
  [/dismissed/i, 'Dismissed by you'],
  [/duplicate|already (applied|submitted)/i, 'Already applied'],
  [/remote|location|visa|sponsor|salary|filter|onsite|relocat/i, 'Hard filters (location, salary, visa)'],
  [/captcha/i, 'CAPTCHA'],
  [/legitimacy|scam|ghost/i, 'Looks like a ghost or scam posting'],
  [/writer|truth|lint/i, 'Writer held it back'],
];

export function skipFamily(reason: string | null): string {
  const r = reason ?? '';
  for (const [re, label] of SKIP_FAMILIES) if (re.test(r)) return label;
  const trimmed = r.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, 60) : 'No reason given';
}

const parse = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const money = (n: number) => Math.round(n * 100) / 100;

function jobInfo(jobId: string): { company: string; role: string; score: number | null } {
  const r = get<{ company: string; title: string; match: string | null; ai_score: number | null }>('SELECT company, title, match, ai_score FROM jobs WHERE id = ?', jobId);
  if (!r) return { company: 'Unknown company', role: 'Unknown role', score: null };
  const m = parse<{ screenPassScore?: number } | null>(r.match, null);
  return { company: r.company, role: r.title, score: m?.screenPassScore ?? r.ai_score ?? null };
}

const shotUrl = (appId: string | null) => (appId ? `http://127.0.0.1:${PORT}/api/applications/${encodeURIComponent(appId)}/shot.png` : null);

export function buildDigest(c: Campaign | null, nowMs: number, opts: DigestOptions = {}): DigestContent {
  const tz = c?.config.activeHours.tz ?? 'UTC';
  const fromMs = startOfLocalDay(nowMs, tz);
  const from = new Date(fromMs).toISOString();
  // The whole local day: midnight to the next midnight (23 or 25 hours on DST days).
  const toEnd = new Date(startOfLocalDay(fromMs + 30 * 3_600_000, tz)).toISOString();
  const cid = c?.id ?? null;

  const appsFor = (step: 'submitted' | 'rehearsed'): DigestApp[] =>
    stepsBetween(cid, from, toEnd, step).map((s) => {
      const info = jobInfo(s.jobId ?? '');
      const appId = (s.detail.applicationId as string | undefined) ?? null;
      return {
        jobId: s.jobId ?? '',
        applicationId: appId,
        company: info.company,
        role: info.role,
        score: info.score,
        channel: String(s.detail.channel ?? 'form'),
        shotUrl: (s.detail.shot as string | null | undefined) ? shotUrl(appId) : null,
      };
    });
  const sent = appsFor('submitted');
  const rehearsed = appsFor('rehearsed');

  // Skips today, grouped by reason family.
  const skipRows = all<{ job_id: string; reason: string | null; company: string; title: string }>(
    `SELECT l.job_id, l.reason, j.company, j.title FROM pipeline_log l
       JOIN pipeline p ON p.job_id = l.job_id JOIN jobs j ON j.id = l.job_id
      WHERE l.to_state = 'skipped' AND l.ts >= ? AND l.ts < ? AND (? IS NULL OR p.campaign_id = ?)
      ORDER BY l.id ASC`,
    from,
    toEnd,
    cid,
    cid,
  );
  const groups = new Map<string, { count: number; examples: string[] }>();
  for (const r of skipRows) {
    const key = skipFamily(r.reason);
    const g = groups.get(key) ?? { count: 0, examples: [] };
    g.count++;
    if (g.examples.length < 2) g.examples.push(`${r.company}: ${r.title}`);
    groups.set(key, g);
  }
  const skipped = [...groups.entries()].map(([reason, g]) => ({ reason, ...g })).sort((a, b) => b.count - a.count);

  const stuck = (state: 'needs_you' | 'failed') =>
    all<{ job_id: string; last_error: string | null; company: string; title: string; reason: string | null }>(
      `SELECT p.job_id, p.last_error, j.company, j.title,
              (SELECT reason FROM pipeline_log l WHERE l.job_id = p.job_id ORDER BY l.id DESC LIMIT 1) AS reason
         FROM pipeline p JOIN jobs j ON j.id = p.job_id
        WHERE p.state = ? AND (? IS NULL OR p.campaign_id = ?)
        ORDER BY p.updated_at DESC LIMIT 25`,
      state,
      cid,
      cid,
    ).map((r) => ({ jobId: r.job_id, company: r.company, role: r.title, reason: r.reason ?? r.last_error ?? '' }));
  const needsYou = stuck('needs_you');
  const failed = stuck('failed').filter((f) => f.reason);

  const questions = all<{ id: string; question_raw: string; company: string | null }>(
    `SELECT q.id, q.question_raw, j.company FROM unknown_questions q LEFT JOIN jobs j ON j.id = q.job_id
      WHERE q.status = 'open' ORDER BY q.created_at DESC LIMIT 10`,
  ).map((q) => ({ id: q.id, shortId: shortIdFor(q.id), question: q.question_raw.slice(0, 300), company: q.company }));

  const mail = all<{ class: string; data: string; application_id: string | null; app_campaign: string | null }>(
    `SELECT m.class, m.data, m.application_id, a.campaign_id AS app_campaign FROM inbox_messages m
       LEFT JOIN applications a ON a.id = m.application_id
      WHERE m.received_at >= ? AND m.received_at < ?`,
    from,
    toEnd,
  ).filter((m) => !cid || !m.application_id || m.app_campaign === cid || m.app_campaign === null);
  const interviews = mail
    .filter((m) => ['interview_invite', 'assessment', 'offer'].includes(m.class))
    .map((m) => {
      const d = parse<{ company?: string | null; summary?: string; deadline?: string | null }>(m.data, {});
      return { company: d.company ?? 'Unknown', kind: m.class, summary: (d.summary ?? '').slice(0, 200), deadline: d.deadline ?? null };
    });
  const rejections = mail.filter((m) => m.class === 'rejection').length;
  const replies = mail.filter((m) => !['verification_code', 'confirmation_received', 'other'].includes(m.class)).length;

  const spendSince = (iso: string) => Number(get<{ t: number }>('SELECT COALESCE(SUM(cost_usd), 0) AS t FROM ai_usage WHERE ts >= ?', iso)?.t ?? 0);
  const monthStart = new Date(nowMs);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const spend = {
    todayUsd: money(Number(get<{ t: number }>('SELECT COALESCE(SUM(cost_usd), 0) AS t FROM ai_usage WHERE ts >= ? AND ts < ?', from, toEnd)?.t ?? 0)),
    campaignUsd: c ? money(spendSince(new Date(campaignDay0(c)).toISOString())) : 0,
    campaignBudgetUsd: c?.config.budgetUsd ?? 0,
    monthUsd: money(spendSince(monthStart.toISOString())),
  };

  const weekAgo = new Date(nowMs - 7 * 86_400_000).toISOString();
  const gapRow = get<{ report: string }>('SELECT report FROM gap_reports WHERE created_at >= ? ORDER BY created_at DESC LIMIT 1', weekAgo);
  const gaps = (parse<{ skills?: { skill: string; count: number }[] }>(gapRow?.report, {}).skills ?? []).slice(0, 5).map((s) => ({ skill: s.skill, count: s.count }));

  const recipesPromoted = all<{ ats: string; scope: string; scope_key: string }>(
    "SELECT ats, scope, scope_key FROM form_recipes WHERE status = 'active' AND updated_at >= ? AND updated_at < ?",
    from,
    toEnd,
  ).map((r) => ({ ats: r.ats, scope: r.scope, scopeKey: r.scope_key }));

  let sourceWarnings: DigestContent['sourceWarnings'] = [];
  try {
    sourceWarnings = (opts.sourceHealth?.() ?? [])
      .filter((s) => s.status === 'failing' || s.status === 'unavailable' || s.status === 'slow')
      .map((s) => ({ source: s.label || s.id, status: s.status, error: s.lastError }));
  } catch {
    sourceWarnings = [];
  }

  const queued =
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM pipeline WHERE state IN ('selected', 'writing', 'written', 'filling', 'verified') AND (? IS NULL OR campaign_id = ?)",
      cid,
      cid,
    )?.n ?? 0;
  const allTime = (step: string) =>
    get<{ n: number }>('SELECT COUNT(*) AS n FROM campaign_steps WHERE step = ? AND (? IS NULL OR campaign_id = ?)', step, cid, cid)?.n ?? 0;

  // Mode line.
  let mode: DigestContent['mode'] = 'live';
  let modeNote: string | null = null;
  if (c) {
    const meta = campaignMeta(c.id);
    const dry = isDryRun(c, nowMs);
    mode = dry ? 'dry_run' : 'live';
    if (meta.rehearseOnly) modeNote = 'Rehearsal mode: forms are filled and checked, nothing is submitted.';
    else if (dry) {
      const day = campaignDayIndex(c, nowMs) + 1;
      const at = liveAt(c);
      modeNote = `Dry run, day ${day} of ${c.config.dryRunDays}: forms are filled and checked, nothing is submitted.${at ? ` Goes live ${fmtDay(Date.parse(at), tz)}.` : ''}`;
    } else if (meta.liveSince && localParts(Date.parse(meta.liveSince), tz).date === localParts(nowMs, tz).date && c.config.dryRunDays > 0) {
      modeNote = 'Dry run finished: live since today. Rehearsed roles were queued to be sent for real.';
    }
  }

  return {
    version: 1,
    date: localParts(nowMs, tz).date,
    tz,
    window: { from, to: toEnd },
    campaignId: cid,
    campaignName: c?.name ?? null,
    final: !!opts.final,
    mode,
    modeNote,
    sent,
    rehearsed,
    skipped,
    needsYou,
    failed,
    questions,
    inbox: { interviews, replies, rejections },
    spend,
    gaps,
    recipesPromoted,
    sourceWarnings,
    totals: {
      sent: sent.length,
      rehearsed: rehearsed.length,
      skipped: skipRows.length,
      needsYou: needsYou.length,
      queued,
      sentAllTime: allTime('submitted'),
      rehearsedAllTime: allTime('rehearsed'),
    },
  };
}

const fmtDay = (ms: number, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms));

// ── Rendering ────────────────────────────────────────────────────────────────

const LIMIT = 6;

function lines(d: DigestContent, esc: (s: string) => string, bold: (s: string) => string): string[] {
  const out: string[] = [];
  const day = fmtDay(Date.parse(`${d.date}T12:00:00Z`), 'UTC');
  out.push(bold(`${d.final ? 'Final digest' : 'Bureau digest'}${d.campaignName ? `: ${esc(d.campaignName)}` : ''}, ${day}`));
  if (d.modeNote) out.push(esc(d.modeNote));
  out.push(`Sent ${d.totals.sent} · Rehearsed ${d.totals.rehearsed} · Skipped ${d.totals.skipped} · Needs you ${d.totals.needsYou} · Queued ${d.totals.queued}`);
  if (d.final) out.push(`Whole campaign: ${d.totals.sentAllTime} sent, ${d.totals.rehearsedAllTime} rehearsed.`);

  const apps = (title: string, list: DigestApp[]) => {
    if (!list.length) return;
    out.push('', bold(title));
    for (const a of list.slice(0, LIMIT)) out.push(`• ${esc(a.company)}: ${esc(a.role)}${a.score !== null ? ` (${a.score})` : ''} · ${esc(a.channel)}`);
    if (list.length > LIMIT) out.push(`…and ${list.length - LIMIT} more`);
  };
  apps('Sent', d.sent);
  apps('Rehearsed', d.rehearsed);

  if (d.skipped.length) {
    out.push('', bold('Skipped'));
    for (const s of d.skipped.slice(0, LIMIT)) out.push(`• ${esc(s.reason)}: ${s.count}`);
  }
  if (d.needsYou.length) {
    out.push('', bold('Needs you'));
    for (const n of d.needsYou.slice(0, LIMIT)) out.push(`• ${esc(n.company)}: ${esc(n.role)}${n.reason ? `. ${esc(n.reason.slice(0, 90))}` : ''}`);
    if (d.needsYou.length > LIMIT) out.push(`…and ${d.needsYou.length - LIMIT} more in the app`);
  }
  if (d.questions.length) {
    out.push('', bold('Questions for you'));
    for (const q of d.questions.slice(0, LIMIT)) out.push(`• ${q.shortId}${q.company ? ` (${esc(q.company)})` : ''}: ${esc(q.question.slice(0, 140))}`);
    out.push(`Answer with /answer ${esc('<id> <text>')}, or in the app.`);
  }
  const ib = d.inbox;
  if (ib.interviews.length || ib.replies || ib.rejections) {
    out.push('', bold('Inbox'));
    for (const i of ib.interviews.slice(0, LIMIT)) {
      out.push(`• ${esc(i.kind.replace('_', ' '))}: ${esc(i.company)}${i.deadline ? `, by ${esc(i.deadline.slice(0, 16))}` : ''}${i.summary ? `. ${esc(i.summary.slice(0, 100))}` : ''}`);
    }
    out.push(`${ib.replies} repl${ib.replies === 1 ? 'y' : 'ies'}, ${ib.rejections} rejection${ib.rejections === 1 ? '' : 's'}`);
  }
  const sp = d.spend;
  out.push(
    '',
    `Spend: $${sp.todayUsd.toFixed(2)} today · $${sp.campaignUsd.toFixed(2)} this campaign${sp.campaignBudgetUsd > 0 ? ` of $${sp.campaignBudgetUsd.toFixed(2)}` : ''} · $${sp.monthUsd.toFixed(2)} this month`,
  );
  if (d.gaps.length) out.push(`Top gaps this week: ${d.gaps.map((g) => `${esc(g.skill)} (${g.count})`).join(', ')}`);
  if (d.recipesPromoted.length) out.push(`Recipes promoted: ${d.recipesPromoted.map((r) => `${esc(r.ats)} (${esc(r.scope)})`).join(', ')}`);
  if (d.sourceWarnings.length) out.push(`Source warnings: ${d.sourceWarnings.map((s) => `${esc(s.source)} ${esc(s.status)}`).join(', ')}`);
  return out;
}

export function renderDigestText(d: DigestContent): string {
  return lines(d, (s) => s, (s) => s).join('\n');
}

export function renderDigestTelegram(d: DigestContent): string {
  return lines(d, escapeHtml, (s) => `<b>${s}</b>`).join('\n');
}

export function renderDigestEmailHtml(d: DigestContent): string {
  const body = lines(d, escapeHtml, (s) => `<strong>${s}</strong>`)
    .map((l) => (l ? `<div>${l}</div>` : '<br>'))
    .join('\n');
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.45;max-width:560px">${body}</div>`;
}

export function digestTitle(d: DigestContent): string {
  return `${d.final ? 'Final digest' : 'Bureau digest'}${d.campaignName ? `: ${d.campaignName}` : ''} (${d.date}): ${d.totals.sent} sent, ${d.totals.rehearsed} rehearsed`;
}

// ── Storage ──────────────────────────────────────────────────────────────────

export interface StoredDigest {
  id: string;
  campaignId: string | null;
  date: string;
  content: DigestContent;
  sentVia: string[];
}

export function saveDigest(d: DigestContent): string {
  const id = crypto.randomUUID();
  run('INSERT INTO digests (id, campaign_id, date, content, sent_via) VALUES (?, ?, ?, ?, ?)', id, d.campaignId, d.date, JSON.stringify(d), '[]');
  return id;
}

export function markDigestSent(id: string, via: string[], campaignId: string | null) {
  run('UPDATE digests SET sent_via = ? WHERE id = ?', JSON.stringify(via), id);
  emit({ type: 'digest.sent', digestId: id, campaignId, via });
}

const toStored = (r: { id: string; campaign_id: string | null; date: string; content: string; sent_via: string }): StoredDigest => ({
  id: r.id,
  campaignId: r.campaign_id,
  date: r.date,
  content: parse<DigestContent>(r.content, {} as DigestContent),
  sentVia: parse<string[]>(r.sent_via, []),
});

export function listDigests(campaignId: string | null, limit = 30): StoredDigest[] {
  return all<{ id: string; campaign_id: string | null; date: string; content: string; sent_via: string }>(
    'SELECT * FROM digests WHERE (? IS NULL OR campaign_id = ?) ORDER BY date DESC, rowid DESC LIMIT ?',
    campaignId,
    campaignId,
    limit,
  ).map(toStored);
}

export function getDigest(id: string): StoredDigest | null {
  const r = get<{ id: string; campaign_id: string | null; date: string; content: string; sent_via: string }>('SELECT * FROM digests WHERE id = ?', id);
  return r ? toStored(r) : null;
}

/** Was a regular (non-final) digest already made for this campaign and local date? */
export function digestExists(campaignId: string | null, date: string, final = false): boolean {
  return all<{ content: string }>('SELECT content FROM digests WHERE campaign_id IS ? AND date = ?', campaignId, date).some(
    (r) => !!parse<{ final?: boolean }>(r.content, {}).final === final,
  );
}
