import crypto from 'node:crypto';
import { NotImplemented } from '../contracts/stub.ts';
import type { InboxClass } from '../contracts/inbox.ts';
import { get, logEvent } from '../db.ts';
import { redact } from '../errors.ts';
import { emit } from '../services/bus.ts';
import { CODE_TTL_MS, holdCode } from './codes.ts';
import { classifyEmail, type Classification } from './classify.ts';
import { inboxDeps } from './deps.ts';
import { linkCandidates, linkEmail, type LinkResult } from './link.ts';
import { getByMessageId, saveMessage, type DraftReply, type StoredMessage } from './messages.ts';
import { parseEmail, type ParsedEmail } from './parse.ts';
import { inboxSettings } from './settings.ts';
import { advanceStage, recordOutcome } from './stage.ts';
import { publicUrl } from './url.ts';

/**
 * One message, end to end: parse → classify → link → store → act. Acting means
 * holding verification codes for the form engine, moving the application's
 * stage, writing the bandit's outcome, alerting the owner about interviews,
 * assessments and offers (with a learning plan), and drafting (never sending)
 * answers to simple recruiter questions. Nothing here ever replies to anyone.
 */

const PREVIEW = 1_500;
/** How long an alert waits for its learning plan before going out without it. */
export const PLAN_WAIT_MS = 60_000;

const ALERT_CLASSES: readonly InboxClass[] = ['interview_invite', 'assessment', 'offer'];

function fallbackSummary(cls: InboxClass, company: string | null, email: ParsedEmail, c: Classification): string {
  const who = company ?? email.from.name ?? email.from.domain;
  const dl = c.deadline ? ` by ${c.deadline}` : '';
  switch (cls) {
    case 'verification_code':
      return `${c.x.code ? 'Verification code' : 'Verification link'} from ${who} (hidden).`;
    case 'confirmation_received':
      return `${who} confirmed they received the application.`;
    case 'rejection':
      return `${who} is not moving forward with the application.`;
    case 'interview_invite':
      return `${who} wants to schedule an interview${c.x.schedulingLinks.length ? ' (booking link inside)' : ''}${dl ? `; reply${dl}` : ''}.`;
    case 'assessment':
      return `${who} sent an assessment to complete${dl}.`;
    case 'offer':
      return `${who} made an offer${dl ? `; respond${dl}` : ''}.`;
    case 'recruiter_question':
      return `${who} asked a question.`;
    default:
      return email.subject.slice(0, 160);
  }
}

/** The day the interview (or assessment due date) most likely falls on. */
export function interviewDateFor(cls: InboxClass, dates: string[], deadline: string | null, receivedAt: string): string | null {
  const day = receivedAt.slice(0, 10);
  const future = dates.filter((d) => d.slice(0, 10) >= day).sort();
  if (cls === 'assessment') return deadline ?? future[0] ?? null;
  const notDeadline = future.filter((d) => d.slice(0, 10) !== deadline);
  return notDeadline[0] ?? future[0] ?? deadline ?? null;
}

/** Build the stored record from a parsed email, its class and its link. */
export function buildRecord(email: ParsedEmail, c: Classification, link: LinkResult): StoredMessage {
  const company = link.company ?? c.company;
  const isCode = c.class === 'verification_code';
  return {
    id: crypto.randomUUID(),
    messageId: email.messageId,
    from: email.from.name ? `${email.from.name} <${email.from.address}>` : email.from.address,
    subject: email.subject,
    receivedAt: email.receivedAt,
    class: c.class,
    confidence: c.confidence,
    company,
    code: null,
    // Verification links are credentials: never stored.
    links: isCode ? [] : email.links.slice(0, 30),
    schedulingLinks: isCode ? [] : c.x.schedulingLinks,
    dates: c.dates,
    summary: c.summary || fallbackSummary(c.class, company, email, c),
    deadline: c.deadline,
    applicationId: link.applicationId,
    role: link.role ?? c.role,
    preview: isCode ? null : email.text.slice(0, PREVIEW),
    suspicious: c.suspicious,
    needsReview: c.needsReview || link.ambiguous,
    via: c.via,
    reason: c.reason,
    link: { score: link.score, reasons: link.reasons, ambiguous: link.ambiguous, lookalike: link.lookalike },
    questions: c.questions,
    draft: null,
    unanswered: [],
    interviewDate: ALERT_CLASSES.includes(c.class) ? interviewDateFor(c.class, c.dates, c.deadline, email.receivedAt) : null,
    planId: null,
    alerted: false,
    stage: null,
    handled: false,
  };
}

