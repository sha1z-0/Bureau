import './schema.ts';
import { all, get } from '../db.ts';
import type { InboxClass } from '../contracts/inbox.ts';
import { atsFamilyOf, baseDomain, companyTokens, containsToken, hostOf, isEmployerHost, isFreeMail } from './domains.ts';
import type { ParsedEmail } from './parse.ts';

/**
 * Match a message to the application it is about. Signals, strongest first:
 * the thread (a reply to mail we sent or to a message already linked), the
 * sender's domain against the company's own domains, links back to the exact
 * posting, the ATS the mail came from, and the company name and job title in
 * the subject and body. A sender whose domain merely contains the company's
 * name (corvid-careers.example.biz for corvid.example.com) is treated as a
 * lookalike and pushed away, never linked.
 */

export interface AppCandidate {
  id: string;
  jobId: string;
  stage: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
  title: string;
  company: string;
  jobUrl: string;
  applyUrl: string | null;
  ats: string | null;
  applyEmail: string | null;
  toEmail: string | null;
  companyDomain: string | null;
  campaignId: string | null;
}

export interface LinkResult {
  applicationId: string | null;
  company: string | null;
  role: string | null;
  score: number;
  reasons: string[];
  ambiguous: boolean;
  lookalike: boolean;
}

const THRESHOLD = 50;
const MARGIN = 10;

export function linkCandidates(): AppCandidate[] {
  return all<{
    id: string;
    job_id: string;
    stage: string | null;
    status: string;
    sent_at: string | null;
    created_at: string;
    title: string;
    company: string;
    url: string;
    apply_url_canonical: string | null;
    ats: string | null;
    apply_email: string | null;
    to_email: string | null;
    company_domain: string | null;
    campaign_id: string | null;
  }>(
    `SELECT a.id, a.job_id, a.stage, a.status, a.sent_at, a.created_at, a.to_email, a.campaign_id,
            j.title, j.company, j.url, j.apply_url_canonical, j.ats, j.apply_email, c.domain AS company_domain
       FROM applications a JOIN jobs j ON j.id = a.job_id LEFT JOIN companies c ON c.id = j.company_id
      WHERE a.status NOT IN ('draft', 'rehearsed') OR a.sent_at IS NOT NULL`,
  ).map((r) => ({
    id: r.id,
    jobId: r.job_id,
    stage: r.stage ?? 'applied',
    status: r.status,
    sentAt: r.sent_at,
    createdAt: r.created_at,
    title: r.title,
    company: r.company,
    jobUrl: r.url,
    applyUrl: r.apply_url_canonical,
    ats: r.ats,
    applyEmail: r.apply_email,
    toEmail: r.to_email,
    companyDomain: r.company_domain,
    campaignId: r.campaign_id,
  }));
}

/** Base domains that stand for the employer itself. */
export function employerDomains(c: AppCandidate): string[] {
  const out = new Set<string>();
  const addHost = (h: string | null | undefined) => {
    if (h && isEmployerHost(h)) out.add(baseDomain(h));
  };
  if (c.companyDomain) addHost(c.companyDomain.replace(/^https?:\/\//, '').split('/')[0]);
  addHost(hostOf(c.jobUrl));
  addHost(hostOf(c.applyUrl));
  for (const e of [c.applyEmail, c.toEmail]) {
    const d = e?.split('@')[1];
    if (d && !isFreeMail(d)) addHost(d);
  }
  return [...out];
}

/** Message ids of mail we sent for each application (applications by email, follow-ups). */
function sentMessageIds(): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of all<{ application_id: string; message_id: string }>("SELECT application_id, message_id FROM inbox_followups WHERE message_id IS NOT NULL")) {
    map.set(r.message_id, r.application_id);
  }
  try {
    // A08's worker journals the SMTP message id of every application it emails.
    for (const r of all<{ job_id: string; detail: string }>("SELECT job_id, detail FROM campaign_steps WHERE step = 'submit_done' AND detail LIKE '%messageId%'")) {
      const id = (JSON.parse(r.detail) as { messageId?: string }).messageId;
      const app = get<{ id: string }>("SELECT id FROM applications WHERE job_id = ? AND (status IN ('sent','submitted') OR sent_at IS NOT NULL) ORDER BY created_at DESC LIMIT 1", r.job_id);
      if (id && app) map.set(id.startsWith('<') ? id : `<${id}>`, app.id);
    }
  } catch {
    /* campaign tables absent: no journal to read */
  }
  return map;
}

function threadMatch(email: ParsedEmail): string | null {
  const refs = [...new Set([...email.inReplyTo, ...email.references])];
  if (!refs.length) return null;
  const sent = sentMessageIds();
  for (const r of refs) if (sent.has(r)) return sent.get(r)!;
  const ph = refs.map(() => '?').join(',');
  const prior = get<{ application_id: string }>(
    `SELECT application_id FROM inbox_messages WHERE message_id IN (${ph}) AND application_id IS NOT NULL ORDER BY received_at DESC LIMIT 1`,
    ...refs,
  );
  return prior?.application_id ?? null;
}

const STOP = new Set(['and', 'the', 'for', 'with', 'of', 'in', 'at', 'to', 'a', 'an', 'senior', 'junior', 'mid', 'level', 'remote', 'i', 'ii', 'iii']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1 && !STOP.has(w));

