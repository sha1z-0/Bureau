import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Browser } from 'playwright-core';

/**
 * Shared plumbing for `npm run selfcheck`. Each area adds a file to
 * scripts/checks/ whose default export receives this harness, so agents never
 * edit the same test file. Files run in name order.
 *
 * A check passes, fails, is skipped (return 'skip'), or is *pending*: it
 * depends on a module that still throws NotImplemented, or it called
 * `pending(reason)`. Pending checks don't fail the run unless `--strict`
 * (or BUREAU_STRICT=1) is set; the lead switches to strict at integration.
 */

export interface Harness {
  check: (name: string, fn: () => unknown) => Promise<void>;
  section: (title: string) => void;
  /** Mark the current check pending with a reason (throws; use inside a check). */
  pending: (reason: string) => never;
  /** Throwaway folder; BUREAU_DATA_DIR already points inside it. */
  sandbox: string;
  /** One Chrome/Edge shared by every check module, or null when none is installed. */
  sharedBrowser: () => Promise<Browser | null>;
}

export const state = { failures: 0, skipped: 0, passed: 0, pending: 0, strict: process.env.BUREAU_STRICT === '1' };
export const pendingList: { name: string; reason: string }[] = [];

export class PendingError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PendingError';
  }
}

export function pending(reason: string): never {
  throw new PendingError(reason);
}

/** NotImplemented (a Phase 0 stub) or an explicit pending(). */
export function isPending(err: unknown): err is Error {
  const name = (err as Error | null)?.name;
  return name === 'NotImplemented' || name === 'PendingError';
}

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
    if (isPending(err)) {
      pendingList.push({ name, reason: err.message });
      if (state.strict) {
        state.failures++;
        console.log(`  ✗ ${name}\n    pending (strict): ${err.message.split('\n')[0]}`);
      } else {
        state.pending++;
        console.log(`  … ${name} (pending: ${err.message.split('\n')[0]})`);
      }
      return;
    }
    state.failures++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message.split('\n')[0]}`);
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
  const h: Harness = { check, section, pending, sandbox, sharedBrowser };
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
