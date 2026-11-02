import type { UiSmoke } from '../ui-smoke.ts';
import { apiGet, apiSend, assert, waitFor } from '../a10/smoke-lib.ts';

/** The kill switch is on every page while anything runs, stops everything, and can be cleared. */
export default async function kill(t: UiSmoke) {
  const { page } = t;

  // Make sure something is live (the campaign step leaves one running; start one if not).
  await page.goto(`${t.base}/#/overview`);
  const list = await apiGet<{ campaigns: { id: string; status: string }[] }>(page, '/api/campaigns');
  if (!list.campaigns.some((c) => c.status === 'active')) {
    const paused = list.campaigns.find((c) => c.status === 'paused');
    if (paused) await apiSend(page, 'POST', `/api/campaigns/${paused.id}/resume`);
    else {
      const d = await apiGet<{ config: unknown }>(page, '/api/campaigns/defaults');
      await apiSend(page, 'POST', '/api/campaigns', { name: 'Smoke kill campaign', config: d.config, start: true });
    }
  }

  await t.step('the kill switch shows on a page without the sash', async () => {
    await page.goto(`${t.base}/#/jobs`);
    await page.waitForSelector('.livebar [data-testid="kill-switch"]', { timeout: 15_000 });
  });

  await t.step('stopping asks once, then stops everything', async () => {
    await page.click('.livebar [data-testid="kill-switch"]');
    await page.fill('.modal input', 'Smoke test');
    await page.click('[data-testid="kill-confirm"]');
    const ok = await waitFor(async () => {
      const k = await apiGet<{ kill: { reason: string } | null }>(page, '/api/kill');
      const c = await apiGet<{ campaigns: { status: string }[] }>(page, '/api/campaigns');
      return !!k.kill && k.kill.reason.includes('Smoke test') && !c.campaigns.some((x) => x.status === 'active');
    });
    assert(ok, 'the kill switch did not trip or a campaign is still active');
  });

  await t.step('the live strip says everything is stopped and the switch is gone', async () => {
    await page.waitForSelector('.livebar.killed', { timeout: 10_000 });
    assert((await page.locator('[data-testid="kill-switch"]').count()) === 0, 'the kill switch is still offered after stopping');
  });

  await t.step('clearing it leaves campaigns paused until resumed', async () => {
    await page.goto(`${t.base}/#/campaigns`);
    await page.click('button:has-text("Clear the kill switch")');
    const ok = await waitFor(async () => (await apiGet<{ kill: unknown }>(page, '/api/kill')).kill === null);
    assert(ok, 'the kill flag was not cleared');
    const c = await apiGet<{ campaigns: { status: string }[] }>(page, '/api/campaigns');
    assert(!c.campaigns.some((x) => x.status === 'active'), 'a campaign resumed on its own');
  });
}
