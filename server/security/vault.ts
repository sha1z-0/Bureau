import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DATA_DIR } from '../config.ts';
import { get, run, now } from '../db.ts';

/**
 * Secrets (Anthropic key, SMTP password) are encrypted at rest with AES-256-GCM.
 *
 * The 32-byte master key comes from BUREAU_MASTER_KEY when set (deployments),
 * otherwise from data/.master.key. On Windows that file is additionally sealed
 * with DPAPI (CurrentUser scope), so a copied data folder is useless on another
 * account or machine. Secrets are never sent back to the browser — only a hint.
 */

const KEY_FILE = path.join(DATA_DIR, '.master.key');
let masterKey: Buffer | null = null;

function dpapi(mode: 'Protect' | 'Unprotect', input: Buffer): Buffer | null {
  if (process.platform !== 'win32') return null;
  const script =
    'Add-Type -AssemblyName System.Security;' +
    '$in=[Convert]::FromBase64String([Console]::In.ReadToEnd());' +
    `$out=[System.Security.Cryptography.ProtectedData]::${mode}($in,$null,'CurrentUser');` +
    '[Console]::Out.Write([Convert]::ToBase64String($out))';
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: input.toString('base64'),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
  });
  if (res.status !== 0 || !res.stdout) return null;
  return Buffer.from(res.stdout.trim(), 'base64');
}

function loadMasterKey(): Buffer {
  if (masterKey) return masterKey;
  const fromEnv = process.env.BUREAU_MASTER_KEY;
  if (fromEnv) {
    const buf = Buffer.from(fromEnv, 'base64');
    if (buf.length !== 32) throw new Error('BUREAU_MASTER_KEY must be 32 bytes, base64 encoded');
    return (masterKey = buf);
  }
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (raw.startsWith('dpapi:')) {
      const opened = dpapi('Unprotect', Buffer.from(raw.slice(6), 'base64'));
      if (!opened) throw new Error('Could not unseal the master key with Windows DPAPI (different user or machine?)');
      return (masterKey = opened);
    }
    return (masterKey = Buffer.from(raw.replace(/^raw:/, ''), 'base64'));
  }
  const fresh = crypto.randomBytes(32);
  const sealed = dpapi('Protect', fresh);
  if (!sealed && process.platform === 'win32') console.warn('  ! Windows DPAPI unavailable; the master key is stored unsealed in data/.master.key');
  if (process.platform !== 'win32') console.warn('  ! No DPAPI on this OS. Prefer BUREAU_MASTER_KEY from a secret manager.');
  const contents = sealed ? `dpapi:${sealed.toString('base64')}` : `raw:${fresh.toString('base64')}`;
  fs.writeFileSync(KEY_FILE, contents, { mode: 0o600 });
  return (masterKey = fresh);
}

export function setSecret(name: string, value: string, opts: { hint?: boolean } = {}) {
  const key = loadMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(name));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Long API keys can safely show their last 4 characters; short passwords show nothing.
  const hint = opts.hint !== false && value.length > 24 ? `…${value.slice(-4)}` : null;
  run(
    `INSERT INTO secrets (name, iv, tag, data, hint, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET iv = excluded.iv, tag = excluded.tag, data = excluded.data,
       hint = excluded.hint, updated_at = excluded.updated_at`,
    name,
    iv.toString('base64'),
    tag.toString('base64'),
    data.toString('base64'),
    hint,
    now(),
  );
}

export function getSecret(name: string): string | null {
  const row = get<{ iv: string; tag: string; data: string }>('SELECT iv, tag, data FROM secrets WHERE name = ?', name);
  if (!row) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadMasterKey(), Buffer.from(row.iv, 'base64'));
  decipher.setAAD(Buffer.from(name));
  decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.data, 'base64')), decipher.final()]).toString('utf8');
}

export function secretHint(name: string): { set: boolean; hint: string | null; updatedAt: string | null } {
  const row = get<{ hint: string | null; updated_at: string }>('SELECT hint, updated_at FROM secrets WHERE name = ?', name);
  return { set: !!row, hint: row?.hint ?? null, updatedAt: row?.updated_at ?? null };
}

export function deleteSecret(name: string) {
  run('DELETE FROM secrets WHERE name = ?', name);
}

/** Warm the key at boot so a DPAPI failure surfaces immediately, not mid-request. */
export function initVault() {
  loadMasterKey();
}
