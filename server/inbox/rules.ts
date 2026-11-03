import type { InboxClass } from '../contracts/inbox.ts';
import { atsFamilyOf, baseDomain, hostOf, isAssessmentLink, isEmployerHost, isFreeMail, isSchedulingLink } from './domains.ts';
import type { ParsedEmail } from './parse.ts';
import { toInstant, zoneAfter, type WrittenTime } from './when.ts';

/**
 * Code-side pre-rules and extraction. Everything obvious (verification codes,
 * ATS confirmations, plain rejections, scheduler links, offers, newsletters)
 * is decided here at no cost; only what is genuinely ambiguous goes to Haiku.
 * Codes, links and dates are always extracted by code, never taken from the
 * model, so a crafted email cannot plant them.
 */

// ── Verification codes and links ─────────────────────────────────────────────

const CODE_KEYWORD = /\b(?:verification|security|confirmation|one[- ]?time|access|login|sign[- ]?in|authentication|temporary)\s+(?:code|passcode|pin|password)\b|\bpass ?code\b|\bOTP\b|\bverification code\b|\byour code\b|\bcode is\b/gi;
const CODE_TOKEN = /(?<![A-Za-z0-9-])(?=[A-Za-z0-9-]*\d)([A-Za-z0-9]{4,10}(?:-[A-Za-z0-9]{3,6})?)(?![A-Za-z0-9-])/g;

function plausibleCode(tok: string): boolean {
  if (/^(19|20)\d\d$/.test(tok)) return false; // a year
  if (/^\d{1,3}$/.test(tok)) return false;
  if (/^[A-Z]-?\d+$/i.test(tok)) return false; // R-10442 style requisition ids
  if (/^\d+(am|pm|px|min|mins|h|hrs|th|st|nd|rd)$/i.test(tok)) return false;
  const digits = tok.replace(/\D/g, '').length;
  if (/^[A-Za-z0-9]+$/.test(tok) && /[A-Za-z]/.test(tok) && digits < 1) return false;
  return tok.replace('-', '').length >= 4;
}

/** The code nearest after a code keyword, else null. Never logged. */
export function extractCode(text: string): string | null {
  for (const m of text.matchAll(CODE_KEYWORD)) {
    const window = text.slice(m.index! + m[0].length, m.index! + m[0].length + 160);
    for (const t of window.matchAll(CODE_TOKEN)) {
      if (plausibleCode(t[1])) return t[1];
    }
  }
  return null;
}

const VERIFY_PATH = /verif|confirm|activat|validat|magic|one[-_]?time|otp|passwordless|login[-_]?link|token=|[?&]code=/i;
const NOT_VERIFY = /privacy|unsubscribe|terms|help|support|preferences|cookie/i;

/** Links that verify an address or sign in: https only, judged on the path and query (never the host, which a lookalike controls). */
export function verificationLinks(links: string[]): string[] {
  return links.filter((l) => {
    try {
      const u = new URL(l);
      const pq = `${u.pathname}${u.search}`;
      return u.protocol === 'https:' && VERIFY_PATH.test(pq) && !NOT_VERIFY.test(pq);
    } catch {
      return false;
    }
  });
}