function firstName(from: string): string {
  const name = from.replace(/<[^>]*>/, '').trim();
  const first = name.split(/\s+/)[0] ?? '';
  return /^[A-Za-z][A-Za-z'-]{1,30}$/.test(first) && !/^(the|no|noreply|team|hiring|talent)$/i.test(first) ? first : 'there';
}

function ownerName(): string {
  const row = get<{ data: string }>('SELECT data FROM profile WHERE id = 1');
  try {
    return (JSON.parse(row?.data ?? '{}') as { name?: string }).name?.trim() || '';
  } catch {
    return '';
  }
}

/** Answer simple recruiter questions from the answer bank, as a draft for the owner. Never sent. */
async function draftReply(m: StoredMessage, email: ParsedEmail): Promise<{ draft: DraftReply | null; unanswered: string[] }> {
  const deps = inboxDeps();
  if (!m.questions.length) return { draft: null, unanswered: [] };
  const jobId = m.applicationId ? (get<{ job_id: string }>('SELECT job_id FROM applications WHERE id = ?', m.applicationId)?.job_id ?? null) : null;
  const answers: DraftReply['answers'] = [];
  const unanswered: string[] = [];
  for (const q of m.questions) {
    let a = null;
    try {
      a = await deps.answerFor(q, jobId);
    } catch (err) {
      if (!(err instanceof NotImplemented)) logEvent('inbox', `Answer bank lookup failed: ${redact((err as Error).message).slice(0, 120)}`);
    }
    if (a && a.confidence >= 0.85 && a.value.trim()) answers.push({ question: q, answer: a.value.trim(), source: a.source, confidence: a.confidence });
    else unanswered.push(q);
  }
  if (unanswered.length || !answers.length) return { draft: null, unanswered };
  const name = ownerName();
  const role = m.role ? ` about the ${m.role} role` : '';
  const lines =
    answers.length === 1
      ? [answers[0].answer.endsWith('.') ? answers[0].answer : `${answers[0].answer}.`]
      : answers.map((a) => `- ${a.question.replace(/\?$/, '')}: ${a.answer}`);
  const body = [`Hi ${firstName(m.from)},`, '', `Thanks for getting in touch${role}.`, '', ...lines, '', 'Best regards,', name].join('\n').trim();
  const to = email.replyTo ?? email.from.address;
  return {
    draft: { to, subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, body, answers, status: 'queued' },
    unanswered: [],
  };
}

function alertTitle(m: StoredMessage): string {
  const kind = m.class === 'interview_invite' ? 'Interview invite' : m.class === 'assessment' ? 'Assessment' : 'Offer';
  const who = [m.company, m.role].filter(Boolean).join(', ') || m.from;
  return `${kind}: ${who}`;
}

function alertBody(m: StoredMessage, plan: { id: string; days: number; gaps: string[] } | null): string {
  const lines = [m.summary];
  if (m.deadline) lines.push(`Deadline: ${m.deadline}`);
  if (m.interviewDate && m.class !== 'assessment') lines.push(`Likely date: ${m.interviewDate.replace('T', ' ')}`);
  if (m.schedulingLinks[0]) lines.push(`Booking link: ${m.schedulingLinks[0]}`);
  const assess = m.links.find((l) => /hackerrank|codility|codesignal|testgorilla|coderbyte|hackerearth|karat|qualified|coderpad|devskiller/i.test(l));
  if (m.class === 'assessment' && assess) lines.push(`Assessment link: ${assess}`);
  if (plan) lines.push(`Learning plan: ${plan.days} day${plan.days === 1 ? '' : 's'}${plan.gaps.length ? `, focus ${plan.gaps.slice(0, 3).join(', ')}` : ''}. ${publicUrl(`/learning/plans/${plan.id}`)}`);
  if (m.needsReview) lines.push('(Bureau is not sure about this one: check the email.)');
  if (!m.applicationId) lines.push('Not linked to an application yet.');
  lines.push('Bureau never replies to this: it is yours to answer.');
  return lines.join('\n');
}

const sleep = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms));

