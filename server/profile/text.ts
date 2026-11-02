import crypto from 'node:crypto';

/** Small text helpers shared by facts, the answer bank and the verbatim guard. */

export function sha(text: string, len = 20): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, len);
}

/** Canonical form for identity: case, quotes, dashes, bullets and whitespace don't make a fact new. */
export function normText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/^[\s•*·\-–]+/, '')
    .replace(/[.;,\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase word tokens (keeps tech spellings like c++, c#, node.js, 10k, 99.9%). */
export function tokens(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .match(/[a-z0-9][a-z0-9+#.%']*[a-z0-9+#%]|[a-z0-9]/g) ?? []
  ).map((t) => t.replace(/'s$/, ''));
}

/** Numbers as they'd be compared for truth: "10,000" and "10000" are the same claim. */
export function numbers(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''));
}

const GLUE = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'as', 'is', 'are', 'was', 'were', 'it', 'its', 'this', 'that', 'from', 'be']);

/**
 * Is `claim` verbatim or near-verbatim from `source`? Every number in the
 * claim must appear in the source (numbers are where embellishment hides), and
 * at least `minCoverage` of its meaningful words must too. This is the code
 * side of "never embellished": a model-extracted fact that fails it is dropped.
 */
export function isNearVerbatim(claim: string, source: string, minCoverage = 0.85): boolean {
  const claimWords = tokens(claim).filter((t) => !GLUE.has(t));
  if (!claimWords.length) return false;
  const sourceWords = new Set(tokens(source));
  const sourceNumbers = new Set(numbers(source));
  if (numbers(claim).some((n) => !sourceNumbers.has(n))) return false;
  const covered = claimWords.filter((w) => sourceWords.has(w) || sourceWords.has(w.replace(/\.$/, ''))).length;
  return covered / claimWords.length >= minCoverage;
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
