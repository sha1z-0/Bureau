import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './manifest.ts';

/** Child processes for the e2e: the real Bureau server and the autopilot worker. */

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export interface Proc {
  child: ChildProcess;
  output: string[];
  /** Resolves with the exit code. */
  exited: Promise<number | null>;
  kill: (signal?: NodeJS.Signals) => void;
  waitFor: (re: RegExp, timeoutMs: number) => Promise<string | null>;
}

/** Run a TypeScript entry point under the same Node with tsx, capturing output. */
export function spawnTs(entry: string, args: string[], env: Record<string, string>, opts: { echo?: boolean; label?: string } = {}): Proc {
  const merged = { ...process.env, ...env };
  // The e2e's pinned clock (scripts/e2e/clock.ts) goes to every child, so prompts carry the same dates.
  const clock = merged.BUREAU_E2E_NOW ? ['--import', pathToFileURL(path.join(ROOT, 'scripts/e2e/clock.ts')).href] : [];
  const child = spawn(process.execPath, ['--import', 'tsx', ...clock, path.join(ROOT, entry), ...args], {
    cwd: ROOT,
    env: merged,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output: string[] = [];
  const waiters: { re: RegExp; resolve: (s: string | null) => void }[] = [];
  const onData = (buf: Buffer) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      output.push(line);
      if (opts.echo) console.log(`    [${opts.label ?? path.basename(entry)}] ${line}`);
      for (const w of [...waiters]) {
        if (w.re.test(line)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(line);
        }
      }
    }
  };
  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return {
    child,
    output,
    exited,
    kill: (signal = 'SIGKILL') => {
      if (child.exitCode === null) child.kill(signal);
    },
    waitFor: (re, timeoutMs) => {
      const hit = output.find((l) => re.test(l));
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve) => {
        const w = { re, resolve };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            resolve(null);
          }
        }, timeoutMs);
        void exited.then(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            resolve(null);
          }
        });
      });
    },
  };
}

export async function waitUntil(fn: () => boolean | Promise<boolean>, timeoutMs: number, everyMs = 200): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return fn();
}

/** Start the real Bureau server (server/index.ts) on a free port and wait until it answers. */
export async function startServer(env: Record<string, string>): Promise<{ proc: Proc; base: string; port: number }> {
  const port = await freePort();
  const proc = spawnTs('server/index.ts', [], { ...env, BUREAU_PORT: String(port), BUREAU_HOST: '127.0.0.1', BUREAU_OPEN: '0' }, { label: 'server' });
  const base = `http://127.0.0.1:${port}`;
  const up = await waitUntil(async () => {
    try {
      const r = await fetch(`${base}/api/health`);
      return r.status < 500;
    } catch {
      return false;
    }
  }, 60_000, 300);
  if (!up) {
    proc.kill();
    throw new Error(`Bureau server did not start on ${base}: ${proc.output.slice(-5).join(' | ')}`);
  }
  return { proc, base, port };
}
