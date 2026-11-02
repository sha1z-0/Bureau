import type { AtsFamily } from '../contracts/job.ts';
import { effectiveUrl } from '../forms/detect.ts';
import type { Clickable } from './page.ts';

/**
 * Guardrails for the browser agent. They hold whatever the model says: a
 * domain allow-list (the job's apply domain plus its ATS domains), no login or
 * payment pages, no final submit, and prompt-injection detection over every
 * piece of page text (logged, never obeyed).
 */

/** Domains each ATS family serves application pages (and their assets) from. */
export const ATS_DOMAINS: Record<AtsFamily, string[]> = {
  greenhouse: ['greenhouse.io'],
  lever: ['lever.co'],
  ashby: ['ashbyhq.com'],
  smartrecruiters: ['smartrecruiters.com'],
  workday: ['myworkdayjobs.com', 'myworkdaysite.com', 'myworkday.com', 'workday.com'],
  workable: ['workable.com'],
  recruitee: ['recruitee.com'],
  personio: ['personio.de', 'personio.com'],
  teamtailor: ['teamtailor.com'],
  bamboohr: ['bamboohr.com'],
  breezy: ['breezy.hr'],
  jazzhr: ['applytojob.com', 'jazz.co', 'jazzhr.com'],
  rippling: ['rippling.com'],
  pinpoint: ['pinpointhq.com'],
  comeet: ['comeet.com', 'comeet.co'],
  icims: ['icims.com'],
  taleo: ['taleo.net'],
  successfactors: ['successfactors.com', 'successfactors.eu', 'sapsf.com', 'sapsf.eu'],
  other: [],
};

export interface UrlPolicy {
  /** Exact hosts (host:port for loopback fixtures). */
  hosts: Set<string>;
  /** Registrable domains: any host ending in one of these is allowed. */
  suffixes: string[];
  /** Login pages: only when A05's accounts flow provides credentials (never today: A05 signs in before the agent runs). */
  allowLogin: boolean;
}

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
export const LOGIN_RE = /(^|[/.?&=_-])(log-?in|sign-?in|signin|sso|oauth2?|saml|auth|account\/(login|signin)|register|sign-?up)([/.?&=_-]|$)/i;
export const PAY_RE = /(^|[/.?&=_-])(checkout|payment|payments|billing|pay|purchase|cart|order)([/.?&=_-]|$)|(^|\.)(stripe\.com|paypal\.com|checkout\.com|adyen\.com)$/i;

