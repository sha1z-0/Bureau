import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, ROOT } from '../config.ts';
import { AppError } from '../errors.ts';

/**
 * Start with Windows: a small script in your Startup folder that launches
 * Bureau silently at sign-in, so the hunt keeps working without a window open.
 * Output goes to data/bureau.log. Nothing is written outside your user profile.
 */

// BUREAU_STARTUP_DIR exists so tests never touch your real Startup folder.
const STARTUP = process.env.BUREAU_STARTUP_DIR ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const LAUNCHER = path.join(STARTUP, 'Bureau (job hunt).vbs');

export function autostartSupported() {
  return process.platform === 'win32' || !!process.env.BUREAU_STARTUP_DIR;
}

export function autostartEnabled(): boolean {
  return autostartSupported() && fs.existsSync(LAUNCHER);
}

const vbsString = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function setAutostart(enabled: boolean) {
  if (!autostartSupported()) throw new AppError(400, 'UNSUPPORTED', 'Start-with-Windows is only available on Windows.');
  if (!enabled) {
    fs.rmSync(LAUNCHER, { force: true });
    return;
  }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'web', 'index.html'))) {
    throw new AppError(409, 'NOT_BUILT', 'Build the interface first (run Bureau.cmd once), then switch this on.');
  }
  const log = path.join(DATA_DIR, 'bureau.log');
  const tsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const server = path.join(ROOT, 'server', 'index.ts');
  // Hidden window (0), don't wait (False). Paths are quoted for VBScript and for cmd.
  const command = `cmd /c node "${tsx}" "${server}" >> "${log}" 2>&1`;
  const script = [
    "' Starts Bureau in the background when you sign in to Windows.",
    "' Remove it from Bureau's Settings, or delete this file.",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = ${vbsString(ROOT)}`,
    `shell.Run ${vbsString(command)}, 0, False`,
    '',
  ].join('\r\n');
  fs.mkdirSync(STARTUP, { recursive: true });
  fs.writeFileSync(LAUNCHER, script, 'utf8');
}
