import type { Locator, Page } from 'playwright-core';

/**
 * Human-like pacing without deception: ordinary typing cadence and short pauses
 * between fields. No fingerprint tricks. `BUREAU_FORMS_FAST=1` (tests) or a
 * replay run turns the delays down so the suite stays quick.
 */

export function fastMode(): boolean {
  return process.env.BUREAU_FORMS_FAST === '1' || process.env.BUREAU_REPLAY === '1';
}

export function jitter(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

export async function pause(page: Page, min = 80, max = 260) {
  if (fastMode()) return;
  await page.waitForTimeout(jitter(min, max));
}

/** Type a value the way a person does: short values key by key, long text pasted. */
export async function typeInto(loc: Locator, value: string, opts: { clear?: boolean } = {}) {
  if (opts.clear !== false) await loc.fill('');
  if (value.length <= 60 && !fastMode()) {
    await loc.pressSequentially(value, { delay: jitter(25, 70) });
  } else if (value.length <= 60) {
    await loc.pressSequentially(value, { delay: 0 });
  } else {
    await loc.fill(value);
  }
}
