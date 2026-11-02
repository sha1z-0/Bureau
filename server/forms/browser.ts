import dns from 'node:dns/promises';
import net from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { AppError } from '../errors.ts';
import { isBlockedIp } from '../security/ip.ts';

/**
 * A real browser for application forms, driven through the Chrome or Edge
 * already installed (no bundled download). Every request the page makes passes
 * the same private-network guard as server-side fetches, so a hostile job URL
 * can't use the browser to reach the router or this app.
 *
 * Human-like, not deceptive: a realistic viewport, the owner's time zone and
 * locale, ordinary typing cadence. No fingerprint spoofing, no stealth plugins,
 * no proxy or IP rotation.
 */

const CHANNELS = ['chrome', 'msedge'] as const;

export async function launchBrowser(headless = true): Promise<Browser> {
  // An explicit Chromium (the Docker image sets /usr/bin/chromium) wins over the installed channels.
  const exe = process.env.BUREAU_CHROME_PATH;
  if (exe) {
    try {
      return await chromium.launch({ executablePath: exe, headless });
    } catch {
      /* fall back to the channels */
    }
  }
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel, headless });
    } catch {
      /* try the next browser */
    }
  }
  throw new AppError(503, 'NO_BROWSER', 'Auto-applying to forms needs Google Chrome or Microsoft Edge installed.');
}

let available: boolean | null = null;
export async function browserAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try {
    const b = await launchBrowser(true);
    await b.close();
    available = true;
  } catch {
    available = false;
  }
  return available;
}

// ── Local fixture origins (tests only) ─────────────────────────────────────────

/**
 * Exact origins (scheme://host:port) the guard lets through even though they are
 * on this machine: the local fixture servers that tests and the e2e serve the ATS
 * replicas from. Only ever honoured in replay mode (`BUREAU_REPLAY=1`), so a
 * production run can never be pointed at loopback. Sources:
 *  - `BUREAU_FIXTURE_ORIGINS` (comma separated), read on every request;
 *  - `allowFixtureOrigins()` for in-process tests.
 * In strict mode nothing else is reachable at all, so a fixture that links a real
 * site by accident can never load it.
 */
const testOrigins = new Set<string>();
let strictFixtures = false;

function originOf(raw: string): string | null {
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

function replayMode(): boolean {
  return process.env.BUREAU_REPLAY === '1';
}

function fixtureOrigins(): Set<string> {
  if (!replayMode()) return new Set();
  const env = (process.env.BUREAU_FIXTURE_ORIGINS ?? '')
    .split(',')
    .map((s) => originOf(s.trim()))
    .filter((s): s is string => !!s);
  return new Set([...env, ...testOrigins]);
}

/** Allow these exact local origins (tests, replay mode only). `strict` blocks every other origin. Returns an undo function. */
export function allowFixtureOrigins(origins: string[], opts: { strict?: boolean } = {}): () => void {
  const added = origins.map(originOf).filter((o): o is string => !!o && !testOrigins.has(o));
  for (const o of added) testOrigins.add(o);
  const prevStrict = strictFixtures;
  if (opts.strict !== undefined) strictFixtures = opts.strict;
  return () => {
    for (const o of added) testOrigins.delete(o);
    strictFixtures = prevStrict;
  };
}

export function isFixtureOrigin(url: string): boolean {
  const o = originOf(url);
  return !!o && fixtureOrigins().has(o);
}

const hostVerdicts = new Map<string, { ok: boolean; at: number }>();

async function hostAllowed(host: string): Promise<boolean> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.(localhost|local|internal|lan|home\.arpa))$/i.test(bare)) return false;
  if (net.isIP(bare)) return !isBlockedIp(bare);
  const cached = hostVerdicts.get(bare);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.ok;
  let ok = false;
  try {
    const addrs = await dns.lookup(bare, { all: true });
    ok = addrs.length > 0 && addrs.every((a) => !isBlockedIp(a.address));
  } catch {
    ok = false;
  }
  hostVerdicts.set(bare, { ok, at: Date.now() });
  return ok;
}

/** May the browser load this URL? Exported for the agent (A06) and tests. */
export async function urlAllowed(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:' || raw === 'about:blank' || raw === 'about:srcdoc') return true;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const fx = fixtureOrigins();
  if (fx.has(url.origin)) return true;
  // Replay runs that serve fixtures never reach anything else.
  if (replayMode() && (strictFixtures || !!process.env.BUREAU_FIXTURE_ORIGINS)) return false;
  return hostAllowed(url.hostname);
}

export interface ContextOptions {
  /** IANA zone for the page clock (the owner's), e.g. "Asia/Karachi". */
  timezoneId?: string;
  locale?: string;
}

function validZone(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

export async function guardedContext(browser: Browser, opts: ContextOptions = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: opts.locale ?? 'en-US',
    timezoneId: validZone(opts.timezoneId),
    acceptDownloads: false,
  });
  await ctx.route('**/*', async (route) => {
    const raw = route.request().url();
    if (!(await urlAllowed(raw))) return route.abort('blockedbyclient');
    return route.continue();
  });
  return ctx;
}

// ── A shared long-lived browser for the autopilot ─────────────────────────────

let shared: { browser: Promise<Browser>; headless: boolean } | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let leases = 0;
let killHookRegistered = false;
const IDLE_MS = 3 * 60_000;

async function registerKillHook() {
  if (killHookRegistered) return;
  killHookRegistered = true;
  try {
    const { onKill } = await import('../campaign/kill.ts');
    onKill(() => closeSharedBrowser());
  } catch {
    /* campaign module unavailable (tests): nothing to register */
  }
}

/** Borrow the shared headless browser. Call the returned release() when the run ends. */
export async function leaseBrowser(): Promise<{ browser: Browser; release: () => void }> {
  await registerKillHook();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (shared) {
    const b = await shared.browser.catch(() => null);
    if (!b || !b.isConnected()) shared = null;
  }
  shared ??= { browser: launchBrowser(true), headless: true };
  const browser = await shared.browser;
  leases++;
  let released = false;
  return {
    browser,
    release: () => {
      if (released) return;
      released = true;
      leases = Math.max(0, leases - 1);
      if (leases === 0) {
        idleTimer = setTimeout(() => void closeSharedBrowser(), IDLE_MS);
        idleTimer.unref?.();
      }
    },
  };
}

export async function closeSharedBrowser(): Promise<void> {
  const s = shared;
  shared = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!s) return;
  const b = await s.browser.catch(() => null);
  await b?.close().catch(() => {});
}
