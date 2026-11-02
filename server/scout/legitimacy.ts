import type { Legitimacy, RawJob } from '../contracts/job.ts';

/**
 * Ghost and scam filter. Nothing is deleted: the verdict is stored on the job
 * (`jobs.legitimacy`) and the matcher skips anything that isn't `ok`.
 *
 *   scam    payment requests, crypto/"easy money" bait, or a personal-email-only
 *           route combined with another red flag
 *   ghost   past the campaign's max age, reposted 3+ times, past its apply-by
 *           date, an evergreen "talent pool" listing, or no way to apply at all
 *   suspect weak signals: personal email only, no company name, a near-empty
 *           description from a non-ATS source
 */

const PAYMENT = /\b(registration|processing|application|training|onboarding|joining|security|visa processing|kit)\s+(fee|deposit|charges?)\b|\bpay (a|the|an) (small )?(fee|deposit)\b|\b(send|transfer) (us )?(money|payment|funds)\b|\bwestern union\b|\bmoneygram\b|\bgift ?cards?\b|\bpurchase (your own )?(equipment|starter kit)\b/i;
const CRYPTO_BAIT = /\b(earn|make)\s+\$?\d[\d,]*\s*(\+\s*)?(per|a|\/)\s*(day|hour|week)\b.{0,60}\b(from home|no experience)|\bguaranteed (income|returns|profit)\b|\b(crypto|forex|bitcoin|usdt)\s+(trading|investment|signals?)\s+(opportunity|job|role)|\bcontact (us |me )?(on|via) (telegram|whatsapp) (only|to apply)\b|\bno interview (required|needed)\b.{0,80}\b(paid|earn)/i;
const PERSONAL_MAIL = /@(gmail|yahoo|hotmail|outlook|live|aol|icloud|proton(mail)?|ymail|mail)\.(com|me|co\.\w+)$/i;
const EVERGREEN = /\b(talent (pool|community|network)|general (application|interest)|future (opportunities|openings|roles)|expression of interest|open application|spontaneous application|join our talent)\b/i;

const NEGATED = /\b(never|not|no|don't|do not|won't|will not|without|against|free of charge|beware|scam|fraud|phishing)\b/i;

/** True when `re` matches in a sentence that isn't a disclaimer ("we will never ask you to pay a fee"). */
export function affirmed(re: RegExp, text: string): boolean {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(g)) {
    const at = m.index ?? 0;
    const from = Math.max(text.lastIndexOf('.', at), text.lastIndexOf('\n', at), text.lastIndexOf('!', at)) + 1;
    const ends = [text.indexOf('.', at), text.indexOf('\n', at)].filter((i) => i >= 0);
    const sentence = text.slice(from, ends.length ? Math.min(...ends) : undefined);
    if (!NEGATED.test(sentence)) return true;
  }
  return false;
}

export interface LegitimacyInput {
  job: RawJob;
  /** Distinct postings of this same role by the same source and place (reposts). */
  repostCount?: number;
  maxAgeDays: number;
  /** The posting points at an employer ATS or carries an apply email. */
  hasApplyRoute: boolean;
  fromAts: boolean;
  now?: number;
}

export function assessLegitimacy(i: LegitimacyInput): { legitimacy: Legitimacy; reasons: string[] } {
  const now = i.now ?? Date.now();
  const j = i.job;
  const text = `${j.title}\n${j.descriptionText ?? ''}`.slice(0, 30_000);
  const reasons: string[] = [];
  const personalOnly = !!j.applyEmail && PERSONAL_MAIL.test(j.applyEmail) && !i.fromAts;

  if (affirmed(PAYMENT, text)) reasons.push('asks the candidate for money');
  if (affirmed(CRYPTO_BAIT, text)) reasons.push('easy-money or crypto bait');
  if (reasons.length) {
    if (personalOnly) reasons.push('personal email only');
    // An employer's own ATS board is almost never a scam: flag it for a look instead.
    return { legitimacy: i.fromAts ? 'suspect' : 'scam', reasons };
  }

  if (j.postedAt && now - Date.parse(j.postedAt) > i.maxAgeDays * 86_400_000) reasons.push(`older than ${i.maxAgeDays} days`);
  if ((i.repostCount ?? 0) >= 3) reasons.push(`reposted ${i.repostCount} times`);
  if (EVERGREEN.test(j.title)) reasons.push('evergreen talent-pool listing');
  if (!i.hasApplyRoute && !/^https?:\/\//i.test(j.url)) reasons.push('no way to apply');
  if (reasons.length) return { legitimacy: 'ghost', reasons };

  if (personalOnly) reasons.push('personal email only');
  if (/^(unknown|confidential|n\/a|-)?$/i.test(j.company.trim())) reasons.push('no company name');
  if (!i.fromAts && (j.descriptionText ?? '').trim().length < 80) reasons.push('almost no description');
  return { legitimacy: reasons.length ? 'suspect' : 'ok', reasons };
}

/** Freshness and hiring-signal boost the matcher reads from `jobs.priority`: +2 posted within `freshHours`, +1 company has a fresh hiring signal. */
export function priorityFor(postedAt: string | null | undefined, companyHasSignal: boolean, freshHours = 48, now = Date.now()): number {
  let p = 0;
  if (postedAt && now - Date.parse(postedAt) <= freshHours * 3_600_000) p += 2;
  if (companyHasSignal) p += 1;
  return p;
}
