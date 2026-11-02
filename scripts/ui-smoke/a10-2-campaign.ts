import type { UiSmoke } from '../ui-smoke.ts';
import { apiGet, assert, waitFor } from '../a10/smoke-lib.ts';

interface Camp {
  id: string;
  name: string;
  status: string;
  config: { dailyCap: number; dryRunDays: number; stretchLevel: string };
  stats: { dryRun: { active: boolean } };
}

/** A campaign is created from the editor and started in dry run; the sash shows only while it is live. */
export default async function campaign(t: UiSmoke) {
  const { page } = t;
  const NAME = 'Smoke dry-run campaign';

  await t.step('the editor opens with defaults filled in', async () => {
    await page.goto(`${t.base}/#/campaigns?new=1`);
    await page.waitForSelector('[data-testid="campaign-name"]');
    const cap = await page.inputValue('[data-testid="campaign-cap"]');
    assert(Number(cap) > 0, 'no default daily cap');
  });

  await t.step('every field can be set, stretch level included', async () => {
    await page.fill('[data-testid="campaign-name"]', NAME);
    await page.fill('[data-testid="campaign-cap"]', '6');
    await page.fill('[data-testid="campaign-dryrun"]', '3');
    await page.click('button[role="radio"]:has-text("Aggressive")');
    assert((await page.getAttribute('button[role="radio"]:has-text("Aggressive")', 'aria-checked')) === 'true', 'stretch level not selected');
  });

  await t.step('save and start puts it live in dry run', async () => {
    await page.click('[data-testid="campaign-start"]');
    await page.waitForURL(/#\/campaigns\?id=/, { timeout: 15_000 });
    const ok = await waitFor(async () => {
      const l = await apiGet<{ campaigns: Camp[] }>(page, '/api/campaigns');
      const c = l.campaigns.find((x) => x.name === NAME);
      return !!c && c.status === 'active' && c.stats.dryRun.active && c.config.dailyCap === 6 && c.config.dryRunDays === 3 && c.config.stretchLevel === 'aggressive';
    });
    assert(ok, 'the campaign did not start in dry run with the chosen settings');
  });

  await t.step('the sash runs across the campaigns page while live', async () => {
    await page.goto(`${t.base}/#/campaigns`);
    await page.waitForSelector('[data-testid="campaign-band"].on', { timeout: 10_000 });
    const line = (await page.textContent('[data-testid="status-line"]')) ?? '';
    assert(/Rehearsing|Applying/.test(line), `unexpected status line: ${line}`);
  });

  await t.step('pause takes the sash down', async () => {
    await page.click('[data-testid="campaign-band"] button:has-text("Pause")');
    await page.waitForSelector('[data-testid="campaign-band"]:not(.on)', { timeout: 10_000 });
    await page.click('[data-testid="campaign-band"] button:has-text("Resume")');
    await page.waitForSelector('[data-testid="campaign-band"].on', { timeout: 10_000 });
  });
}
