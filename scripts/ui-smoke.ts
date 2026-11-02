/**
 * UI smoke tests: the real server (built web UI, sandboxed data, Claude replay)
 * driven by a real browser. A11 owns this wiring; A10 owns the steps.
 *
 * Steps live in scripts/ui-smoke/*.ts (run in name order), each exporting
 *   export default async function (t: UiSmoke) { ... }
 * where UiSmoke gives a page already on the app, the base URL, the fixture
 * server, a `step(name, fn)` reporter and a screenshot helper.
 *
 *   npm run build && npm run ui-smoke          all steps
 *   npm run ui-smoke -- onboarding --headful   steps whose file name contains "onboarding"
 *   npm run ui-smoke -- --strict               no steps / no build counts as failure
 *
 * Exit code 0 when every step passed (or, without --strict, when there is
 * nothing to run yet). `E2E-UI {json}` on the last line is read by `npm run e2e`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { startFixtureServer, type FixtureServer } from './fixture-server.ts';
import { ROOT } from './e2e/manifest.ts';
import { startServer } from './e2e/procs.ts';

export interface UiSmoke {
  page: Page;
  base: string;
  fx: FixtureServer;
  /** Folder for screenshots (design/shots/v2 when --shots is passed, else the sandbox). */
  shotsDir: string;
  step: (name: string, fn: () => Promise<unknown>) => Promise<void>;
  shot: (name: string, opts?: { width?: number; height?: number }) => Promise<string>;
}

const argv = process.argv.slice(2);
const strict = argv.includes('--strict') || process.env.BUREAU_STRICT === '1';
const headful = argv.includes('--headful');
const only = argv.filter((a) => !a.startsWith('--'));
const STEPS_DIR = path.join(ROOT, 'scripts', 'ui-smoke');
const summary = { passed: 0, failed: 0, pending: '' as string };

function finish(code: number): never {
  console.log(`E2E-UI ${JSON.stringify(summary)}`);
  process.exit(code);
}

const files = fs.existsSync(STEPS_DIR) ? fs.readdirSync(STEPS_DIR).filter((f) => f.endsWith('.ts') && (!only.length || only.some((o) => f.includes(o)))).sort() : [];
if (!files.length) {
  summary.pending = 'no UI smoke steps yet (A10 adds scripts/ui-smoke/*.ts)';
  console.log(summary.pending);
  finish(strict ? 1 : 0);
}
if (!fs.existsSync(path.join(ROOT, 'dist', 'web', 'index.html'))) {
  summary.pending = 'the web UI is not built (run npm run build first)';
  console.log(summary.pending);
  finish(strict ? 1 : 0);
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-ui-'));
const fx = await startFixtureServer({ quiet: true });
const env: Record<string, string> = {
  BUREAU_DATA_DIR: path.join(sandbox, 'data'),
  BUREAU_STARTUP_DIR: path.join(sandbox, 'startup'),
  BUREAU_REPLAY: '1',
  BUREAU_EMBED: 'hash',
  BUREAU_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  BUREAU_FIXTURE_ORIGINS: `${fx.originA},${fx.originB}`,
  BUREAU_LOG: 'error',
};
const { proc, base } = await startServer(env);
const { chromium } = await import('playwright-core');
let browser: Browser | null = null;
try {
  browser = process.env.BUREAU_CHROME_PATH
    ? await chromium.launch({ executablePath: process.env.BUREAU_CHROME_PATH, headless: !headful })
    : await chromium.launch({ channel: 'chrome', headless: !headful }).catch(() => chromium.launch({ channel: 'msedge', headless: !headful }));
  const shotsDir = argv.includes('--shots') ? path.join(ROOT, 'design', 'shots', 'v2') : path.join(sandbox, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  for (const f of files) {
    console.log(`\n${f}`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(base);
    const t: UiSmoke = {
      page,
      base,
      fx,
      shotsDir,
      step: async (name, fn) => {
        try {
          await fn();
          summary.passed++;
          console.log(`  ✓ ${name}`);
        } catch (err) {
          summary.failed++;
          console.log(`  ✗ ${name}\n    ${(err as Error).message.split('\n')[0]}`);
        }
      },
      shot: async (name, opts) => {
        if (opts?.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
        const file = path.join(shotsDir, `${name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        return file;
      },
    };
    try {
      const mod = (await import(pathToFileURL(path.join(STEPS_DIR, f)).href)) as { default?: (t: UiSmoke) => Promise<void> };
      if (typeof mod.default === 'function') await mod.default(t);
    } catch (err) {
      summary.failed++;
      console.log(`  ✗ ${f} crashed: ${(err as Error).message.split('\n')[0]}`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser?.close();
  proc.kill('SIGTERM');
  await Promise.race([proc.exited, new Promise((r) => setTimeout(r, 3000))]);
  proc.kill('SIGKILL');
  await fx.close();
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    /* harmless */
  }
}
console.log(`\n${summary.failed ? 'UI smoke FAILED' : 'UI smoke OK'}: ${summary.passed} passed, ${summary.failed} failed`);
finish(summary.failed ? 1 : 0);
