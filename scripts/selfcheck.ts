/**
 * Offline self-check: no API key, no spend, no real job sites.
 * Every area keeps its checks in scripts/checks/<area>.ts (run in name order).
 *   npm run selfcheck                 everything
 *   npm run selfcheck -- a05 forms    only files whose name contains a05 or forms
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point everything at a throwaway folder before any app module loads.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-selfcheck-'));
process.env.BUREAU_DATA_DIR = path.join(sandbox, 'data');
process.env.BUREAU_STARTUP_DIR = path.join(sandbox, 'startup');
process.env.BUREAU_REPLAY = '1';
process.env.BUREAU_EMBED ??= 'hash';

const { closeSharedBrowser, runCheckModules, state } = await import('./lib/harness.ts');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
try {
  await runCheckModules(sandbox, only);
} finally {
  await closeSharedBrowser();
}

// Release the sandbox database before deleting it (Windows locks open files).
const { db } = await import('../server/db.ts');
db.close();
try {
  fs.rmSync(sandbox, { recursive: true, force: true });
} catch {
  /* a leftover temp folder is harmless */
}
const { failures, skipped, passed } = state;
console.log(failures ? `\n${failures} check(s) failed, ${passed} passed\n` : `\nAll ${passed} checks passed${skipped ? ` (${skipped} skipped)` : ''}\n`);
process.exit(failures ? 1 : 0);
