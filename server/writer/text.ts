import { splitSentences } from '../profile/voice.ts';

/**
 * Text measurement shared by the lint, the truth lock and the humanizer. The
 * sentence splitter and word pattern are A03's (profile/voice.ts), so a letter
 * is measured exactly the way the voice-bank fingerprint was.
 */

export { splitSentences };

export const WORD = /[A-Za-z0-9]+(?:['’][A-Za-z]+)*/g;

export function words(text: string): string[] {
  return (text.match(WORD) ?? []).map((w) => w.toLowerCase().replace(/’/g, "'"));
}

export function wordCount(text: string): number {
  return (text.match(WORD) ?? []).length;
}

export const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself i'm i've i'd i'll it's that's don't didn't doesn't isn't wasn't can't won't we're you're they're there's let's what's also still really get got make made one two much many like well even way thing things lot back`.split(
    /\s+/,
  ),
);

export function contentWords(text: string): string[] {
  return words(text).filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** Word n-grams with at least one content word, so "i want to" never counts as shared voice. */
export function contentNgrams(text: string, n = 3): Set<string> {
  const ws = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) {
    const gram = ws.slice(i, i + n);
    if (gram.some((w) => w.length > 2 && !STOPWORDS.has(w))) out.add(gram.join(' '));
  }
  return out;
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive whole-term test that copes with terms like "C++", "Node.js" and ".NET". */
export function hasTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(t)}(?![A-Za-z0-9+#])`, 'i');
  return re.test(text);
}

const GREETING = /^(dear|hi|hello|hey|to)\b[^\n]{0,80}[,:!]?\s*$/i;
const SIGNOFF = /^(best|best regards|kind regards|regards|warm regards|thanks|thank you|many thanks|cheers|sincerely|yours sincerely|yours truly|all the best|warmly|with thanks)[,.!]?\s*$/i;

/** The prose of a letter: no greeting line, no sign-off or signature block. */
export function letterBody(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start++;
  if (start < lines.length && GREETING.test(lines[start].trim())) start++;
  let end = lines.length;
  for (let i = lines.length - 1; i >= start; i--) {
    if (SIGNOFF.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

export function paragraphs(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function std(xs: number[]): number {
  if (!xs.length) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

export const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Nominalisations per 100 words (Biber f_14: instruction-tuned models overuse them). */
const NOMINAL = /^[a-z]{4,}(?:tion|tions|sion|sions|ment|ments|ness|nesses|ity|ities|ance|ances|ence|ences|ancy|ency|ization|izations)$/;
const NOT_NOMINAL = new Set(['since', 'once', 'hence', 'whence', 'fence', 'fences', 'city', 'cities', 'pity', 'entity', 'mention', 'question', 'questions', 'station']);

export function nominalRate(text: string): number {
  const ws = words(text);
  if (!ws.length) return 0;
  const n = ws.filter((w) => NOMINAL.test(w) && !NOT_NOMINAL.has(w)).length;
  return (n / ws.length) * 100;
}

/** Numbers 2–20 written as words, for the figure check ("three days" is a figure too). */
export const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
  thousand: 1000,
};

/** A small seeded PRNG (mulberry32) so tests and recordings are deterministic. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
