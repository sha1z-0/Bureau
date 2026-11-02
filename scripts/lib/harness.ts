import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Browser } from 'playwright-core';

/**
 * Shared plumbing for `npm run selfcheck`. Each area adds a file to
 * scripts/checks/ whose default export receives this harness, so agents never
 * edit the same test file. Files run in name order.
 */

export interface Harness {
  check: (name: string, fn: () => unknown) => Promise<void>;
  section: (title: string) => void;
  /** Throwaway folder; BUREAU_DATA_DIR already points inside it. */
  sandbox: string;
  /** One Chrome/Edge shared by every check module, or null when none is installed. */
  sharedBrowser: () => Promise<Browser | null>;
}

export const state = { failures: 0, skipped: 0, passed: 0 };

export async function check(name: string, fn: () => unknown) {
  try {
    const r = await fn();
    if (r === 'skip') {
      state.skipped++;
      console.log(`  – ${name} (skipped)`);
    } else {
      state.passed++;
      console.log(`  ✓ ${name}`);
    }
  } catch (err) {
    state.failures++;
    // SELFCHECK_VERBOSE=1 shows the whole assertion diff and where it failed.
    const detail = process.env.SELFCHECK_VERBOSE ? `${(err as Error).message}\n${(err as Error).stack?.split('\n').find((l) => l.includes('scripts')) ?? ''}` : (err as Error).message.split('\n')[0];
    console.log(`  ✗ ${name}\n    ${detail.split('\n').join('\n    ')}`);
  }
}

export function section(title: string) {
  console.log(`\n${title}`);
}

let browser: Promise<Browser | null> | null = null;

export function sharedBrowser(): Promise<Browser | null> {
  browser ??= (async () => {
    const { browserAvailable, launchBrowser } = await import('../../server/services/browser.ts');
    return (await browserAvailable()) ? launchBrowser(true) : null;
  })();
  return browser;
}

export async function closeSharedBrowser() {
  if (browser) await (await browser)?.close().catch(() => {});
}

const CHECKS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'checks');

/** Run every scripts/checks/*.ts whose file name contains one of `only` (all when empty). */
export async function runCheckModules(sandbox: string, only: string[]) {
  const files = fs
    .readdirSync(CHECKS_DIR)
    .filter((f) => f.endsWith('.ts') && (!only.length || only.some((o) => f.includes(o))))
    .sort();
  const h: Harness = { check, section, sandbox, sharedBrowser };
  for (const f of files) {
    try {
      const mod = (await import(pathToFileURL(path.join(CHECKS_DIR, f)).href)) as { default?: (h: Harness) => Promise<void> };
      if (typeof mod.default === 'function') await mod.default(h);
    } catch (err) {
      state.failures++;
      console.log(`  ✗ ${f} crashed\n    ${(err as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`);
    }
  }
}
