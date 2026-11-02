import type { StyleFingerprint } from '../contracts/profile.ts';
import type { LintResult } from '../contracts/writer.ts';
import { fingerprintOf } from '../profile/voice.ts';
import { findTells } from './humanizer.ts';
import { contentNgrams, contentWords, hasTerm, letterBody, nominalRate, paragraphs, round, splitSentences, std, WORD, wordCount, words } from './text.ts';

/**
 * The stylometric lint. Every check is code with a measured value and a
 * target, never a model's opinion. A letter must pass all of them; a short
 * answer, outreach note or follow-up passes the subset that makes sense for a
 * few sentences (`lintShort`).
 *
 * Thresholds and why:
 * - burstiness: sentence-length standard deviation ≥ 0.8 × the candidate's own
 *   spread. Uniform sentence length is the most visible machine tell.
 * - lexical_diversity: moving-average type-token ratio (window 50, the same
 *   measure as the fingerprint) within ±15% of the candidate's. Model text runs
 *   high on lexical diversity and entropy (arXiv 2608.27855); edited human text
 *   stays near its author.
 * - contractions: within ±50% of the candidate's rate (absolute floor ±0.6
 *   percentage points so a formal writer is not failed for one "I'm").
 * - nominalisations: per 100 words ≤ 1.75 × the voice bank's rate + 1.5.
 *   Instruction-tuned models over-use nominalisations (Biber f_14, arXiv 2604.14111).
 * - banned phrases (the humanizer rule set), em dashes ≤ 1, no rule-of-three
 *   lists, no "I am writing to", no "I am excited/thrilled to apply", no
 *   "passionate", no closing sentence that restates the letter.
 * - the first sentence names the company, the role or a specific hook.
 * - voice adaptation: at least two voice-bank passages measurably reused
 *   (three or more shared content trigrams each).
 */

export interface LintContext {
  fingerprint: StyleFingerprint;
  /** The voice bank: the nominalisation baseline and the adaptation check. */
  voice: { id: string; text: string }[];
  /** Passage ids the writer says it adapted; the check measures them. Empty = measure all. */
  passagesUsed?: string[];
  company: string;
  role: string;
  /** Hook terms, product names and posting specifics the opening may name. */
  specifics?: string[];
  minWords?: number;
  maxWords?: number;
}

export type LintCheck = LintResult['checks'][number];
export type LetterLint = LintResult & { adaptedPassages: string[]; words: number };

const MIN_SHARED_TRIGRAMS = 3;

function check(id: string, pass: boolean, value: number | string, target: string): LintCheck {
  return { id, pass, value: typeof value === 'number' ? round(value, 3) : value, target };
}

