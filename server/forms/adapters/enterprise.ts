import type { Frame, Page } from 'playwright-core';
import type { Adapter } from './types.ts';

/**
 * The enterprise ATSs: iCIMS, Taleo and SAP SuccessFactors. Each was built
 * against a local replica of its public application flow
 * (fixtures/ats/{icims,taleo,successfactors}, run by the A05 selfcheck).
 */

/** The first frame (main first) where one of `sels` is visible, waiting up to `ms`. */
async function visibleIn(page: Page, sels: string[], ms = 0): Promise<{ frame: Frame; selector: string } | null> {
  const until = Date.now() + ms;
  for (;;) {
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;
      for (const selector of sels) {
        if (await frame.locator(selector).first().isVisible({ timeout: 100 }).catch(() => false)) return { frame, selector };
      }
    }
    if (Date.now() >= until) return null;
    await page.waitForTimeout(250);
  }
}

async function clickIn(page: Page, sels: string[], ms: number): Promise<boolean> {
  const hit = await visibleIn(page, sels, ms);
  if (!hit) return false;
  await hit.frame.locator(hit.selector).first().click({ timeout: 5000 }).catch(() => {});
  await hit.frame.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(400);
  return true;
}

const passwordShown = async (page: Page) => !!(await visibleIn(page, ['input[type=password]']));

/**
 * iCIMS: the portal shows the job in iframe#icims_content_iframe (`?in_iframe=1`), and
 * employers embed that frame cross-origin on their own careers pages. "Apply for this
 * job online" navigates the frame to the email-first login (a new candidate gives an
 * email and accepts the privacy policy; no password), then Candidate Profile → questions
 * → voluntary self-identification → eSignature → Submit, all inside the frame. A tenant
 * that asks returning candidates for a password goes through the accounts flow.
 */
export const icims: Adapter = {
  ats: 'icims',
  name: 'iCIMS',
  openForm: async (page, run) => {
    if (await clickIn(page, ['a.iCIMS_ApplyOnlineButton', 'a:has-text("Apply for this job online")', 'a[title="Apply for this job online"]'], 8000)) run.note('opened the iCIMS application (Apply for this job online)');
  },
  account: { needed: passwordShown },
  next: ['#enterprise_next', 'input[type=submit][value="Next"]', 'input[value="Next"]', 'button:has-text("Next")'],
  submit: ['#enterprise_submit', 'input[type=submit][value="Submit"]', 'input[value="Submit"]', 'button:has-text("Submit")'],
  confirm: { text: /thank(s| you) for (applying|your (application|interest))|application (has been )?(submitted|received)|successfully applied/i, selectors: ['.iCIMS_InfoMsg_Submitted'] },
  ignore: [/^search( jobs)?$|newsletter|news by email|talent community/i],
};

/**
 * Taleo (Oracle Taleo Enterprise career sections): jobdetail.ftl → "Apply Online" →
 * the career-section login (sign in, or "New User" registration with a user name,
 * password and email: the accounts flow uses the dedicated job-search email as user
 * name) → jobapply.ftl wizard: Privacy Agreement → Resume Upload → General Profile →
 * Job-Specific Questions → Diversity → eSignature → Review and Submit → Submit.
 */
