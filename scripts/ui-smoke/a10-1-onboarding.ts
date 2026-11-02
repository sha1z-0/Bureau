import type { UiSmoke } from '../ui-smoke.ts';
import { apiGet, assert, waitFor } from '../a10/smoke-lib.ts';

/**
 * A fresh install opens the setup wizard by itself; the owner walks all ten
 * steps (skipping the ones that would need the network or real accounts) and
 * finishes by starting a first campaign in rehearsal.
 */
export default async function onboarding(t: UiSmoke) {
  const { page } = t;
  const next = () => page.click('[data-testid="wizard-next"]');
  const skip = () => page.click('[data-testid="wizard-skip"]');
  const at = (step: string) => page.waitForSelector(`[data-testid="step-${step}"]`, { timeout: 10_000 });

  await t.step('a fresh install opens the setup wizard', async () => {
    await page.waitForURL(/#\/welcome/, { timeout: 15_000 });
    await at('cv');
  });

  await t.step('the CV step can be skipped for now', async () => {
    await skip();
    await at('links');
  });

  await t.step('links are saved', async () => {
    await page.fill('input[placeholder="https://github.com/you"]', 'https://github.com/smoke-candidate');
    await page.click('[data-testid="links-save"]');
    const ok = await waitFor(async () => {
      const l = await apiGet<{ stored: { github?: string } }>(page, '/api/master/links');
      return !!l.stored.github?.includes('smoke-candidate');
    });
    assert(ok, 'the GitHub link was not stored');
    await next();
    await at('github');
  });

  await t.step('the GitHub preview shows and can be skipped (no network in tests)', async () => {
    await page.waitForSelector('text=Read my GitHub');
    await skip();
    await at('voice');
  });

  await t.step('a voice-bank passage saves itself with a word count', async () => {
    const text =
      'I build things because I like the moment a messy process turns into something people trust. At my last job I rewrote the nightly reconciliation so the finance team stopped checking it by hand, and I still remember how quiet the Monday standup was after that. That is the feeling I chase: fewer surprises for the people downstream, and code I can explain to them in plain words.';
    await page.fill('[data-testid="voice-0"]', text);
    await page.locator('[data-testid="voice-0"]').blur();
    await page.waitForSelector('text=/\\d+ words/');
    const ok = await waitFor(async () => (await apiGet<{ passages: unknown[] }>(page, '/api/master/voice')).passages.length === 1);
    assert(ok, 'the passage was not saved on blur');
    await next();
    await at('answers');
  });

  await t.step('the answer bank is shown in groups', async () => {
    await page.waitForSelector('[role="tablist"][aria-label="Question groups"]');
    await next();
    await at('learning');
  });

  await t.step('a skill goes on the learning list', async () => {
    await page.fill('[data-testid="learning-skill"]', 'Kubernetes');
    await page.keyboard.press('Enter');
    const ok = await waitFor(async () => (await apiGet<{ items: { skill: string }[] }>(page, '/api/master/learning')).items.some((i) => i.skill === 'Kubernetes'));
    assert(ok, 'the learning item was not added');
    await next();
    await at('apikey');
  });

  await t.step('API key, mailbox and Telegram can each be skipped', async () => {
    await skip();
    await at('mailbox');
    await skip();
    await at('telegram');
    await skip();
    await at('campaign');
  });

  await t.step('the first campaign starts in rehearsal and setup is done', async () => {
    await page.waitForSelector('[data-testid="campaign-name"]');
    await page.fill('[data-testid="campaign-name"]', 'Smoke onboarding campaign');
    await page.fill('[data-testid="campaign-dryrun"]', '2');
    await page.click('[data-testid="campaign-start"]');
    await page.waitForURL(/#\/campaigns\?id=/, { timeout: 15_000 });
    const ob = await apiGet<{ done: boolean; completed: string[] }>(page, '/api/onboarding');
    assert(ob.done, 'onboarding is not marked done');
    for (const s of ['links', 'voice', 'learning', 'campaign']) assert(ob.completed.includes(s), `step ${s} not recorded as complete`);
    const list = await apiGet<{ campaigns: { name: string; status: string; stats: { dryRun: { active: boolean } } }[] }>(page, '/api/campaigns');
    const c = list.campaigns.find((x) => x.name === 'Smoke onboarding campaign');
    assert(c && c.status === 'active' && c.stats.dryRun.active, 'the campaign is not active in rehearsal');
  });

  await t.step('progress survives a reload', async () => {
    await page.goto(`${t.base}/#/overview`);
    await page.waitForSelector('[data-testid="campaign-band"]');
    assert(!/#\/welcome/.test(page.url()), 'the wizard opened again after setup was done');
  });

  // Pause it so the next steps start from a known state.
  const list = await apiGet<{ campaigns: { id: string; status: string }[] }>(page, '/api/campaigns');
  for (const c of list.campaigns.filter((x) => x.status === 'active')) {
    await page.evaluate(async (id) => {
      const s = (await (await fetch('/api/session')).json()) as { csrf: string };
      await fetch(`/api/campaigns/${id}/pause`, { method: 'POST', headers: { 'x-bureau-csrf': s.csrf } });
    }, c.id);
  }
}
