import { all } from '../db.ts';
import type { LetterStrategy } from '../contracts/writer.ts';

/**
 * Step 14: learning from outcomes. Thompson sampling over the letter
 * strategies (hook / proof / story) and the length bands (short / medium /
 * long), as two independent Beta-Bernoulli bandits. Rewards come from
 * `outcomes` (A09 fills it): a reply that is not a rejection is a success; a
 * rejection or no reply is a failure. Applications with no outcome row yet
 * are ignored (unknown, not failed). 20% of choices explore uniformly, so a
 * strategy that started unlucky keeps getting tried.
 */

export const EXPLORE_RATE = 0.2;

export const LENGTH_ARMS = {
  short: { min: 180, max: 215 },
  medium: { min: 205, max: 250 },
  long: { min: 240, max: 280 },
} as const;
export type LengthArm = keyof typeof LENGTH_ARMS;

export interface ArmStat {
  arm: string;
  successes: number;
  failures: number;
  /** Beta posterior: alpha = 1 + successes, beta = 1 + failures. */
  alpha: number;
  beta: number;
  mean: number;
  n: number;
}

export interface BanditStats {
  strategy: ArmStat[];
  length: ArmStat[];
  outcomes: number;
  exploreRate: number;
}

/** A reply counts as a win unless it is a rejection (or a bare confirmation / verification mail). */
const NOT_A_WIN = new Set(['rejection', 'confirmation_received', 'verification_code']);

interface OutcomeRow {
  variant: string;
  style_tags: string;
  replied: number;
  reply_class: string | null;
}

export function lengthArmOf(tags: string[]): LengthArm | null {
  const t = tags.find((x) => x.startsWith('len:'));
  const arm = t?.slice(4);
  return arm && arm in LENGTH_ARMS ? (arm as LengthArm) : null;
}

export function banditStats(): BanditStats {
  const rows = all<OutcomeRow>(
    `SELECT lv.variant, lv.style_tags, o.replied, o.reply_class
       FROM outcomes o
       JOIN applications a ON a.id = o.application_id
       JOIN letter_variants lv ON lv.id = a.variant_id`,
  );
  const tally = (arms: readonly string[], key: (r: OutcomeRow) => string | null): ArmStat[] =>
    arms.map((arm) => {
      let s = 0;
      let f = 0;
      for (const r of rows) {
        if (key(r) !== arm) continue;
        if (r.replied && !NOT_A_WIN.has(r.reply_class ?? '')) s++;
        else f++;
      }
      return { arm, successes: s, failures: f, alpha: 1 + s, beta: 1 + f, mean: (1 + s) / (2 + s + f), n: s + f };
    });
  const tags = (r: OutcomeRow): string[] => {
    try {
      return JSON.parse(r.style_tags) as string[];
    } catch {
      return [];
    }
  };
  return {
    strategy: tally(['hook', 'proof', 'story'], (r) => r.variant),
    length: tally(Object.keys(LENGTH_ARMS), (r) => lengthArmOf(tags(r))),
    outcomes: rows.length,
    exploreRate: EXPLORE_RATE,
  };
}

// ── Sampling ─────────────────────────────────────────────────────────────────

function normal(rng: () => number): number {
  // Box–Muller.
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, 1) by Marsaglia–Tsang (with the shape < 1 boost). */
function gamma(shape: number, rng: () => number): number {
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(rng() || 1e-12, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = gamma(alpha, rng);
  const y = gamma(beta, rng);
  return x / (x + y);
}

export interface Pick<T> {
  choice: T;
  explored: boolean;
  samples: Record<string, number>;
}

/** Thompson sampling over `candidates` (arm names), exploring uniformly 20% of the time. */
export function thompson<T extends string>(candidates: T[], stats: ArmStat[], rng: () => number, tieBreak: (a: T) => number = () => 0): Pick<T> {
  if (!candidates.length) throw new Error('No arms to choose from');
  if (rng() < EXPLORE_RATE) {
    return { choice: candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))], explored: true, samples: {} };
  }
  const samples: Record<string, number> = {};
  let best = candidates[0];
  for (const c of candidates) {
    const s = stats.find((x) => x.arm === c) ?? { alpha: 1, beta: 1 };
    samples[c] = sampleBeta(s.alpha, s.beta, rng);
    if (samples[c] > samples[best] || (samples[c] === samples[best] && tieBreak(c) > tieBreak(best))) best = c;
  }
  return { choice: best, explored: false, samples };
}

export function pickLength(rng: () => number, stats = banditStats()): Pick<LengthArm> {
  return thompson(Object.keys(LENGTH_ARMS) as LengthArm[], stats.length, rng);
}

/**
 * Choose the letter to send among those that cleared the critic bar. Only
 * variants within one point of the best score are eligible: the bandit may
 * trade a little quality for learning, never a lot.
 */
export function pickStrategy(eligible: { strategy: LetterStrategy; score: number }[], rng: () => number, stats = banditStats()): Pick<LetterStrategy> {
  const best = Math.max(...eligible.map((e) => e.score));
  const close = eligible.filter((e) => e.score >= best - 1).map((e) => e.strategy);
  const score = (s: LetterStrategy) => eligible.find((e) => e.strategy === s)?.score ?? 0;
  return thompson(close, stats.strategy, rng, score);
}
