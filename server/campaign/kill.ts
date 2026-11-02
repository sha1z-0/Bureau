import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.ts';
import { getSetting, setSetting } from '../db.ts';

/**
 * Kill-switch state. Once tripped (UI, Telegram /stop, the data/STOP file or
 * an exhausted budget) nothing runs until the owner resumes a campaign. The
 * flag is persisted, so a restart does not quietly undo it.
 */

export type KillSource = 'ui' | 'telegram' | 'file' | 'budget' | 'api' | 'system';

export interface KillState {
  at: string;
  reason: string;
  source: KillSource;
}

export const STOP_FILE = () => path.join(DATA_DIR, 'STOP');

export function stopFilePresent(): boolean {
  try {
    return fs.existsSync(STOP_FILE());
  } catch {
    return false;
  }
}

export function killState(): KillState | null {
  return getSetting<KillState | null>('autopilot.kill', null);
}

export function setKillState(state: KillState | null) {
  setSetting('autopilot.kill', state);
}

/**
 * Things to close when the switch trips (browsers, sidecars). Modules that
 * hold such resources register here; each gets a short deadline.
 */
const hooks = new Set<(reason: string) => unknown>();

export function onKill(fn: (reason: string) => unknown): () => void {
  hooks.add(fn);
  return () => hooks.delete(fn);
}

export async function runKillHooks(reason: string, deadlineMs: number): Promise<void> {
  const list = [...hooks].map(async (fn) => {
    try {
      await fn(reason);
    } catch {
      /* a failing hook must not stop the others */
    }
  });
  await Promise.race([Promise.all(list), new Promise((r) => setTimeout(r, deadlineMs).unref?.())]);
}