function titleScore(title: string, hay: string): number {
  const t = title.toLowerCase().replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (t.length >= 4 && hay.includes(t)) return 25;
  const ws = words(t);
  if (!ws.length) return 0;
  const hit = ws.filter((w) => containsToken(hay, w)).length / ws.length;
  return hit >= 0.6 ? 10 : 0;
}

/** Path prefix that identifies the posting on its ATS: host + first path segment (or the whole host for tenant hosts). */
function postingKeys(url: string | null | undefined): { board: string | null; exact: string | null } {
  if (!url) return { board: null, exact: null };
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const segs = u.pathname.split('/').filter(Boolean);
    const tenantHost = host.split('.').length > 3 || /myworkdayjobs|wd\d/.test(host);
    return { board: tenantHost ? host : `${host}/${(segs[0] ?? '').toLowerCase()}`, exact: `${host}${u.pathname.replace(/\/$/, '').toLowerCase()}` };
  } catch {
    return { board: null, exact: null };
  }
}

export function scoreCandidate(email: ParsedEmail, c: AppCandidate): { score: number; reasons: string[]; lookalike: boolean } {
  const reasons: string[] = [];
  let score = 0;
  let lookalike = false;
  const sender = email.from.domain;
  const senderBase = baseDomain(sender);
  const domains = employerDomains(c);
  const tokens = companyTokens(c.company);
  const subject = email.subject.toLowerCase();
  const display = email.from.name.toLowerCase();
  const body = email.text.toLowerCase();

  if (domains.includes(senderBase)) {
    score += 60;
    reasons.push('sender domain is the company');
  } else if (!atsFamilyOf(sender) && tokens.some((t) => !t.includes(' ') && senderBase.replace(/[^a-z0-9]/g, '').includes(t.replace(/[^a-z0-9]/g, '')))) {
    lookalike = true;
    score -= 60;
    reasons.push(`lookalike domain ${senderBase}`);
  }

  const fam = atsFamilyOf(sender);
  if (fam && c.ats && fam === c.ats) {
    score += 20;
    reasons.push(`sent by ${fam}`);
  }

  const job = postingKeys(c.applyUrl ?? c.jobUrl);
  const jobAlt = postingKeys(c.jobUrl);
  let linkHit = 0;
  for (const l of email.links) {
    const k = postingKeys(l);
    if (k.exact && (k.exact === job.exact || k.exact === jobAlt.exact)) linkHit = Math.max(linkHit, 50);
    else if (k.board && atsFamilyOf(hostOf(l)) && (k.board === job.board || k.board === jobAlt.board)) linkHit = Math.max(linkHit, 40);
  }
  if (linkHit) {
    score += linkHit;
    reasons.push('links to the posting');
  }

  const nameIn = (hay: string) => tokens.some((t) => containsToken(hay, t));
  const named = nameIn(display) ? 35 : nameIn(subject) ? 30 : nameIn(body) ? 20 : 0;
  if (named) {
    score += named;
    reasons.push('names the company');
  }

  const ts = Math.max(titleScore(c.title, subject), titleScore(c.title, body));
  if (ts) {
    score += ts;
    reasons.push('mentions the role');
  }

  const startedAt = Date.parse(c.sentAt ?? c.createdAt);
  if (Number.isFinite(startedAt) && Date.parse(email.receivedAt) < startedAt - 86_400_000) {
    score -= 100;
    reasons.push('arrived before the application');
  }
  return { score, reasons, lookalike };
}

export function linkEmail(email: ParsedEmail, cls: InboxClass, candidates: AppCandidate[] = linkCandidates()): LinkResult {
  const none: LinkResult = { applicationId: null, company: null, role: null, score: 0, reasons: [], ambiguous: false, lookalike: false };
  const thread = threadMatch(email);
  if (thread) {
    const c = candidates.find((x) => x.id === thread);
    return { ...none, applicationId: thread, company: c?.company ?? null, role: c?.title ?? null, score: 100, reasons: ['same thread'] };
  }
  // Codes go to the form engine by domain; newsletters and alerts are about no one in particular.
  if (cls === 'verification_code' || (email.bulk && cls === 'other')) return none;

  const scored = candidates.map((c) => ({ c, ...scoreCandidate(email, c) })).sort((a, b) => b.score - a.score);
  const lookalike = scored.some((s) => s.lookalike);
  const best = scored[0];
  if (!best || best.score < THRESHOLD) return { ...none, lookalike, reasons: best ? best.reasons : [] };
  const second = scored[1];
  // Two applications at the same company look the same from the outside: prefer the most recent, else ask.
  if (second && second.score >= best.score - MARGIN) {
    const sameCompany = second.c.company.toLowerCase() === best.c.company.toLowerCase();
    if (!sameCompany || second.score === best.score) {
      return { ...none, ambiguous: true, lookalike, score: best.score, reasons: [`ambiguous between ${best.c.company} and ${second.c.company}`] };
    }
  }
  return { applicationId: best.c.id, company: best.c.company, role: best.c.title, score: best.score, reasons: best.reasons, ambiguous: false, lookalike };
}
