import dns from 'node:dns/promises';
import net from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { AppError } from '../errors.ts';
import { isBlockedIp } from '../security/ip.ts';

/**
 * A real browser for application forms, driven through the Chrome or Edge you
 * already have installed (no bundled download). Every request the page makes
 * passes the same private-network guard as server-side fetches, so a hostile
 * job URL can't use the browser to reach your router or this app.
 */

const CHANNELS = ['chrome', 'msedge'] as const;

export async function launchBrowser(headless = true): Promise<Browser> {
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

export async function guardedContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', acceptDownloads: false });
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !(await hostAllowed(url.hostname))) return route.abort('blockedbyclient');
    return route.continue();
  });
  return ctx;
}