const ATS_BRANDS = ['workday', 'myworkday', 'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'icims', 'taleo', 'jobvite', 'bamboohr', 'teamtailor', 'recruitee', 'personio', 'successfactors', 'linkedin', 'indeed'];

/**
 * Phishing tells: a sender or link host that wears an ATS brand without being
 * that ATS (myworkday.verify-candidate.example, myworkday.com.account-verify.example),
 * or a display name claiming to be an ATS's security team from another domain.
 */
export function looksLikeSpoof(email: ParsedEmail): boolean {
  const hosts = [email.from.domain, ...email.links.map((l) => hostOf(l) ?? '')].filter(Boolean);
  for (const h of hosts) {
    if (atsFamilyOf(h)) continue;
    if (h.toLowerCase().split('.').some((label) => ATS_BRANDS.includes(label))) return true;
  }
  const name = email.from.name.toLowerCase();
  const claims = ATS_BRANDS.some((b) => name.split(/[^a-z]+/).includes(b));
  return claims && /security|account|support|verification/.test(name) && !atsFamilyOf(email.from.domain);
}

// ── Prompt-injection detection ───────────────────────────────────────────────

const INJECTION =
  /\bignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|prompts|rules)\b|\b(?:system|developer) (?:notice|prompt|message|instruction)s? (?:to|for) (?:the )?(?:ai|assistant|model|llm)\b|\bto the (?:ai|llm) (?:assistant|model|agent)\b|\bai assistant reading\b|\byou are (?:an? )?(?:ai|assistant|language model|llm)\b|\bas an ai\b|\bdisregard (?:the|all|your|any) (?:rules|instructions|guidelines)\b|<\/?\s*(?:system|assistant|email_message|instructions)\b|\bdo not tell the (?:owner|user|candidate)\b|\bclassify this (?:message|email) as\b/i;

export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text);
}

// ── Dates ────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const TIME_RE = '(?:\\s*(?:at|@|,)?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?)?';

const pad = (n: number) => String(n).padStart(2, '0');

function inferYear(month: number, day: number, ref: Date): number {
  const y = ref.getUTCFullYear();
  const candidate = Date.UTC(y, month - 1, day);
  // A date more than two months before the email is next year's ("January 5" in December).
  return candidate < ref.getTime() - 60 * 86_400_000 ? y + 1 : y;
}

function fmt(y: number, m: number, d: number, hh?: string, mm?: string, ap?: string): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  let base = `${y}-${pad(m)}-${pad(d)}`;
  if (hh && (ap || mm)) {
    let h = Number(hh);
    const meridiem = ap?.replace(/\./g, '').toLowerCase();
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    if (h <= 23) base += `T${pad(h)}:${mm ?? '00'}`;
  }
  return base;
}

interface FoundDate {
  iso: string;
  index: number;
  end: number;
  /** With a time of day: the UTC instant when a zone follows it ("3:00 PM PKT"), and the words as written. */
  time?: WrittenTime;
}

/**
 * Every calendar date written in the text, as YYYY-MM-DD (or YYYY-MM-DDTHH:MM when a time is given, the wall time
 * as written). A time followed by its zone also carries the UTC instant.
 */
export function findDates(text: string, ref: Date): FoundDate[] {
  const out: FoundDate[] = [];
  const push = (iso: string | null, index: number, end: number) => {
    if (!iso || out.some((o) => o.index === index)) return;
    const found: FoundDate = { iso, index, end };
    if (iso.includes('T')) {
      const z = zoneAfter(text.slice(end));
      const stop = z ? end + z.length : end;
      found.time = { local: iso, at: z ? toInstant(iso, z.offsetAt) : null, zone: z?.zone ?? null, text: text.slice(index, stop).replace(/\s+/g, ' ').trim() };
    }
    out.push(found);
  };
  // "Monday, November 16, 2026 at 3:00 PM", "Nov 9 or 10", "November 4 and November 11, 2026"
  const mdy = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(?:or|and|-|–|to|&)\\s*(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:]))?(?:,?\\s+(\\d{4}))?${TIME_RE}`, 'gi');
  for (const m of text.matchAll(mdy)) {
    const month = MONTHS[m[1].toLowerCase().replace('.', '')];
    const day = Number(m[2]);
    const year = m[4] ? Number(m[4]) : inferYear(month, day, ref);
    push(fmt(year, month, day, m[5], m[6], m[7]), m.index!, m.index! + m[0].length);
    if (m[3]) push(fmt(year, month, Number(m[3])), m.index! + 1, m.index! + m[0].length);
  }
  // "16 November 2026"
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\.?(?:,?\\s+(\\d{4}))?${TIME_RE}`, 'gi');
  for (const m of text.matchAll(dmy)) {
    const month = MONTHS[m[2].toLowerCase().replace('.', '')];
    const day = Number(m[1]);
    const year = m[3] ? Number(m[3]) : inferYear(month, day, ref);
    push(fmt(year, month, day, m[4], m[5], m[6]), m.index!, m.index! + m[0].length);
  }
  // ISO "2026-11-16"
  for (const m of text.matchAll(/\b(20\d\d)-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?\b/g)) {
    push(fmt(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]), m.index!, m.index! + m[0].length);
  }
  return out.sort((a, b) => a.index - b.index);
}

