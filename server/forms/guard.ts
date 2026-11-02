import type { BrowserContext, Page } from 'playwright-core';

/**
 * The submit guard: while Bureau fills a form, the page cannot submit it.
 * A capture-phase `submit` listener cancels every submit event, and
 * `form.submit()` / `form.requestSubmit()` do nothing, unless Bureau opened the
 * gate for the one click it means (a wizard's Next, or the final, verified
 * submit). This catches implicit submission (Enter in a text field), widgets
 * that submit on their own, and anything else that would send an unverified
 * application. It changes nothing a site can detect about the browser.
 */
const GUARD = String.raw`(() => {
  if (window.__bureauGuard) return;
  window.__bureauGuard = true;
  window.__bureauAllowSubmit = false;
  window.__bureauBlockedSubmits = 0;
  const blocked = () => { window.__bureauBlockedSubmits = (window.__bureauBlockedSubmits || 0) + 1; };
  document.addEventListener('submit', (e) => {
    if (!window.__bureauAllowSubmit) { e.preventDefault(); e.stopImmediatePropagation(); blocked(); }
  }, true);
  const P = HTMLFormElement.prototype;
  const submit = P.submit;
  P.submit = function () { if (!window.__bureauAllowSubmit) { blocked(); return; } return submit.call(this); };
  if (P.requestSubmit) {
    const rs = P.requestSubmit;
    P.requestSubmit = function (s) { if (!window.__bureauAllowSubmit) { blocked(); return; } return rs.call(this, s); };
  }
})()`;

/** Arm the guard in every current and future document of this context. */
export async function armSubmitGuard(ctx: BrowserContext, page: Page) {
  await ctx.addInitScript(GUARD).catch(() => {});
  for (const f of page.frames()) await f.evaluate(GUARD).catch(() => {});
}

/** Open (or close) the gate in every frame. */
export async function allowSubmit(page: Page, on: boolean) {
  for (const f of page.frames()) {
    if (f.isDetached()) continue;
    await f.evaluate(`(() => { if (!window.__bureauGuard) ${GUARD}; window.__bureauAllowSubmit = ${on ? 'true' : 'false'}; })()`).catch(() => {});
  }
}

/** How many submits the guard stopped (for the run log). */
export async function blockedSubmits(page: Page): Promise<number> {
  let n = 0;
  for (const f of page.frames()) n += Number(await f.evaluate('window.__bureauBlockedSubmits || 0').catch(() => 0)) || 0;
  return n;
}

/** Run `fn` with the gate open, then close it again. */
export async function withSubmitAllowed<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  await allowSubmit(page, true);
  try {
    return await fn();
  } finally {
    await page.waitForTimeout(150).catch(() => {});
    await allowSubmit(page, false);
  }
}
