/**
 * Screenshots every page at 1440 px and 390 px for design review.
 *   BUREAU_URL=http://127.0.0.1:<port> npx tsx scripts/a10/shots.ts [only…]
 * Point it at a server whose data dir was filled by scripts/a10/seed-demo.ts.
 * Writes design/shots/v2/<page>-<desktop|phone>.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../server/services/browser.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../design/shots/v2');
const BASE = process.env.BUREAU_URL ?? 'http://127.0.0.1:4317';

export const PAGES: { name: string; hash: string; wait?: string; maxHeight?: number }[] = [
  { name: 'overview', hash: '#/overview' },
  { name: 'campaigns', hash: '#/campaigns' },
  { name: 'campaign-detail', hash: '#/campaigns?id=__CAMPAIGN__' },
  { name: 'campaign-new', hash: '#/campaigns?new=1' },
  { name: 'pipeline', hash: '#/pipeline?view=board' },
  { name: 'pipeline-list', hash: '#/pipeline?view=list' },
  { name: 'timeline', hash: '#/pipeline?view=board&job=job-a04-daftar', wait: '[data-testid="timeline"]' },
  { name: 'questions', hash: '#/questions' },
  { name: 'inbox', hash: '#/inbox' },
  { name: 'digests', hash: '#/digests' },
  { name: 'jobs', hash: '#/jobs' },
  { name: 'studio', hash: '#/studio' },
  { name: 'studio-written', hash: '#/studio?tab=written&app=__APP__' },
  { name: 'studio-strategy', hash: '#/studio?tab=strategy' },
  { name: 'dispatch', hash: '#/dispatch' },
  { name: 'forms', hash: '#/forms' },
  { name: 'learning', hash: '#/learning' },
  { name: 'sources', hash: '#/sources' },
  { name: 'sources-health', hash: '#/sources?tab=health' },
  { name: 'sources-companies', hash: '#/sources?tab=companies' },
  { name: 'profile', hash: '#/profile' },
  { name: 'profile-voice', hash: '#/profile?tab=voice' },
  { name: 'profile-answers', hash: '#/profile?tab=answers' },
  { name: 'agents', hash: '#/agents' },
  { name: 'settings', hash: '#/settings' },
  { name: 'welcome', hash: '#/welcome' },
  { name: 'welcome-voice', hash: '#/welcome', wait: '[data-testid="step-cv"]' },
];

const SIZES = [
  { tag: 'desktop', width: 1440, height: 900, maxHeight: 2600 },
  { tag: 'phone', width: 390, height: 844, maxHeight: 3200 },
];

async function main() {
  const only = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  // Resolve ids the hashes need.
  const sess = await fetch(`${BASE}/api/session`);
  const cookie = (sess.headers.get('set-cookie') ?? '').split(';')[0];
  const get = async <T>(p: string) => (await (await fetch(`${BASE}${p}`, { headers: { cookie } })).json()) as T;
  const camps = await get<{ campaigns: { id: string; status: string }[] }>('/api/campaigns');
  const campaignId = camps.campaigns.find((c) => c.status === 'active')?.id ?? camps.campaigns[0]?.id ?? '';
  const runs = await get<{ runs: { applicationId: string; status: string }[] }>('/api/writer/applications?limit=5');
  const appId = runs.runs.find((r) => r.status === 'written')?.applicationId ?? '';

  const browser = await launchBrowser(true);
  try {
    for (const size of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.tag === 'phone', hasTouch: size.tag === 'phone', serviceWorkers: 'block' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/#/overview`, { waitUntil: 'networkidle' });
      for (const p of PAGES) {
        if (only.length && !only.some((o) => p.name.includes(o))) continue;
        const hash = p.hash.replace('__CAMPAIGN__', campaignId).replace('__APP__', appId);
        await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
        if (p.name === 'welcome-voice') {
          await page.click('.steps button:has-text("Voice bank")').catch(async () => {
            for (let i = 0; i < 3; i++) await page.click('[data-testid="wizard-skip"]');
          });
        }
        if (p.wait) await page.waitForSelector(p.wait, { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(900);
        const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
        const file = path.join(OUT, `${p.name}-${size.tag}.png`);
        if (p.name === 'timeline') await page.screenshot({ path: file });
        else await page.screenshot({ path: file, fullPage: true, clip: h > size.maxHeight ? { x: 0, y: 0, width: size.width, height: size.maxHeight } : undefined });
        console.log(`${p.name}-${size.tag}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
