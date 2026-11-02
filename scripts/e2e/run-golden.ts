/**
 * Developer tool: run golden fills against the fixture server and print what
 * was recorded.
 *   npx tsx scripts/e2e/run-golden.ts                 every form that has a golden
 *   npx tsx scripts/e2e/run-golden.ts lever ashby     forms whose id contains a term
 *   npx tsx scripts/e2e/run-golden.ts --headful lever watch it
 */
import { chromium, type Browser } from 'playwright-core';
import { startFixtureServer } from '../fixture-server.ts';
import { hasGolden, runGolden } from './golden.ts';

const args = process.argv.slice(2);
const headful = args.includes('--headful');
const verbose = args.includes('--verbose');
const terms = args.filter((a) => !a.startsWith('--'));

async function launch(): Promise<Browser> {
  const executablePath = process.env.BUREAU_CHROME_PATH;
  if (executablePath) return chromium.launch({ executablePath, headless: !headful });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: !headful });
    } catch {
      /* next */
    }
  }
  throw new Error('No Chrome/Edge found (set BUREAU_CHROME_PATH).');
}

const fx = await startFixtureServer({ quiet: !verbose });
const browser = await launch();
let failed = 0;
try {
  const forms = fx.manifest.forms.filter((f) => hasGolden(f.id) && (!terms.length || terms.some((t) => f.id.includes(t))));
  for (const f of forms) {
    try {
      const r = await runGolden(browser, fx, f.id, { timeoutMs: headful ? 60_000 : 15_000 });
      const bad = r.expectations.filter((e) => !e.ok);
      const ok =
        f.expectedOutcome === 'submitted'
          ? !!r.final?.valid && r.confirmation && bad.length === 0
          : !r.submissions.some((s) => s.final && s.valid);
      if (!ok) failed++;
      console.log(`${ok ? '✓' : '✗'} ${f.id} (${r.ms} ms) final=${r.final ? (r.final.valid ? 'valid' : `invalid: ${r.final.errors.join('; ')}`) : 'none'} confirmation=${r.confirmation}`);
      for (const e of bad) console.log(`    expect ${e.key} ${e.rule} — got "${e.got}"`);
      if (r.final?.flags.length) console.log(`    flags: ${r.final.flags.join(', ')}`);
      if (r.consoleErrors.length) console.log(`    page errors: ${r.consoleErrors.slice(0, 3).join(' | ')}`);
      if (verbose && r.final) console.log(JSON.stringify({ fields: r.final.fields, files: r.final.files }, null, 2));
    } catch (err) {
      failed++;
      console.log(`✗ ${f.id}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
  await fx.close();
}
process.exit(failed ? 1 : 0);
