import type { Page } from 'playwright-core';
import type { UiSmoke } from '../ui-smoke.ts';
import { apiGet, apiSend, assert, findDataDir, waitFor } from '../a10/smoke-lib.ts';
import { plantFormsInbox, type PlantedFormsInbox } from '../a10/forms-inbox-seed.ts';

/**
 * Forms (A05), Inbox and Learning (A09) read their real routes: planted
 * fictional rows show up, nothing says "isn't in this build yet", and the
 * owner's actions (promote a recipe, the account email, marking a reply done)
 * reach the server.
 */

const NOT_IN_BUILD = /isn.t in this build yet|isn.t part of this build|Not in this build/i;

async function noFallback(page: Page, where: string) {
  const text = await page.locator('main, #root').first().innerText();
  assert(!NOT_IN_BUILD.test(text), `${where} still shows the "not in this build" state`);
}

export default async function formsInbox(t: UiSmoke) {
  const { page } = t;
  // Design shots (only with --shots): no leftover toasts, drawers finished sliding in.
  const shot = async (name: string, size?: { width: number; height: number }) => {
    if (!t.shotsDir.includes('design')) return;
    await page.waitForSelector('.toast', { state: 'detached', timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(400);
    await t.shot(name, size);
  };
  const dir = findDataDir(t.dataDir);
  let p: PlantedFormsInbox | null = null;
  const phone = { width: 390, height: 844 };
  const desk = { width: 1440, height: 900 };

  await t.step('fictional form runs, recipes, replies and a crash plan are planted', async () => {
    assert(dir, 'could not find the smoke server data dir');
    // A real JPEG for the step screenshot: the app's own page, captured by the browser.
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 40 });
    p = await plantFormsInbox(dir!, { shot: jpeg });
  });

  // ── Forms ─────────────────────────────────────────────────────────────
  await t.step('Forms lists the recipes with their real status', async () => {
    await page.goto(`${t.base}/#/forms`);
    await page.waitForSelector(`[data-testid="recipes"] >> text=${p!.company.toLowerCase().replace(/[^a-z]+/g, '')}`, { timeout: 10_000 });
    await noFallback(page, 'Forms');
    const rows = await page.locator('[data-testid="recipes"] tbody tr').count();
    assert(rows >= 3, `expected at least 3 recipe rows, saw ${rows}`);
    await shot('forms-desktop');
    await shot('forms-phone', phone);
    await page.setViewportSize(desk);
  });

  await t.step('the recipe drawer shows steps and history, and Promote reaches PUT /status', async () => {
    await page.goto(`${t.base}/#/forms?recipe=${p!.recipeIds.companyOld}`);
    await page.waitForSelector('text=Version history', { timeout: 10_000 });
    await page.waitForSelector('text=Last runs');
    await page.getByRole('button', { name: 'Promote' }).click();
    const ok = await waitFor(async () => {
      const r = await apiGet<{ recipe: { status: string } }>(page, `/api/forms/recipes/${p!.recipeIds.companyOld}`);
      const other = await apiGet<{ recipe: { status: string } }>(page, `/api/forms/recipes/${p!.recipeIds.companyNew}`);
      return r.recipe.status === 'active' && other.recipe.status === 'demoted';
    });
    assert(ok, 'promoting v1 did not make it active (and demote v2)');
    // Put it back the way the module left it.
    await apiSend(page, 'PUT', `/api/forms/recipes/${p!.recipeIds.companyNew}/status`, { status: 'active' });
  });

  await t.step('Coverage by ATS reads /api/forms/summary', async () => {
    await page.goto(`${t.base}/#/forms?tab=coverage`);
    await page.waitForSelector('text=Label variants known', { timeout: 10_000 });
    await shot('forms-coverage-desktop');
    await noFallback(page, 'Coverage');
    const row = page.locator('tr', { hasText: 'Greenhouse' }).first();
    await row.waitFor();
    const cells = await row.locator('td').allInnerTexts();
    assert(cells[1]?.includes('Yes'), `Greenhouse should show its adapter (${cells.join(' | ')})`);
    assert(Number(cells[4]) >= 1, `Greenhouse should count the planted run (${cells.join(' | ')})`);
  });

  await t.step('a form run opens with its field log and a step screenshot served by URL', async () => {
    await page.goto(`${t.base}/#/forms?tab=fills`);
    await page.waitForSelector('[data-testid="form-run"]', { timeout: 10_000 });
    const n = await page.locator('[data-testid="form-run"]').count();
    assert(n >= 2, `expected 2 planted runs, saw ${n}`);
    await page.locator('[data-testid="form-run"]', { hasText: 'greenhouse.example.net' }).first().click();
    await page.waitForSelector('text=Every field verified', { timeout: 10_000 });
    await page.waitForSelector('text=Will you require sponsorship?');
    const img = page.locator('.shot-row img').first();
    await img.waitFor();
    const src = (await img.getAttribute('src')) ?? '';
    assert(/^\/api\/forms\/runs\/[0-9a-f-]+\/shots\/step-1\.jpg$/.test(src), `screenshot should be a shot URL, got ${src}`);
    assert(await waitFor(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)), 'the step screenshot did not load');
    await shot('forms-run-desktop');
  });

  await t.step('Accounts shows site accounts (never a password) and saves the account email', async () => {
    await page.goto(`${t.base}/#/forms?tab=accounts`);
    await page.waitForSelector(`[data-testid="site-accounts"] >> text=${p!.accountDomain}`, { timeout: 10_000 });
    const raw = JSON.stringify(await apiGet(page, '/api/forms/accounts'));
    assert(!/secret|password/i.test(raw), 'the accounts route leaks a secret name or password');
    await page.fill('[data-testid="account-email"]', 'mira.jobs@example.net');
    await page.getByRole('button', { name: 'Save' }).click();
    const ok = await waitFor(async () => (await apiGet<{ accountEmail?: string }>(page, '/api/forms/settings')).accountEmail === 'mira.jobs@example.net');
    assert(ok, 'the account email was not saved');
  });

  await t.step('the bad shot names are refused', async () => {
    const status = await page.evaluate(async (id) => (await fetch(`/api/forms/runs/${id}/shots/..%2Frun.json`)).status, p!.runIds.submitted);
    assert(status >= 400, `a traversal name answered ${status}`);
  });

  // ── Inbox ─────────────────────────────────────────────────────────────
  await t.step('Inbox lists the planted replies, linked to the job, never a code', async () => {
    await page.goto(`${t.base}/#/inbox`);
    await page.waitForSelector('[data-testid="inbox-message"]', { timeout: 10_000 });
    await noFallback(page, 'Inbox');
    const n = await page.locator('[data-testid="inbox-message"]').count();
    assert(n >= 4, `expected 4 planted messages, saw ${n}`);
    const interview = page.locator('[data-testid="inbox-message"]', { hasText: 'a call with the platform team' });
    await interview.locator(`a[href="#/pipeline?job=${p!.jobId}"]`).waitFor();
    await page.waitForSelector('text=Held for review');
    await page.waitForSelector('text=Reply drafted');
    await shot('inbox-desktop');
    await shot('inbox-phone', phone);
    await page.setViewportSize(desk);
  });

  await t.step('a message opens with its drafted reply and the crash plan link', async () => {
    await page.goto(`${t.base}/#/inbox?message=${p!.messageIds.question}`);
    await page.waitForSelector('text=Drafted reply', { timeout: 10_000 });
    await page.waitForSelector('text=My notice period is four weeks.');
    await shot('inbox-message-desktop');
    await page.goto(`${t.base}/#/inbox?message=${p!.messageIds.interview}`);
    await page.waitForSelector(`.drawer a[href="#/learning?plan=${p!.planId}"], a[href="#/learning?plan=${p!.planId}"]`, { timeout: 10_000 });
  });

  await t.step('Done clears the reply from the badge; Mark as new brings it back', async () => {
    const before = (await apiGet<{ counts: { inbox: number } }>(page, '/api/shell')).counts.inbox;
    assert(before >= 3, `the badge should count the interview, the question and the held message (saw ${before})`);
    await page.goto(`${t.base}/#/inbox`);
    const row = page.locator('[data-testid="inbox-message"]', { hasText: 'a call with the platform team' });
    await row.getByRole('button', { name: 'Done' }).click();
    const dropped = await waitFor(async () => (await apiGet<{ counts: { inbox: number } }>(page, '/api/shell')).counts.inbox === before - 1);
    assert(dropped, 'marking done did not lower the inbox badge');
    const m = await apiGet<{ message: { done?: boolean; handled: boolean } }>(page, `/api/inbox/messages/${p!.messageIds.interview}`);
    assert(m.message.done === true && m.message.handled === true, 'done must not touch the pipeline-owned handled flag');
    await row.getByRole('button', { name: 'Mark as new' }).click();
    assert(await waitFor(async () => (await apiGet<{ counts: { inbox: number } }>(page, '/api/shell')).counts.inbox === before), 'Mark as new did not restore the badge');
  });

  await t.step('the alert deep link /inbox/<id> opens that message', async () => {
    await page.goto(`${t.base}/inbox/${p!.messageIds.interview}`);
    await page.waitForSelector('text=Why it was filed this way', { timeout: 10_000 });
    assert(page.url().includes(`#/inbox?message=${p!.messageIds.interview}`), `deep link landed on ${page.url()}`);
  });

  // ── Learning ──────────────────────────────────────────────────────────
  await t.step('Learning shows the crash plan and the gap report', async () => {
    await page.goto(`${t.base}/#/learning`);
    await page.waitForSelector(`[data-testid="learning-plan"] >> text=${p!.company}`, { timeout: 10_000 });
    await page.waitForSelector('[data-testid="gap-report"] >> text=Terraform');
    await noFallback(page, 'Learning');
    await shot('learning-desktop');
    await shot('learning-phone', phone);
    await page.setViewportSize(desk);
  });

  await t.step('the plan deep link /learning/plans/<id> opens the plan', async () => {
    await page.goto(`${t.base}/learning/plans/${p!.planId}`);
    await page.waitForSelector('text=Day 1: Terraform modules and state', { timeout: 10_000 });
    assert(page.url().includes(`#/learning?plan=${p!.planId}`), `deep link landed on ${page.url()}`);
  });

  await t.step('Add queues a gap skill through /api/learning/list/queue', async () => {
    await page.goto(`${t.base}/#/learning`);
    const row = page.locator('[data-testid="gap-report"] tr', { hasText: 'Kafka' });
    await row.getByRole('button', { name: 'Add' }).click();
    const ok = await waitFor(async () => (await apiGet<{ items: { skill: string; status: string }[] }>(page, '/api/master/learning')).items.some((i) => i.skill === 'Kafka' && i.status === 'queued'));
    assert(ok, 'Kafka is not queued on the learning list');
    await row.locator('text=On your list').waitFor({ timeout: 10_000 });
  });

  // ── The job timeline's Form section reads the real run ──────────────
  await t.step('the job timeline shows the form run with its field log', async () => {
    await page.goto(`${t.base}/#/pipeline?job=${p!.jobId}`);
    await page.waitForSelector('[data-testid="timeline"] >> text=Every field verified', { timeout: 15_000 });
    await page.waitForSelector('[data-testid="timeline"] >> text=Will you require sponsorship?');
  });

  // ── Settings: the mailbox card reads the real settings shape ────────
  await t.step('Settings shows the mailbox card on the real settings route', async () => {
    await page.goto(`${t.base}/#/settings`);
    await page.waitForSelector('text=Reading replies (IMAP)', { timeout: 10_000 });
    await page.waitForSelector('text=Check this mailbox');
    const card = await page.locator('section.card', { hasText: 'Reading replies (IMAP)' }).first().innerText();
    assert(!NOT_IN_BUILD.test(card), 'the mailbox card still shows the "not in this build" state');
  });
}
