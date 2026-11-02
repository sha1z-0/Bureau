/**
 * A pinned clock for the e2e, so recorded Claude responses keep matching.
 *
 * Replay recordings are keyed by a hash of the prompt, and several prompts
 * carry the date: posting dates (the e2e feeds are shifted to "today"), the
 * research news window ("2026-05 onward"), "today" in learning plans. On the
 * wall clock those hashes change every day or month and the recordings rot.
 *
 * With BUREAU_E2E_NOW=<ISO instant> set, `Date` starts at that instant and then
 * runs at real speed (timeouts, waits and elapsed-time checks are unaffected;
 * a run that starts at 09:00 UTC stays on the same day). The e2e process installs
 * it first thing, and every child it spawns (autopilot worker, the real server)
 * loads this module with `--import` and inherits the offset through
 * BUREAU_E2E_CLOCK_OFFSET, so all of them read the same time.
 * performance.now() and timers are untouched. Nothing outside the e2e uses it.
 * BUREAU_E2E_NOW=wall runs the e2e on the real clock (recordings will miss).
 */

export const E2E_NOW_DEFAULT = '2026-11-02T09:00:00.000Z';

let installed = false;

export function installClock(iso: string | undefined = process.env.BUREAU_E2E_NOW): boolean {
  if (installed || !iso || iso === 'wall') return installed;
  const pin = Date.parse(iso);
  if (!Number.isFinite(pin)) throw new Error(`BUREAU_E2E_NOW is not a date: ${iso}`);
  const RealDate = Date;
  // Children inherit the parent's offset, so every process reads the same time.
  const inherited = Number(process.env.BUREAU_E2E_CLOCK_OFFSET);
  const offset = process.env.BUREAU_E2E_CLOCK_OFFSET && Number.isFinite(inherited) ? inherited : pin - RealDate.now();
  process.env.BUREAU_E2E_CLOCK_OFFSET = String(offset);
  const now = () => RealDate.now() + offset;
  class PinnedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(now());
      else super(...(args as [string | number | Date]));
    }
    static now() {
      return now();
    }
    // Dates made before the pin, or inside Node itself (fs.Stats), are still Dates.
    static [Symbol.hasInstance](x: unknown) {
      return x instanceof RealDate;
    }
  }
  // Date() called without `new` returns a string of "now".
  const DateFn = new Proxy(PinnedDate, {
    apply: () => new PinnedDate().toString(),
  });
  globalThis.Date = DateFn as unknown as DateConstructor;
  installed = true;
  return true;
}

installClock();
