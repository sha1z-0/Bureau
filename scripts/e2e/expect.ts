import type { ExpectedData, FormSpec } from './manifest.ts';

/** One recorded POST to the fixture server. */
export interface SubmittedFile {
  field: string;
  filename: string;
  size: number;
  sha256: string;
  mime: string;
  isPdf: boolean;
}

export interface Submission {
  seq: number;
  formId: string;
  ats: string;
  /** Sub-path after /__submit/<formId>/ (wizard step, "final", …); empty for single-page forms. */
  step: string;
  origin: 'a' | 'b';
  ts: string;
  method: string;
  path: string;
  contentType: string;
  fields: Record<string, string[]>;
  files: SubmittedFile[];
  /** Fixture session (Workday account flows), when the request carried one. */
  session: string | null;
  valid: boolean;
  errors: string[];
  /** e.g. injection_canary, honeypot, captcha_missing. */
  flags: string[];
  /** Final submissions count towards "applications"; step saves do not. */
  final: boolean;
}

const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (answer|say|disclose)|choose not|rather not|i do not want to answer/i;
const TRUE = /^(on|true|yes|1|checked|y)$/i;

/** Lowercase, collapse whitespace, strip URL schemes/trailing slashes and phone punctuation. */
export function norm(v: string): string {
  let s = v.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  s = s.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  if (/^[+()\d\s.-]{7,}$/.test(s)) s = s.replace(/[^\d]/g, '');
  return s;
}

function eqLoose(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  // Phones: accept the national number with or without the country code or the trunk 0.
  if (/^\d{7,}$/.test(na) && /^\d{7,}$/.test(nb)) {
    const [a, b] = [na.replace(/^0+/, ''), nb.replace(/^0+/, '')];
    return a.endsWith(b) || b.endsWith(a);
  }
  return false;
}

export function valuesOf(sub: Submission, key: string): string[] {
  return sub.fields[key] ?? [];
}

export interface ExpectationResult {
  key: string;
  rule: string;
  ok: boolean;
  got: string;
}

/** Evaluate a form's `expect` rules against one recorded submission. */
export function checkExpectations(spec: FormSpec, sub: Submission, data: ExpectedData): ExpectationResult[] {
  const out: ExpectationResult[] = [];
  for (const [key, rule] of Object.entries(spec.expect)) {
    const vals = valuesOf(sub, key).filter((v) => v !== '');
    const got = vals.join(' | ');
    let ok: boolean;
    if (rule.startsWith('profile:') || rule.startsWith('answer:')) {
      const want = rule.startsWith('profile:') ? data[rule.slice(8)] : data.answers[rule.slice(7)];
      if (typeof want !== 'string') throw new Error(`expected.json has no ${rule}`);
      ok = vals.some((v) => eqLoose(v, want));
    } else if (rule.startsWith('oneOf:')) {
      ok = vals.some((v) => rule.slice(6).split('|').some((w) => eqLoose(v, w)));
    } else if (rule.startsWith('file:')) {
      ok = sub.files.some((f) => f.field === key && f.isPdf && f.size > 0);
    } else if (rule === 'nonempty') {
      ok = vals.some((v) => v.trim() !== '') || sub.files.some((f) => f.field === key && f.size > 0);
    } else if (rule === 'empty') {
      ok = vals.every((v) => v.trim() === '');
    } else if (rule === 'decline') {
      ok = vals.some((v) => DECLINE.test(v));
    } else if (rule === 'true') {
      ok = vals.some((v) => TRUE.test(v));
    } else if (rule === 'false') {
      ok = vals.every((v) => !TRUE.test(v));
    } else if (rule.startsWith('contains:')) {
      ok = vals.some((v) => norm(v).includes(norm(rule.slice(9))));
    } else {
      ok = vals.some((v) => eqLoose(v, rule.slice(1)));
    }
    out.push({ key, rule, ok, got: got || (sub.files.find((f) => f.field === key)?.filename ?? '') });
  }
  return out;
}
