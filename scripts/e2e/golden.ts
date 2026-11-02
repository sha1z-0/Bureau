import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright-core';
import type { FixtureServer } from '../fixture-server.ts';
import { checkExpectations, type ExpectationResult, type Submission } from './expect.ts';
import { FIXTURES, ROOT, loadExpected } from './manifest.ts';
import type { GoldenCtx, GoldenFill } from './golden/types.ts';

const GOLDEN_DIR = path.join(ROOT, 'scripts', 'e2e', 'golden');

export function goldenCtx(fx: FixtureServer): GoldenCtx {
  const texts = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'profile', 'texts.json'), 'utf8')) as Record<string, string>;
  return {
    fx,
    data: loadExpected(),
    files: { cv: path.join(FIXTURES, 'profile', 'Rania-Haroon-CV.pdf'), letter: path.join(FIXTURES, 'profile', 'Rania-Haroon-Cover-Letter.pdf') },
    text: { coverLetter: texts.coverLetter, whyUs: texts.whyUs, project: texts.project },
  };
}

export function hasGolden(formId: string): boolean {
  return fs.existsSync(path.join(GOLDEN_DIR, `${formId}.ts`));
}

export interface GoldenRun {
  formId: string;
  submissions: Submission[];
  final: Submission | null;
  expectations: ExpectationResult[];
  confirmation: boolean;
  consoleErrors: string[];
  ms: number;
}

/** Run one form's golden fill in a fresh, unguarded context against the fixture server. */
export async function runGolden(browser: Browser, fx: FixtureServer, formId: string, opts: { timeoutMs?: number } = {}): Promise<GoldenRun> {
  const spec = fx.form(formId);
  const mod = (await import(pathToFileURL(path.join(GOLDEN_DIR, `${formId}.ts`)).href)) as { default: GoldenFill };
  const before = fx.submissions({ formId }).length;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  ctx.setDefaultTimeout(opts.timeoutMs ?? 15_000);
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) consoleErrors.push(m.text());
  });
  const t0 = Date.now();
  try {
    await mod.default(page, goldenCtx(fx));
    // Confirmations can render inside an (even cross-origin) iframe, as with Greenhouse embeds.
    const texts = await Promise.all(page.frames().map((f) => f.locator('body').innerText({ timeout: 5000 }).catch(() => '')));
    const body = texts.join('
');
    const all = fx.submissions({ formId }).slice(before);
    const final = all.filter((s) => s.final).at(-1) ?? null;
    return {
      formId,
      submissions: all,
      final,
      expectations: final ? checkExpectations(spec, final, loadExpected()) : [],
      confirmation: body.toLowerCase().includes(spec.confirmationText.toLowerCase()),
      consoleErrors,
      ms: Date.now() - t0,
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}
