import type { Letter, Strategy, Verdict } from '../writer.ts';

/** A letter variant with the critic's verdict on it. */
export function v(strategy: Strategy, passagesUsed: string[], text: string, score: number, scores: Verdict['scores'], demands: string[] = []): Letter {
  return { strategy, passagesUsed, text, verdict: { score, scores, demands } };
}

/** The revision of a variant: the critic's demands applied as exact edits, then re-scored. */
export function revise(strategy: Strategy, passagesUsed: string[], text: string, edits: [string, string][], score: number, scores: Verdict['scores']): Letter {
  let out = text;
  for (const [from, to] of edits) {
    if (!out.includes(from)) throw new Error(`revise(${strategy}): "${from.slice(0, 60)}" is not in the letter`);
    out = out.replace(from, to);
  }
  return v(strategy, passagesUsed, out, score, scores);
}