/** Run (or re-run, after a crash) the side effects for a stored message. Idempotent where it matters. */
export async function act(m: StoredMessage, email: ParsedEmail | null, opts: { planWaitMs?: number } = {}): Promise<StoredMessage> {
  const deps = inboxDeps();
  const s = inboxSettings();

  if (m.suspicious) {
    if (!m.alerted) {
      await deps.notify('info', {
        title: `Suspicious email held: ${m.subject.slice(0, 80)}`,
        body: `From ${m.from}. It contains instructions aimed at an AI or asks for sensitive details, so Bureau did nothing with it. Treat any links in it with care.`,
        url: publicUrl(`/inbox/${m.id}`),
      });
      m.alerted = true;
    }
    m.handled = true;
    saveMessage(m);
    return m;
  }

  // Stage and outcome (only for a linked, confident reply).
  if (m.applicationId && !m.stage) {
    const ch = advanceStage(m.applicationId, m.class, m.confidence);
    if (ch.changed) m.stage = { from: ch.from, to: ch.to };
    if (m.confidence >= 0.6) recordOutcome(m.applicationId, m.class, m.receivedAt);
  }

  if (m.class === 'recruiter_question' && s.draftReplies && email && !m.draft && !m.unanswered.length) {
    const { draft, unanswered } = await draftReply(m, email);
    m.draft = draft;
    m.unanswered = unanswered;
    for (const q of unanswered) {
      try {
        await deps.recordUnknown(q);
      } catch {
        /* the queue is a convenience */
      }
    }
    saveMessage(m);
    await deps.notify('info', {
      title: `Recruiter question: ${m.company ?? m.from}`,
      body: `${m.summary}${draft ? '\nA reply from your answer bank is drafted for you to check and send yourself.' : unanswered.length ? `\nNot in your answer bank yet: ${unanswered.join(' | ')}` : ''}`,
      applicationId: m.applicationId,
      url: publicUrl(`/inbox/${m.id}`),
    });
  }

  if (ALERT_CLASSES.includes(m.class) && !m.alerted) {
    let plan: { id: string; days: number; gaps: string[] } | null = null;
    let pending: Promise<{ id: string; days: number; gaps: string[] } | null> | null = null;
    if (m.applicationId && m.class !== 'offer') {
      pending = deps.buildPlan(m.applicationId, m.interviewDate, m.receivedAt).catch((err) => {
        if (!(err instanceof NotImplemented)) logEvent('inbox', `Learning plan failed: ${redact((err as Error).message).slice(0, 160)}`);
        return null;
      });
      plan = await Promise.race([pending, sleep(opts.planWaitMs ?? PLAN_WAIT_MS)]);
    }
    if (plan) m.planId = plan.id;
    await deps.notify('alert', { title: alertTitle(m), body: alertBody(m, plan), applicationId: m.applicationId, url: publicUrl(plan ? `/learning/plans/${plan.id}` : `/inbox/${m.id}`) });
    m.alerted = true;
    if (m.applicationId) {
      emit({
        type: 'alert.interview',
        applicationId: m.applicationId,
        company: m.company ?? 'Unknown',
        role: m.role ?? '',
        kind: m.class as 'interview_invite' | 'assessment' | 'offer',
        deadline: m.deadline,
        planId: m.planId,
      });
    }
    // The plan was slow: send it on when it lands.
    if (!plan && pending) {
      const id = m.id;
      void pending.then(async (late) => {
        if (!late) return;
        const { getMessage } = await import('./messages.ts');
        const cur = getMessage(id);
        if (cur && !cur.planId) {
          cur.planId = late.id;
          saveMessage(cur);
        }
        await deps.notify('info', { title: `Learning plan ready: ${m.company ?? ''}`.trim(), body: `${late.days} days${late.gaps.length ? `, focus ${late.gaps.slice(0, 3).join(', ')}` : ''}.`, url: publicUrl(`/learning/plans/${late.id}`) });
      });
    }
  }

  m.handled = true;
  saveMessage(m);
  return m;
}

/** Process one raw message. Returns the stored record, or null when it was already handled. */
export async function processRaw(raw: Buffer, opts: { internalDate?: Date | null; planWaitMs?: number } = {}): Promise<StoredMessage | null> {
  const deps = inboxDeps();
  const email = await parseEmail(raw, opts.internalDate ?? null);
  const existing = getByMessageId(email.messageId);
  if (existing?.handled) return null;
  if (existing) return act(existing, email, opts); // crashed mid-way last time

  const c = await classifyEmail(email);
  const link = c.class === 'verification_code' ? linkEmail(email, c.class, []) : linkEmail(email, c.class, linkCandidates());
  const m = buildRecord(email, c, link);

  if (c.class === 'verification_code') {
    const fresh = deps.now() - Date.parse(email.receivedAt) < CODE_TTL_MS;
    const value = c.x.code ?? c.x.verificationLinks[0] ?? null;
    if (value && fresh) holdCode({ value, kind: c.x.code ? 'code' : 'link', senderHost: email.from.domain, links: email.links, company: c.company });
    logEvent('inbox', `Verification ${c.x.code ? 'code' : 'link'} from ${email.from.domain}${fresh ? ' held for the form engine' : ' (too old, ignored)'}`);
  }

  saveMessage(m); // handled = 0 until the effects finish
  const done = await act(m, email, opts);
  emit({ type: 'inbox.message', id: done.id, class: done.class, applicationId: done.applicationId });
  return done;
}
