import type { Page } from 'playwright-core';
import type { Adapter } from './types.ts';

const aid = (id: string) => `[data-automation-id="${id}"]`;

async function visible(page: Page, sel: string, timeout = 400) {
  return page.locator(sel).first().isVisible({ timeout }).catch(() => false);
}

/**
 * Workday: Apply → "Start Your Application" (Autofill with Resume) → create
 * account or sign in (dedicated email, vault password, email code) → upload the
 * CV for parsing → six steps (My Information, My Experience with parse
 * correction, Application Questions, Voluntary Disclosures, Self Identify,
 * Review) → Submit → "Application Submitted".
 */
export const workday: Adapter = {
  ats: 'workday',
  name: 'Workday',
  openForm: async (page) => {
    if (await visible(page, aid('adventureButton'), 3000)) {
      await page.locator(aid('adventureButton')).first().click();
      const choice = page.locator(`${aid('autofillWithResume')}, ${aid('applyManually')}`).first();
      await choice.waitFor({ timeout: 8000 }).catch(() => {});
      if (await visible(page, aid('autofillWithResume'))) await page.locator(aid('autofillWithResume')).first().click();
      else if (await visible(page, aid('applyManually'))) await page.locator(aid('applyManually')).first().click();
      await page.waitForTimeout(500);
    }
  },
  account: {
    needed: async (page) =>
      (await visible(page, aid('createAccountPage'))) ||
      (await visible(page, aid('signInPage'))) ||
      (await visible(page, aid('verifyAccountPage'))) ||
      // Newer tenants put "Create Account / Sign In" in the wizard itself, without the page markers: an email and a
      // password box on the same screen is the wall.
      ((await visible(page, 'input[type=password]')) && ((await visible(page, aid('email'))) || (await visible(page, 'input[type=email]')))),
  },
  beforeStep: async (page, run) => {
    // Resume-parse correction: the parser invents entries (a side project as a job); keep only as many as the profile has.
    for (const [prefix, keep] of [['workExperience', run.entries.work], ['education', run.entries.education]] as const) {
      for (let n = 9; n > keep; n--) {
        const panel = page.locator(aid(`${prefix}-${n}`));
        if (!(await panel.count().catch(() => 0))) continue;
        await panel.locator(aid('panel-set-delete-button')).first().click({ timeout: 3000 }).catch(() => {});
        await panel.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
        run.note(`removed parsed ${prefix} entry ${n} (not in the profile)`);
      }
    }
  },
  next: [aid('bottom-navigation-next-button'), aid('pageFooterNextButton')],
  submit: [`${aid('bottom-navigation-next-button')}:has-text("Submit")`, aid('pageFooterSubmitButton')],
  isFinal: async (page) => (await visible(page, aid('reviewJobApplicationPage'))) || (await visible(page, `${aid('bottom-navigation-next-button')}:has-text("Submit")`)),
  confirm: { text: /application submitted|thank(s| you) for applying/i, selectors: [aid('applicationSubmittedHeader'), aid('congratulationsPopup')], url: /__confirm|userHome|submitted/i },
  ignore: [/^search$/i],
  stepWaitMs: 8000,
};