const DEADLINE_CUE = /\b(?:by|before|no later than|deadline(?: is|:)?|due(?: on| by)?|until|on or before|latest by|respond by|reply by)\s*(?:the\s+)?(?:end of\s+)?(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s*)?$/i;

/** "within 7 days" / "in the next 48 hours" relative to the email's date. */
function relativeDeadline(text: string, ref: Date): string | null {
  const m = /\b(?:within|in the next|in)\s+(\d{1,2}|one|two|three|five|seven|ten|fourteen)\s+(business\s+|working\s+|calendar\s+)?(days?|hours?)\b/i.exec(text);
  if (!m) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, five: 5, seven: 7, ten: 10, fourteen: 14 };
  const n = Number.isNaN(Number(m[1])) ? words[m[1].toLowerCase()] : Number(m[1]);
  const ms = /hour/i.test(m[3]) ? n * 3_600_000 : n * 86_400_000 * (m[2] && /business|working/i.test(m[2]) ? 1.4 : 1);
  return new Date(ref.getTime() + ms).toISOString().slice(0, 10);
}

export function extractDeadline(text: string, dates: FoundDate[], ref: Date): string | null {
  for (const d of dates) {
    const before = text.slice(Math.max(0, d.index - 40), d.index);
    if (DEADLINE_CUE.test(before)) return d.iso;
  }
  return relativeDeadline(text, ref);
}

// ── Sender company ───────────────────────────────────────────────────────────

const ATS_DISPLAY = /^(greenhouse|lever|workday|ashby|smartrecruiters|workable|icims|taleo|jobvite|bamboohr|teamtailor|recruitee|personio|breezy|jazzhr|rippling)$/i;
const DISPLAY_SUFFIX = /\s*(?:[-|,]\s*)?(?:via\s+\w+|(?:talent|recruiting|recruitment|careers?|hiring|people|hr|jobs)(?:\s+(?:acquisition|team|partner|operations))?|team|no-?reply)\s*$/i;