export const taleo: Adapter = {
  ats: 'taleo',
  name: 'Taleo',
  openForm: async (page, run) => {
    if (await clickIn(page, ['a#applyFromDetailBtn', 'a:has-text("Apply Online")', 'button:has-text("Apply Online")'], 3000)) run.note('opened the Taleo application (Apply Online)');
  },
  account: {
    needed: passwordShown,
    selectors: {
      signInView: ['form#loginForm', 'form[action*="login" i]'],
      createView: ['form#registerForm', 'form[action*="register" i]'],
      toCreate: ['a:has-text("New User")', 'a:has-text("Register")', 'a:has-text("Create Account")'],
      toSignIn: ['a:has-text("Sign In")', 'a:has-text("Log In")'],
      username: ['input[name$="userName" i]', 'input[id$="userName" i]', 'input[id*="login-name" i]', 'input[autocomplete="username"]'],
      verifyView: ['form#verifyEmailForm'],
      email: ['input[type=email]', 'input[name$="email" i]'],
      createSubmit: ['#dialogTemplate-dialogForm-defaultCreateAccount-register', 'input[type=submit][value="Register"]', 'button:has-text("Register")'],
      signInSubmit: ['#dialogTemplate-dialogForm-login-defaultCmd', 'input[type=submit][value="Login"]', 'button:has-text("Login")', 'button:has-text("Sign In")'],
      exists: /already (exists|registered|in use)|user name is not available|account with this email/i,
    },
  },
  next: ['#et-ef-content-ftf-saveContinueCmdBottom', 'input[type=submit][value="Save and Continue"]', 'input[value="Save and Continue"]', 'button:has-text("Save and Continue")'],
  submit: ['#et-ef-content-ftf-submitCmdBottom', 'input[type=submit][value="Submit"]', 'input[value="Submit"]', 'button:has-text("Submit")'],
  isFinal: async (page) => !!(await visibleIn(page, ['#et-ef-content-ftf-submitCmdBottom', 'input[type=submit][value="Submit"]'])),
  confirm: { text: /thank you for (applying|your application|submitting)|application (has been )?(submitted|received)|submission (is )?complete/i, selectors: ['#confirmationPanel'] },
  ignore: [/^(save as draft|quit|cancel)$/i],
};

/**
 * SAP SuccessFactors (career site builder / career<N>.successfactors.com): job
 * listing → "Apply now" → sign in or "Create an Account" (email, retype email,
 * password, retype password, name, country of residence, data privacy
 * acceptance; the accounts flow fills the profile part from the candidate) →
 * one long application page (profile, resume, questions, EEO) → "Apply".
 */
export const successfactors: Adapter = {
  ats: 'successfactors',
  name: 'SAP SuccessFactors',
  openForm: async (page, run) => {
    if (await clickIn(page, ['a.dialogApplyBtn', 'button#applyBtn', 'a:has-text("Apply now")', 'button:has-text("Apply now")'], 3000)) run.note('opened the SuccessFactors application (Apply now)');
    // The data privacy statement comes first: accepting it is how the site lets anyone apply.
    if (await clickIn(page, ['button#dpcsAccept', 'button:has-text("Accept")'], 1500)) run.note('accepted the data privacy statement');
  },
  account: {
    needed: passwordShown,
    selectors: {
      signInView: ['form#loginForm', 'form[action*="login" i]'],
      createView: ['form#createAccountForm', 'form[action*="createAccount" i]', 'form[action*="register" i]'],
      toCreate: ['a:has-text("Create an Account")', 'button:has-text("Create an Account")', 'a:has-text("Create Account")'],
      toSignIn: ['a:has-text("Sign In")', 'button:has-text("Sign In")'],
      email: ['input#fbclc_userName', 'input[type=email]:not([name*="confirm" i]):not([name*="retype" i])', 'input[name*="email" i]:not([name*="confirm" i]):not([name*="retype" i])'],
      confirmEmail: ['input#fbclc_emailConf', 'input[name*="emailConf" i]', 'input[name*="retype" i][type=email]', 'input[name*="confirm" i][type=email]'],
      password: ['input#fbclc_pwd', 'input[type=password]:not([name*="conf" i])'],
      confirm: ['input#fbclc_pwdConf', 'input[type=password][name*="conf" i]'],
      consent: ['input#fbclc_privacy', 'input[type=checkbox][name*="privacy" i]', 'input[type=checkbox][name*="agree" i]'],
      createSubmit: ['button#fbclc_createAccountButton', 'button:has-text("Create Account")'],
      signInSubmit: ['button#fbclc_signInButton', 'button:has-text("Sign In")'],
    },
  },
  submit: ['button#applyButton', 'button:has-text("Apply")', 'button:has-text("Submit")'],
  confirm: { text: /thank(s| you) for (applying|your application)|application (has been )?(submitted|received)|successfully applied/i, selectors: ['#applySuccessMessage'] },
  ignore: [/^(save draft|cancel|search)$/i, /job alerts|similar jobs/i],
};