function parse(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

/** example.co.uk → example.co.uk, careers.acme.com → acme.com. */
export function registrable(host: string): string {
  const parts = host.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  const second = /^(co|com|org|net|ac|gov|edu)$/.test(sld) && parts[parts.length - 1].length === 2;
  return parts.slice(second ? -3 : -2).join('.');
}

export function policyFor(urls: (string | null | undefined)[], ats: AtsFamily | null): UrlPolicy {
  const hosts = new Set<string>();
  const suffixes = new Set<string>(ats ? ATS_DOMAINS[ats] : []);
  for (const raw of urls) {
    if (!raw) continue;
    for (const u of [parse(raw), parse(effectiveUrl(raw))]) {
      if (!u || !/^https?:$/.test(u.protocol)) continue;
      hosts.add(u.host.toLowerCase());
      if (!LOOPBACK.test(u.hostname)) {
        const reg = registrable(u.hostname);
        // A shared ATS host (jobs.lever.co) is allowed through its family, not as a whole registrable domain of someone else's.
        if (reg.includes('.')) suffixes.add(reg);
      }
    }
  }
  return { hosts, suffixes: [...suffixes], allowLogin: false };
}

export function urlVerdict(raw: string, policy: UrlPolicy): { ok: boolean; why: string } {
  if (raw === 'about:blank' || raw.startsWith('data:') || raw.startsWith('blob:') || raw === 'about:srcdoc') return { ok: true, why: '' };
  const u = parse(raw);
  if (!u || !/^https?:$/.test(u.protocol)) return { ok: false, why: `not a web page (${raw.slice(0, 40)})` };
  const eff = parse(effectiveUrl(raw)) ?? u;
  const host = u.host.toLowerCase();
  const effHost = eff.hostname.toLowerCase();
  const onList =
    policy.hosts.has(host) ||
    policy.hosts.has(eff.host.toLowerCase()) ||
    (!LOOPBACK.test(u.hostname) && policy.suffixes.some((s) => u.hostname.toLowerCase() === s || u.hostname.toLowerCase().endsWith(`.${s}`))) ||
    (eff !== u && policy.suffixes.some((s) => effHost === s || effHost.endsWith(`.${s}`)));
  if (!onList) return { ok: false, why: `${eff.host} is not the job's application site` };
  const where = `${eff.hostname}${eff.pathname}${eff.search}`;
  if (PAY_RE.test(eff.pathname) || PAY_RE.test(eff.hostname)) return { ok: false, why: 'payment pages are off limits' };
  if (!policy.allowLogin && (LOGIN_RE.test(eff.pathname) || /^(login|signin|sso|auth|accounts?)\./i.test(eff.hostname))) return { ok: false, why: `login pages are off limits (${where.slice(0, 80)})` };
  return { ok: true, why: '' };
}

/** Wizard moves the agent may make (the submit gate opens for these, as it does for A05's Next). */
export const NEXT_RE = /^(next|continue|onwards?|proceed|forward|go on|save (and|&) continue|next step|continue to\b.*|weiter|→|›|»|>)(\s|$|[→›»>])/i;
/** A final submit, a share, or a payment: only A05's verified submit ever presses one of these. */
export const FINAL_RE = /^(submit|send|apply|finish|complete|confirm|place order)\b|\b(submit|send)\b[^.]{0,40}\b(application|form|cv|resume)\b|\bapply now\b|\bshare\b[^.]{0,40}\bpartners?\b|\b(pay|purchase|checkout|buy)\b/i;

export type ClickVerdict = { ok: true; next: boolean } | { ok: false; why: string };

export function clickVerdict(c: Clickable, policy: UrlPolicy): ClickVerdict {
  const name = c.name.trim();
  if (FINAL_RE.test(name)) return { ok: false, why: `"${name.slice(0, 60)}" looks like a final submit: Bureau verifies first and only then submits, never the agent` };
  const next = NEXT_RE.test(name);
  if (c.type === 'submit' && !next) return { ok: false, why: `"${name.slice(0, 60)}" is a submit button` };
  if (c.role === 'link' && /^(log ?in|sign ?in|sign ?up|register|create (an )?account)\b/i.test(name) && !policy.allowLogin) return { ok: false, why: 'login and sign-up are A05’s accounts flow, never the agent’s' };
  if (c.absHref && !/^(javascript:|#)/i.test(c.href) && !c.href.startsWith('#')) {
    const v = urlVerdict(c.absHref, policy);
    if (!v.ok) return { ok: false, why: v.why };
  }
  return { ok: true, next };
}

// ── Prompt injection ─────────────────────────────────────────────────────────

const INJECTION: RegExp[] = [
  /\bignore (all |any |the )*(previous|prior|above|earlier|preceding|your) (instructions|prompts?|directions|rules|guidelines)\b/i,
  /\b(disregard|forget|override) (all |any |the |your )*(previous |prior |above |earlier |system )?(instructions|rules|guidelines|prompts?)\b/i,
  /\bsystem (override|prompt)\b/i,
  /\b(note|message|instructions?|notice|attention) (to|for) (ai|llms?|gpt|claude|automated|the assistant|assistants|language models?|bots?|agents?)\b/i,
  /\b(ai|llm|gpt) (agents?|assistants?|tools?|applicants?|models?)\b.{0,120}\b(must|should|need to|are required|have to|enter|type|use|forward|click|visit|include|append)\b/i,
  /\bautomated (agents?|applicants?|tools?|application tools?|systems?)\b.{0,120}\b(must|should|need to|are required|have to|enter|type|use|forward|click|visit|include)\b/i,
  /(^|\s)(assistant|system)\s*:\s*\S/i,
  /\b(pre-?authori[sz]ed you|has authori[sz]ed you|do not (mention|tell|inform) (this|the user|the candidate))\b/i,
  /\byou are (now )?(an?|the) (ai|assistant|agent|language model|helpful)\b/i,
];

export interface InjectionHit {
  where: string;
  snippet: string;
}

/** Find text aimed at an AI. Returns one hit per distinct snippet. */
export function detectInjection(parts: { where: string; text: string }[]): InjectionHit[] {
  const out: InjectionHit[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    for (const re of INJECTION) {
      const m = re.exec(p.text);
      if (!m) continue;
      const start = Math.max(0, m.index - 40);
      const snippet = p.text.slice(start, m.index + m[0].length + 80).replace(/\s+/g, ' ').trim().slice(0, 200);
      const key = snippet.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ where: p.where, snippet });
    }
  }
  return out.slice(0, 20);
}