/** Best guess at the employer from the From header alone (the linker overrides it with the application's company). */
export function senderCompany(email: ParsedEmail): string | null {
  let name = email.from.name.replace(/["']/g, '').trim();
  for (let i = 0; i < 3; i++) name = name.replace(DISPLAY_SUFFIX, '').trim();
  const host = email.from.domain;
  const viaAts = !!atsFamilyOf(host);
  const local = email.from.address.split('@')[0].toLowerCase();
  const nameWords = name.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  // "Sara Malik <sara.malik@…>" or "Daniel Okafor <daniel@…>" is a person, not a company.
  const personal = !viaAts && nameWords.length >= 2 && nameWords.length <= 4 && nameWords.some((w) => local.split(/[._-]/).includes(w));
  if (name && !ATS_DISPLAY.test(name) && !personal && (viaAts || !isFreeMail(host))) return name.slice(0, 120);
  if (isEmployerHost(host)) return companyFromDomain(host);
  return null;
}

/** "harborhealth.example.com" → "Harborhealth"; documentation domains (example.*) use the label before them. */
export function companyFromDomain(host: string): string | null {
  const b = baseDomain(host);
  let label = b.split('.')[0];
  if (label === 'example') {
    const parts = host.toLowerCase().split('.');
    const i = parts.lastIndexOf('example');
    label = i > 0 ? parts[i - 1] : '';
  }
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : null;
}

// ── Pre-classification ───────────────────────────────────────────────────────

const VERIFY_WORDS = /\b(?:verification|security|confirmation|one[- ]?time|access|login|sign[- ]?in)\s+(?:code|passcode|pin)\b|\bpass ?code\b|\bOTP\b|\bverify your (?:email|account|identity|address)\b|\bconfirm your email(?: address)?\b|\bactivate your (?:account|profile)\b/i;
const CONFIRM =
  /\bwe(?:'ve| have) received your application\b|\bapplication (?:has been |was )?(?:successfully )?(?:received|submitted)\b|\bconfirms? (?:that )?we(?:'ve| have)? received\b|\bthank(?:s| you) for (?:applying|your application|submitting your application)\b[\s\S]{0,240}\b(?:received|review(?:ing)?|in touch)\b/i;
const REJECT =
  /\bunfortunately\b[\s\S]{0,220}\b(?:not (?:to )?(?:move|moving|proceed|proceeding|progress|progressing)|other candidates|another candidate|unable to (?:offer|move|progress))|\b(?:will not|won't|not) be (?:moving|progressing|proceeding) (?:forward|further)\b|\bdecided (?:not to (?:move|proceed|progress)|to (?:move|proceed|go) (?:forward|ahead) with (?:other|another))\b|\bpursue other candidates\b|\bposition has (?:now )?been filled\b|\bno longer (?:being )?considered\b|\bhave not been selected\b|\bwere not selected\b|\bregret to inform\b|\bnot to move forward\b|\bnot (?:be )?(?:moving|progressing|taking|inviting) (?:you|your application)\b|\b(?:role|position|vacancy|opening|requisition) has been (?:closed|withdrawn|cancelled|canceled|put on hold)\b|\bno longer (?:hiring|recruiting) for\b/i;
const INTERVIEW =
  /\b(?:would|'d) (?:like|love) to (?:invite you to|schedule|set up|arrange|book)\b|\binvit(?:e|ation|ing) you (?:to|for) (?:an?|the|your)? ?(?:first |second |final |technical |onsite |on-site |video |phone )?(?:interview|call|chat|conversation|meeting)\b|\binterview invitation\b|\bschedule (?:an?|your) (?:technical |first |phone |video )?(?:interview|call|chat)\b|\b(?:your|an) availability for (?:an?|the) (?:interview|call|chat)\b/i;
const ASSESSMENT = /\b(?:coding|online|technical|skills?|take[- ]home|programming) (?:assessment|challenge|test|exercise|task)\b|\btake[- ]home\b|\bcase study (?:exercise|assignment)\b/i;
/** An assessment named in passing ("our process includes an assessment centre") is not an invitation to take one. */
const ASSESSMENT_ACTION = /\b(?:complete|completing|start|begin|attempt|submit|send us|finish|take (?:the|this|our|a|it)\b|due\b|deadline)/i;
/** Agencies and sourcers: their booking link is a question for the owner, not an employer's interview. */
const SOURCER = /\b(?:sourcer|headhunter|search partners|recruit(?:ment|ing)? (?:agency|partners?|firm)|on behalf of (?:a|my|our) client|(?:my|our) client|a client of (?:ours|mine))\b/i;
const OFFER = /\b(?:pleased|delighted|happy|excited|thrilled) to (?:extend|offer)\b[\s\S]{0,60}\b(?:offer|position|role|you)\b|\boffer of employment\b|\b(?:your|the|attached) offer letter\b|\bextend (?:you )?(?:a|an) (?:formal |written |job )?offer\b|\bformal (?:job )?offer\b/i;

export interface Extraction {
  code: string | null;
  verificationLinks: string[];
  schedulingLinks: string[];
  assessmentLinks: string[];
  dates: string[];
  /** Dates with a time of day, with the UTC instant when the email wrote the zone. */
  times: WrittenTime[];
  deadline: string | null;
  company: string | null;
  suspicious: boolean;
}

export function extract(email: ParsedEmail): Extraction {
  const ref = new Date(email.receivedAt);
  const all = `${email.subject}\n${email.text}`;
  const found = findDates(email.text, ref);
  return {
    code: extractCode(all),
    verificationLinks: verificationLinks(email.links),
    schedulingLinks: email.links.filter(isSchedulingLink),
    assessmentLinks: email.links.filter(isAssessmentLink),
    dates: [...new Set(found.map((d) => d.iso))],
    times: found.flatMap((d) => (d.time ? [d.time] : [])),
    deadline: extractDeadline(email.text, found, ref),
    company: senderCompany(email),
    suspicious: looksLikeInjection(all) || looksLikeSpoof(email),
  };
}

export interface RuleVerdict {
  class: InboxClass;
  confidence: number;
  reason: string;
}

export interface Signals {
  verify: boolean;
  confirm: boolean;
  reject: boolean;
  interview: boolean;
  assessment: boolean;
  offer: boolean;
}

export function signals(email: ParsedEmail, x: Extraction): Signals {
  const all = `${email.subject}\n${email.text}`;
  return {
    verify: VERIFY_WORDS.test(all) && (!!x.code || x.verificationLinks.length > 0),
    confirm: CONFIRM.test(all),
    reject: REJECT.test(all),
    interview: x.schedulingLinks.length > 0 || INTERVIEW.test(all),
    assessment: x.assessmentLinks.length > 0 || (ASSESSMENT.test(all) && ASSESSMENT_ACTION.test(all)),
    offer: OFFER.test(all) && !email.bulk,
  };
}

/** A confident class from code alone, or null when the model should decide. */
export function preClassify(email: ParsedEmail, x: Extraction): RuleVerdict | null {
  if (x.suspicious) return null; // never let a crafted email steer the cheap path
  const s = signals(email, x);
  if (email.autoReply) return { class: 'other', confidence: 0.92, reason: 'automatic reply' };
  if (s.verify && !s.offer && !s.reject) return { class: 'verification_code', confidence: 0.96, reason: x.code ? 'verification code' : 'verification link' };
  const strong = [s.offer, s.reject, s.interview, s.assessment].filter(Boolean).length;
  if (s.offer && strong === 1) return { class: 'offer', confidence: 0.9, reason: 'offer wording' };
  if (s.reject && strong === 1) return { class: 'rejection', confidence: 0.9, reason: 'rejection wording' };
  // A sourcer's booking link is a question for the owner: the model decides.
  if (s.interview && !s.reject && !s.offer && !s.assessment && SOURCER.test(`${email.from.name}\n${email.text}`)) return null;
  if (!s.reject && !s.offer && (s.assessment || s.interview)) {
    if (s.assessment && s.interview) {
      if (x.assessmentLinks.length && !x.schedulingLinks.length) return { class: 'assessment', confidence: 0.85, reason: 'assessment platform link' };
      if (x.schedulingLinks.length && !x.assessmentLinks.length) return { class: 'interview_invite', confidence: 0.85, reason: 'scheduling link' };
      return null;
    }
    if (s.assessment) return { class: 'assessment', confidence: 0.88, reason: x.assessmentLinks.length ? 'assessment platform link' : 'assessment wording' };
    return { class: 'interview_invite', confidence: 0.88, reason: x.schedulingLinks.length ? 'scheduling link' : 'interview invitation wording' };
  }
  if (s.confirm && strong === 0) return { class: 'confirmation_received', confidence: 0.9, reason: 'application received' };
  if (email.bulk && strong === 0 && !s.confirm) return { class: 'other', confidence: 0.85, reason: 'bulk mail (newsletter or alert)' };
  return null;
}

/** ATS family of the sender, when mail comes from an ATS. */
export function senderAts(email: ParsedEmail): string | null {
  return atsFamilyOf(email.from.domain);
}
