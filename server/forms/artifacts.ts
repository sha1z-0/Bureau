import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import type { FieldLogEntry } from '../contracts/forms.ts';
import { DATA_DIR } from '../config.ts';

/**
 * Where every run leaves its evidence:
 *  - DATA_DIR/forms/runs/<runId>/step-<n>.jpg  one full-page screenshot per wizard step
 *  - DATA_DIR/forms/runs/<runId>/fieldlog.json the field log (intended vs read back, per field)
 *  - DATA_DIR/forms/runs/<runId>/run.json      the outcome and notes
 *  - DATA_DIR/shots/<applicationId>.png        the final / proof screenshot the UI shows
 */

export const SHOT_DIR = path.join(DATA_DIR, 'shots');
export const RUNS_DIR = path.join(DATA_DIR, 'forms', 'runs');
fs.mkdirSync(SHOT_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(RUNS_DIR, { recursive: true, mode: 0o700 });

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

export function runDir(runId: string): string {
  if (!SAFE_ID.test(runId)) throw new Error('bad run id');
  const d = path.join(RUNS_DIR, runId);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

/** Full-page JPEG for a step (small: quality 55). Returns the path relative to DATA_DIR, or null. */
export async function stepShot(page: Page, runId: string, name: string): Promise<string | null> {
  const file = path.join(runDir(runId), `${name.replace(/[^\w.-]/g, '_')}.jpg`);
  try {
    await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 55, timeout: 15_000 });
    return path.relative(DATA_DIR, file).split(path.sep).join('/');
  } catch {
    return null;
  }
}

/** The proof screenshot: `<applicationId>.png` in SHOT_DIR (the name the applications route serves). */
export async function proofShot(page: Page, name: string): Promise<string | null> {
  const safe = /^[0-9a-f-]{36}$/.test(name) ? name : name.replace(/[^\w-]/g, '_');
  const file = path.join(SHOT_DIR, `${safe}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true, timeout: 15_000 });
    return path.basename(file);
  } catch {
    return null;
  }
}

export function writeRunFiles(runId: string, fieldLog: FieldLogEntry[], meta: Record<string, unknown>) {
  const d = runDir(runId);
  fs.writeFileSync(path.join(d, 'fieldlog.json'), JSON.stringify(fieldLog, null, 1), { mode: 0o600 });
  fs.writeFileSync(path.join(d, 'run.json'), JSON.stringify(meta, null, 1), { mode: 0o600 });
}

/** Resolve a stored relative artifact path safely (no traversal). */
export function artifactPath(rel: string): string | null {
  const p = path.resolve(DATA_DIR, rel);
  if (!p.startsWith(RUNS_DIR + path.sep)) return null;
  return fs.existsSync(p) ? p : null;
}
