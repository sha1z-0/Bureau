import type { Page } from 'playwright-core';
import type { AtsFamily } from '../../contracts/job.ts';
import type { Adapter } from './types.ts';
import { workday } from './workday.ts';

export type { Adapter, AdapterRun } from './types.ts';

/** Click the first visible element among `sels` (main frame). */
export async function clickFirst(page: Page, sels: string[], timeout = 1500): Promise<boolean> {
  for (const s of sels) {
    const l = page.locator(s).first();
    if (await l.isVisible({ timeout }).catch(() => false)) {
      await l.click({ timeout: 5000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

const THANKS = /thank(s| you) for (applying|your application|your interest)|application (has been |was )?(received|submitted|sent)|successfully submitted/i;

/**
 * Per-ATS adapters. Each encodes how to reach the form, how its wizard moves,
 * its quirks and its confirmation signals; the engine does the filling.
 */
export const ADAPTERS: Adapter[] = [
  {
    ats: 'greenhouse',
    name: 'Greenhouse (classic boards, job-boards app, iframe embeds)',
    submit: ['#submit_app', '#application-form button[type=submit]:has-text("Submit")', 'button[type=submit]:has-text("Submit application")', 'input[type=submit][value*="Submit" i]'],
    confirm: { text: THANKS, selectors: ['#application_confirmation', '.application-confirmation', '.confirmation h1'], url: /confirmation|thank|__confirm/i },
    ignore: [/^paste$|enter manually|type your resume|^or$/i],
  },
  {
    ats: 'lever',
    name: 'Lever',
    applyUrl: (u) => (/jobs\.(eu\.)?lever\.co\/[^/]+\/[0-9a-f-]{36}\/?$/i.test(u) ? u.replace(/\/?$/, '/apply') : u),
    submit: ['#btn-submit', 'button[data-qa=btn-submit]', 'button[type=submit]'],
    // Lever's location box is a suggestion typeahead (a pick fills the hidden selectedLocation).
    fixField: (f) => (f.selectors.some((s) => /location-input|name="location"/.test(s)) && f.kind === 'text' ? { ...f, kind: 'location' } : f),
    confirm: { text: /application submitted|thank(s| you) for applying/i, selectors: ['[data-qa=msg-submit-success]'], url: /\/thanks|__confirm/i },
  },
  {
    ats: 'ashby',
    name: 'Ashby',
    applyUrl: (u) => (/jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36}\/?$/i.test(u) ? u.replace(/\/?$/, '/application') : u),
    submit: ['.ashby-application-form-submit-button', 'button:has-text("Submit Application")'],
    confirm: { text: /thank(s| you) for applying|application (was )?(successfully )?submitted|we('|’)ve received/i, url: /confirmation|__confirm/i },
  },
  {
    ats: 'workable',
    name: 'Workable',
    submit: ['[data-ui=apply-button]', 'button[type=submit]:has-text("Submit")'],
    confirm: { text: /thank(s| you)|application (has been )?(sent|submitted|received)/i, selectors: ['[data-ui=application-success]'], url: /success|__confirm/i },
  },
  {
    ats: 'smartrecruiters',
    name: 'SmartRecruiters (OneClick)',
    next: ['[data-test=footer-next]'],
    submit: ['[data-test=footer-submit]', '[data-test=footer-next]:has-text("Submit")', 'button:has-text("Submit")'],
    confirm: { text: /thank(s| you)|application (has been )?(sent|submitted|received)/i, url: /success|confirmation|__confirm/i },
  },
  {
    ats: 'recruitee',
    name: 'Recruitee',
    submit: ['[data-testid=submit-application-form-button]', 'button[type=submit]'],
    confirm: { text: /successfully submitted|thank(s| you)/i },
  },
  {
    ats: 'personio',
    name: 'Personio',
    openForm: async (page) => {
      if (!/\/apply/.test(page.url())) await clickFirst(page, ['a:has-text("Apply for this job")', 'button:has-text("Apply for this job")', 'a[href*="/apply"]']);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    },
    submit: ['button[type=submit]:has-text("Send")', 'button[type=submit]:has-text("Submit")', 'button[type=submit]'],
    confirm: { text: /thank you for your application|application (has been )?(sent|received)/i },
  },
  {
    ats: 'teamtailor',
    name: 'Teamtailor',
    submit: ['button[type=submit]:has-text("Submit application")', 'button[type=submit]'],
    confirm: { text: /thank(s| you)|application (has been )?(sent|submitted|received)/i, url: /thanks|__confirm/i },
  },
  {
    ats: 'bamboohr',
    name: 'BambooHR',
    openForm: async (page) => {
      await clickFirst(page, ['button:has-text("Apply for This Job")', 'a:has-text("Apply for This Job")']);
      await page.waitForTimeout(300);
    },
    submit: ['button:has-text("Submit Application")', 'button[type=submit]'],
    confirm: { text: /thank(s| you)|application (has been )?(sent|submitted|received)/i, url: /__confirm|thank/i },
  },
  {
    ats: 'breezy',
    name: 'Breezy HR',
    next: ['button:has-text("Next")'],
    submit: ['button:has-text("Submit Application")', 'button[type=submit]'],
    confirm: { text: /thank(s| you)|application (has been )?(sent|submitted|received)/i, url: /submitted|__confirm/i },
  },
  workday,
  {
    ats: 'icims',
    name: 'iCIMS (best effort)',
    next: ['#enterprise_next', 'input[value="Next"]', 'button:has-text("Next")'],
    submit: ['#enterprise_submit', 'input[value="Submit"]', 'button:has-text("Submit")'],
    confirm: { text: /thank(s| you)|application (has been )?(submitted|received)|successfully applied/i },
    account: { needed: async (page) => (await page.locator('input[type=password]').count().catch(() => 0)) > 0 },
  },
  {
    ats: 'taleo',
    name: 'Taleo (best effort)',
    next: ['#editTemplateMultipart-editForm-content-ftf-saveContinueCmdBottom', 'input[value="Save and Continue"]', 'button:has-text("Save and Continue")'],
    submit: ['input[value="Submit"]', 'button:has-text("Submit")'],
    confirm: { text: /thank(s| you)|application (has been )?(submitted|received)|confirmation/i },
    account: { needed: async (page) => (await page.locator('input[type=password]').count().catch(() => 0)) > 0 },
  },
  {
    ats: 'successfactors',
    name: 'SAP SuccessFactors (best effort)',
    next: ['button:has-text("Next")', 'button:has-text("Continue")'],
    submit: ['button:has-text("Apply")', 'button:has-text("Submit")'],
    confirm: { text: /thank(s| you)|application (has been )?(submitted|received)/i },
    account: { needed: async (page) => (await page.locator('input[type=password]').count().catch(() => 0)) > 0 },
  },
];

export const GENERIC: Adapter = {
  ats: 'other',
  name: 'Generic',
  confirm: { text: THANKS },
};

export function adapterFor(ats: AtsFamily | null): Adapter | null {
  if (!ats) return null;
  return ADAPTERS.find((a) => a.ats === ats) ?? null;
}
