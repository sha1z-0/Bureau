import crypto from 'node:crypto';
import type { FieldKind } from '../contracts/forms.ts';

/** Text normalisation, field signatures, option matching and value comparison. Pure functions. */

export function normText(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(required\)|\(optional\)/g, ' ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The normalised label every mapping and signature uses. */
export function labelNorm(label: string): string {
  return normText(label).replace(/^(please )?(enter|provide|type|select|choose) (your |the )?/, '').trim() || normText(label);
}

/** Stable across runs: normalised label + widget kind + option set + section. */
export function signatureOf(f: { labelNorm: string; kind: string; options?: string[]; section?: string }): string {
  const opts = (f.options ?? []).map(normText).filter(Boolean).sort().join('|');
  const raw = `${f.labelNorm}\u0001${widgetFamily(f.kind)}\u0001${opts}\u0001${normText(f.section ?? '')}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

/** Kinds that are the same widget for recipe purposes. */
export function widgetFamily(kind: string): string {
  if (kind === 'tel' || kind === 'phone') return 'phone';
  if (kind === 'consent') return 'checkbox';
  return kind;
}

export function companyKey(name: string | null | undefined): string {
  return normText(name ?? '')
    .replace(/\b(inc|llc|ltd|gmbh|plc|corp|corporation|co|company|limited|ag|sa|bv|srl|pvt)\b/g, '')
    .replace(/\s+/g, '');
}

// ── Option matching ──────────────────────────────────────────────────────────

const YES = /^(yes|y|true|1|i do|i am|i have|i will|i can|agree|accept|correct|affirmative)\b/;
const NO = /^(no|n|false|0|i do not|i dont|i am not|i have not|i will not|i cannot|disagree|decline)\b/;
const DECLINE = /(decline|prefer not|do not wish|dont wish|not to (say|answer|disclose|self identify)|choose not|rather not|not specified|i dont want to answer|wish not to)/;

export function isDeclineOption(o: string): boolean {
  return DECLINE.test(normText(o));
}

export function truthy(v: string): boolean | null {
  const n = normText(v);
  if (!n) return null;
  if (DECLINE.test(n)) return null;
  if (YES.test(n)) return true;
  if (NO.test(n)) return false;
  return null;
}

function words(s: string): string[] {
  return normText(s).split(' ').filter((w) => w.length > 1 || /\d/.test(w));
}

function numericRange(o: string): [number, number] | null {
  const n = normText(o);
  let m = n.match(/^(\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = n.match(/(\d+(?:\.\d+)?)\s*\+|(?:more than|over|at least|above)\s*(\d+(?:\.\d+)?)/);
  if (m) return [Number(m[1] ?? m[2]), Infinity];
  m = n.match(/(?:less than|under|below|fewer than)\s*(\d+(?:\.\d+)?)/);
  if (m) return [-Infinity, Number(m[1]) - 0.0001];
  m = n.match(/^(\d+(?:\.\d+)?)(?: years?| yrs?)?$/);
  if (m) return [Number(m[1]), Number(m[1])];
  return null;
}

/** Score 0..1 how well an option matches the intended value. */
export function optionScore(value: string, option: string): number {
  const v = normText(value);
  const o = normText(option);
  if (!v || !o) return 0;
  if (v === o) return 1;
  const tv = truthy(value);
  const to = truthy(option);
  if (tv !== null && to !== null) return tv === to ? 0.95 : 0;
  if (isDeclineOption(value) && isDeclineOption(option)) return 0.95;
  const num = Number(v.replace(/[^\d.]/g, ''));
  const range = numericRange(option);
  if (/^\d+(\.\d+)?$/.test(v) && range) return num >= range[0] && num <= range[1] ? 0.93 : 0;
  // Country / dial-code style containment ("Pakistan (+92)" vs "Pakistan").
  if (o.startsWith(v + ' ') || o.endsWith(' ' + v) || v.startsWith(o + ' ')) return 0.9;
  if (o.includes(v) && v.length >= 3) return 0.85;
  if (v.includes(o) && o.length >= 4) return 0.8;
  const a = new Set(words(value));
  const b = new Set(words(option));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  const jac = common / (a.size + b.size - common);
  return jac >= 0.5 ? 0.5 + jac * 0.3 : jac * 0.6;
}

/** The best matching option, or null when nothing is a confident match. */
export function bestOption(value: string, options: string[], min = 0.75): string | null {
  let best: string | null = null;
  let score = 0;
  for (const o of options) {
    const s = optionScore(value, o);
    if (s > score) {
      score = s;
      best = o;
    }
  }
  return score >= min ? best : null;
}

export function declineOption(options: string[]): string | null {
  return options.find(isDeclineOption) ?? null;
}

// ── Dates ────────────────────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export interface DateParts {
  y: number;
  m: number | null;
  d: number | null;
}

/** Parse loose date text ("2021-03", "Mar 2021", "03/2021", "2021", "15/03/2021") into parts. Day-first only when unambiguous. */
export function parseDate(raw: string, dayFirst = false): DateParts | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || /present|current|now|today/.test(s)) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (m) return { y: +m[1], m: +m[2], d: m[3] ? +m[3] : null };
  m = s.match(/^(\d{1,2})[/.\-|](\d{1,2})[/.\-|](\d{2,4})$/);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (a > 12 || (dayFirst && b <= 12)) [a, b] = [b, a];
    return { y, m: a, d: b };
  }
  m = s.match(/^(\d{1,2})[/.\-|](\d{4})$/);
  if (m) return { y: +m[2], m: +m[1], d: null };
  m = s.match(/^(\d{4})[/.\-|](\d{1,2})$/);
  if (m) return { y: +m[1], m: +m[2], d: null };
  m = s.match(/([a-z]{3,9})\.?\s+(\d{1,2},?\s+)?(\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3));
    if (mi >= 0) return { y: +m[3], m: mi + 1, d: m[2] ? parseInt(m[2], 10) : null };
  }
  m = s.match(/(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3));
    if (mi >= 0) return { y: +m[3], m: mi + 1, d: +m[1] };
  }
  m = s.match(/^(\d{4})$/);
  if (m) return { y: +m[1], m: null, d: null };
  return null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Render parts in a field's format: iso, iso-month, or a pattern like MM/DD/YYYY, DD.MM.YYYY, MM/YYYY. */
export function formatDate(p: DateParts, format: string): string {
  const m = p.m ?? 1;
  const d = p.d ?? 1;
  if (format === 'iso') return `${p.y}-${pad(m)}-${pad(d)}`;
  if (format === 'iso-month') return `${p.y}-${pad(m)}`;
  return format
    .replace(/YYYY/i, String(p.y))
    .replace(/YY/i, pad(p.y % 100))
    .replace(/MM/i, pad(m))
    .replace(/DD/i, pad(d))
    .replace(/\bM\b/, String(m))
    .replace(/\bD\b/, String(d));
}

export function sameDate(a: string, b: string, format?: string): boolean {
  const dayFirst = !!format && /^DD/i.test(format);
  const pa = parseDate(a.replace(/\|/g, '/'), dayFirst);
  const pb = parseDate(b.replace(/\|/g, '/'), dayFirst);
  if (!pa || !pb) return normText(a) === normText(b);
  if (pa.y !== pb.y) return false;
  if (pa.m !== null && pb.m !== null && pa.m !== pb.m) return false;
  if (pa.d !== null && pb.d !== null && pa.d !== pb.d) return false;
  return true;
}

// ── Read-back comparison ─────────────────────────────────────────────────────

const digits = (s: string) => s.replace(/\D/g, '');

/** Did the field end up holding what we meant to put in it? */
export function valuesMatch(kind: FieldKind | string, intended: string, readBack: string, extra: { display?: string; chip?: string; format?: string } = {}): boolean {
  const i = String(intended ?? '');
  const r = String(readBack ?? '');
  switch (kind) {
    case 'tel':
    case 'phone': {
      const di = digits(i).replace(/^0+/, '');
      const dr = digits(r).replace(/^0+/, '');
      if (!di) return !dr;
      return dr.length >= 6 && (di.endsWith(dr) || dr.endsWith(di) || di.slice(-7) === dr.slice(-7));
    }
    case 'number':
      return Number(i) === Number(r) || normText(i) === normText(r);
    case 'checkbox':
    case 'consent': {
      if (/;/.test(i) || /;/.test(r)) {
        const want = i.split(';').map(normText).filter(Boolean).sort();
        const got = r.split(';').map(normText).filter(Boolean).sort();
        return want.length === got.length && want.every((w, k) => w === got[k] || optionScore(w, got[k]) >= 0.85);
      }
      const ti = truthy(i);
      const tr = truthy(r);
      if (ti !== null && tr !== null) return ti === tr;
      return normText(i) === normText(r) || optionScore(i, r) >= 0.85;
    }
    case 'date':
      return sameDate(i, r, extra.format);
    case 'file': {
      const name = normText(i.split(/[\\/]/).pop() ?? i);
      return (!!r && normText(r).includes(name)) || (!!extra.chip && normText(extra.chip).includes(name));
    }
    case 'select':
    case 'radio':
    case 'combobox':
    case 'location': {
      const cands = [r, extra.display ?? ''].filter(Boolean);
      return cands.some((c) => normText(c) === normText(i) || optionScore(i, c) >= 0.85 || (normText(c).includes(normText(i)) && normText(i).length >= 3));
    }
    case 'richtext':
    case 'textarea':
      return normText(r) === normText(i) || (normText(i).length > 40 && normText(r).startsWith(normText(i).slice(0, 40)) && Math.abs(r.length - i.length) < i.length * 0.1);
    default:
      return r.replace(/\s+/g, ' ').trim() === i.replace(/\s+/g, ' ').trim() || normText(r) === normText(i);
  }
}