/** "fast, cheap and reliable": three short lowercase items. Lists of named tools or numbers are not flagged. */
const TRIAD = /(?<![\w'-])([a-z][\w'-]*(?: [a-z][\w'-]*){0,2}), ([a-z][\w'-]*(?: [a-z][\w'-]*){0,2}),? (?:and|or) ([a-z][\w'-]*(?: [a-z][\w'-]*){0,2})(?![\w'-])/g;
const TRIAD_STOP = /^(?:i|we|you|they|he|she|it|the|a|an|my|our|your|their|this|that)\b/;

export function ruleOfThree(text: string): string[] {
  const hits: string[] = [];
  for (const s of splitSentences(text)) {
    TRIAD.lastIndex = 0;
    for (const m of s.matchAll(TRIAD)) {
      const items = [m[1], m[2], m[3]];
      // Items that start with a pronoun or article are clauses, not a listed triad ("I read it, we fixed it and…" still counts below).
      const lower = items.filter((x) => /^[a-z][a-z' -]*$/.test(x)).length;
      if (lower >= 2 && !TRIAD_STOP.test(m[2])) hits.push(m[0]);
    }
  }
  return hits;
}

const SUMMARY_CLOSER =
  /\b(?:in (?:short|summary|conclusion|sum)|to (?:sum up|summari[sz]e)|all in all|overall,|that's why i(?:'m| am) (?:the|a) |which is why i(?:'m| am)|my (?:combination|blend|mix) of|i(?:'m| am) confident (?:that )?(?:my|i)|(?:skills|experience) (?:and|&) (?:skills|experience|passion) (?:make|would make)|would make me)\b/i;

/** Does the last paragraph restate the letter? Stock summary phrases, or a long sentence that is mostly recycled words. */
export function closingSummary(body: string): { pass: boolean; value: string } {
  const paras = paragraphs(body);
  const last = paras[paras.length - 1] ?? '';
  const sentences = splitSentences(last);
  const restOfLetter = new Set(contentWords(paras.slice(0, -1).join('\n')));
  for (const s of sentences) {
    const m = s.match(SUMMARY_CLOSER);
    if (m) return { pass: false, value: `"${m[0].trim()}"` };
  }
  const final = sentences[sentences.length - 1] ?? '';
  const cw = contentWords(final);
  if (cw.length >= 6 && restOfLetter.size) {
    const overlap = cw.filter((x) => restOfLetter.has(x)).length / cw.length;
    if (overlap >= 0.6) return { pass: false, value: `recycles ${Math.round(overlap * 100)}% of its words` };
  }
  return { pass: true, value: 'none' };
}

/** Distinctive names in a phrase: capitalised words and tokens with digits or symbols, minus sentence-initial filler. */
function distinctiveTerms(text: string): string[] {
  return (text.match(/\b[A-Z][\w.+#-]*[A-Za-z0-9+#](?:\s+[A-Z][\w.+#-]*[A-Za-z0-9+#])*/g) ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^(The|This|That|These|Those|Our|Your|Their|We|They|It|In|On|At|For|With|And|But|A|An|I|My|Built|From)$/.test(t));
}

const COMPANY_SUFFIX = /[,.]?\s+(?:inc|incorporated|ltd|limited|llc|gmbh|plc|corp|corporation|co|pvt|technologies|labs)\.?$/i;

export function openingNames(firstSentence: string, ctx: Pick<LintContext, 'company' | 'role' | 'specifics'>): string | null {
  const company = ctx.company.replace(COMPANY_SUFFIX, '').trim();
  if (company && hasTerm(firstSentence, company)) return company;
  if (ctx.role && hasTerm(firstSentence, ctx.role)) return ctx.role;
  const roleWords = contentWords(ctx.role).filter((x) => !['senior', 'junior', 'level', 'entry', 'associate'].includes(x));
  const present = roleWords.filter((x) => hasTerm(firstSentence, x));
  if (roleWords.length >= 2 && present.length >= 2) return present.join(' ');
  for (const s of ctx.specifics ?? []) {
    for (const t of [s, ...distinctiveTerms(s)]) if (t.length >= 3 && t.split(/\s+/).length <= 6 && hasTerm(firstSentence, t)) return t;
  }
  return null;
}

/** Which voice passages a text measurably reuses (shared content trigrams). */
export function adaptedPassages(text: string, voice: { id: string; text: string }[], minShared = MIN_SHARED_TRIGRAMS): { id: string; shared: number }[] {
  const grams = contentNgrams(text, 3);
  return voice
    .map((p) => {
      let shared = 0;
      for (const g of contentNgrams(p.text, 3)) if (grams.has(g)) shared++;
      return { id: p.id, shared };
    })
    .filter((x) => x.shared >= minShared)
    .sort((a, b) => b.shared - a.shared);
}


export function lintLetter(text: string, ctx: LintContext): LetterLint {
  const body = letterBody(text);
  const fp = ctx.fingerprint;
  const me = fingerprintOf([body]);
  const sentences = splitSentences(body);
  const n = wordCount(body);
  const minW = ctx.minWords ?? 180;
  const maxW = ctx.maxWords ?? 280;
  const checks: LintCheck[] = [];

  checks.push(check('length', n >= minW && n <= maxW, n, `${minW}–${maxW} words`));

  const spreadTarget = fp.sentenceLenStd * 0.8;
  checks.push(check('burstiness', me.sentenceLenStd >= spreadTarget, me.sentenceLenStd, `sentence-length SD ≥ ${round(spreadTarget, 2)} (0.8 × your ${fp.sentenceLenStd})`));

  const lo = fp.typeTokenRatio * 0.85;
  const hi = fp.typeTokenRatio * 1.15;
  checks.push(check('lexical_diversity', me.typeTokenRatio >= lo && me.typeTokenRatio <= hi, me.typeTokenRatio, `MATTR ${round(lo, 3)}–${round(hi, 3)} (±15% of your ${fp.typeTokenRatio})`));

  const tol = Math.max(fp.contractionRate * 0.5, 0.006);
  const cr = me.contractionRate;
  checks.push(check('contractions', Math.abs(cr - fp.contractionRate) <= tol, cr, `${round(Math.max(0, fp.contractionRate - tol), 4)}–${round(fp.contractionRate + tol, 4)} (±50% of your ${fp.contractionRate})`));

  const baseNominal = ctx.voice.length ? nominalRate(ctx.voice.map((v) => v.text).join('\n\n')) : 2;
  const nomMax = baseNominal * 1.75 + 1.5;
  const nom = nominalRate(body);
  checks.push(check('nominalizations', nom <= nomMax, nom, `≤ ${round(nomMax, 2)} per 100 words (your voice bank: ${round(baseNominal, 2)})`));

  const tells = findTells(text);
  const banned = tells.filter((t) => t.category !== 'formatting');
  checks.push(check('banned_phrases', banned.length === 0, banned.length, banned.length ? `0 (found: ${[...new Set(banned.map((t) => t.match.trim()))].slice(0, 6).join('; ')})` : '0'));

  const formatting = tells.filter((t) => t.category === 'formatting');
  checks.push(check('formatting', formatting.length === 0, formatting.length, formatting.length ? `no markdown or placeholders (found: ${formatting.map((t) => t.match.trim()).slice(0, 3).join('; ')})` : 'no markdown or placeholders'));

  const dashes = (text.match(/—|–(?=\s)|\s--\s/g) ?? []).length;
  checks.push(check('em_dashes', dashes <= 1, dashes, '≤ 1'));

  const triads = ruleOfThree(body);
  checks.push(check('rule_of_three', triads.length === 0, triads.length, triads.length ? `0 (found: ${triads.slice(0, 2).join('; ')})` : '0'));

  const writingTo = tells.filter((t) => t.rule === 'opener-writing-to').length;
  checks.push(check('no_writing_to', writingTo === 0, writingTo, 'no "I am writing to"'));
  const excited = tells.filter((t) => t.rule === 'opener-excited').length;
  checks.push(check('no_excited_to_apply', excited === 0, excited, 'no "I am excited/thrilled to apply"'));
  const passionate = tells.filter((t) => t.rule === 'passionate').length;
  checks.push(check('no_passionate', passionate === 0, passionate, 'no "passionate"'));

  const closing = closingSummary(body);
  checks.push(check('closing_summary', closing.pass, closing.value, 'the last paragraph does not restate the letter'));

  const named = sentences.length ? openingNames(sentences[0], ctx) : null;
  checks.push(check('specific_opening', !!named, named ?? 'nothing specific', 'first sentence names the company, the role or a concrete hook'));

  const measured = adaptedPassages(body, ctx.passagesUsed?.length ? ctx.voice.filter((v) => ctx.passagesUsed!.includes(v.id)) : ctx.voice);
  checks.push(check('voice_adaptation', measured.length >= 2, measured.length, `≥ 2 voice-bank passages reused (≥ ${MIN_SHARED_TRIGRAMS} shared phrases each)`));

  return { pass: checks.every((c) => c.pass), checks, adaptedPassages: measured.map((m) => m.id), words: n };
}

export interface ShortLintOptions {
  maxChars?: number;
  minChars?: number;
  /** For a follow-up or outreach note the opening must still be specific. */
  company?: string;
  role?: string;
  specifics?: string[];
}

/** The subset that works on a few sentences: phrases, formatting, dashes, triads, openers, length. */
export function lintShort(text: string, opts: ShortLintOptions = {}): LintResult {
  const tells = findTells(text);
  const checks: LintCheck[] = [];
  const chars = text.trim().length;
  const max = opts.maxChars ?? 1500;
  const min = opts.minChars ?? 1;
  checks.push(check('length', chars >= min && chars <= max, chars, `${min}–${max} characters`));
  const banned = tells.filter((t) => t.category !== 'formatting');
  checks.push(check('banned_phrases', banned.length === 0, banned.length, banned.length ? `0 (found: ${[...new Set(banned.map((t) => t.match.trim()))].slice(0, 6).join('; ')})` : '0'));
  const formatting = tells.filter((t) => t.category === 'formatting');
  checks.push(check('formatting', formatting.length === 0, formatting.length, 'no markdown or placeholders'));
  const dashes = (text.match(/—|–(?=\s)|\s--\s/g) ?? []).length;
  checks.push(check('em_dashes', dashes <= 1, dashes, '≤ 1'));
  const triads = ruleOfThree(text);
  checks.push(check('rule_of_three', triads.length === 0, triads.length, '0'));
  if (opts.company || opts.role) {
    const first = splitSentences(letterBody(text))[0] ?? '';
    const named = openingNames(first, { company: opts.company ?? '', role: opts.role ?? '', specifics: opts.specifics });
    checks.push(check('specific_opening', !!named, named ?? 'nothing specific', 'first sentence names the company, the role or a concrete hook'));
  }
  return { pass: checks.every((c) => c.pass), checks };
}

/** Sentences to target when a whole-text measure fails: the most typical-length ones for burstiness, the most repetitive for diversity. */
export function targetSentences(text: string, failing: string[]): string[] {
  const body = letterBody(text);
  const sentences = splitSentences(body);
  const out = new Set<string>();
  if (failing.includes('burstiness')) {
    const lens = sentences.map((s) => (s.match(WORD) ?? []).length);
    const m = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
    sentences
      .map((s, i) => ({ s, d: Math.abs(lens[i] - m) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .forEach((x) => out.add(x.s));
  }
  if (failing.includes('lexical_diversity') || failing.includes('nominalizations')) {
    sentences
      .map((s) => ({ s, score: failing.includes('nominalizations') ? nominalRate(s) : -new Set(words(s)).size / Math.max(1, words(s).length) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .forEach((x) => out.add(x.s));
  }
  if (failing.includes('specific_opening') && sentences[0]) out.add(sentences[0]);
  if (failing.includes('closing_summary') && sentences.length) out.add(sentences[sentences.length - 1]);
  if (failing.includes('rule_of_three')) for (const s of sentences) if (ruleOfThree(s).length) out.add(s);
  if (failing.includes('em_dashes')) for (const s of sentences) if (/—|–\s|\s--\s/.test(s)) out.add(s);
  if (failing.includes('contractions')) sentences.slice(0, 4).forEach((s) => out.add(s));
  return [...out];
}

/** Spread of sentence lengths, exposed for reports. */
export function sentenceSpread(text: string): number {
  return round(std(splitSentences(letterBody(text)).map((s) => (s.match(WORD) ?? []).length)), 2);
}
