/**
 * The engine's only source of time and chance. Production uses the wall clock
 * and Math.random; tests swap in FakeClock and a seeded random so pacing,
 * active hours and dry-run day counting can be checked minute by minute.
 */

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  random: () => Math.random(),
};

/** Deterministic PRNG (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

/** A clock that only moves when told to. `advance` fires due timers in order. */
export class FakeClock implements Clock {
  private t: number;
  private timers: Timer[] = [];
  private seq = 0;
  readonly random: () => number;

  constructor(start: number | string, seed = 42) {
    this.t = typeof start === 'string' ? Date.parse(start) : start;
    this.random = seeded(seed);
  }

  now() {
    return this.t;
  }

  set(at: number | string) {
    this.t = typeof at === 'string' ? Date.parse(at) : at;
  }

  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown) {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }

  pending() {
    return this.timers.length;
  }

  /** Move time forward, firing every timer that falls due on the way (and letting their promises run). */
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = Math.max(this.t, next.at);
      next.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

/** Let queued promise callbacks run. */
export async function flush(rounds = 5) {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}
