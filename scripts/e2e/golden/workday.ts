import crypto from 'node:crypto';
import type { Locator, Page } from 'playwright-core';
import type { GoldenFill } from './types.ts';

/**
 * Workday (atlasmutual.wd5): job page -> Apply -> Autofill with Resume ->
 * Create Account -> code from the verification email -> upload CV -> correct
 * every resume-parse error -> six steps -> Submit -> Application Submitted.
 * Uses the widgets the way a person does (clicks, typing, keyboard, file
 * chooser); no page.evaluate.
 */

const s = (str: string) => str.toLowerCase();

/**
 * A password that satisfies Workday's rules (8+, upper, lower, digit, special).
 * Derived from the email so a second run against the same fixture server can
 * sign in to the account the first run created (Workday refuses a duplicate).
 */
function strongPassword(email: string): string {
  const h = crypto.createHash('sha256').update(`bureau-golden:${email}`).digest('base64url').replace(/[^A-Za-z0-9]/g, 'x');
  return `Atl@s-${h.slice(0, 10)}9Qz!`;
}

function aid(id: string): string {
  return `[data-automation-id="${id}"]`;
}

async function expectVisible(loc: Locator, what: string) {
  if (!(await loc.first().isVisible())) throw new Error(`expected ${what} to be visible`);
}

async function expectValue(loc: Locator, want: string, what: string) {
  const got = await loc.inputValue();
  if (got !== want) throw new Error(`${what}: expected "${want}", got "${got}"`);
}

/** Open a Workday button dropdown and click the option with this exact text. */
async function pickDropdown(page: Page, button: Locator, option: string) {
  await button.click();
  const listbox = page.locator('[data-automation-widget="wd-popup"] ul[role=listbox]');
  await listbox.waitFor();
  await listbox.locator(`li[role=option][data-value="${option.replace(/"/g, '\\"')}"]`).click();
  await page.waitForFunction(
    ([id, want]) => document.getElementById(id as string)?.getAttribute('value') === want,
    [await button.getAttribute('id'), option],
  );
}

/** Dropdown found by its label text (Application Questions have opaque ids). */
function dropdownByLabel(page: Page, label: string): Locator {
  return page.locator('.wd-field', { has: page.locator('label', { hasText: label }) }).locator('button[aria-haspopup=listbox]');
}

/** Prompt: search (Enter) and pick; Workday auto-selects a lone match. */
async function promptSearch(page: Page, field: Locator, query: string, pick: string) {
  const input = field.locator('input[data-uxi-widget-type=selectinput]');
  await input.click();
  await input.fill(query);
  await input.press('Enter');
  const pill = field.locator(`${aid('selectedItem')}[title="${pick}"]`);
  const option = page.locator(`${aid('promptPopup')} ${aid('promptOption')}[data-automation-label="${pick}"]`);
  await Promise.race([pill.waitFor(), option.waitFor()]);
  if (!(await pill.isVisible())) {
    // Several matches: choose the right one from the results.
    await option.click();
    await pill.waitFor();
  }
  if (await page.locator(aid('promptPopup')).isVisible()) await page.keyboard.press('Escape');
}

async function typeDate(field: Locator, digits: string) {
  // Click the first segment and type straight through; the segments auto-advance.
  await field.locator('input[role=spinbutton]').first().click();
  await field.page().keyboard.type(digits, { delay: 15 });
}

async function saveAndContinue(page: Page, nextHeader: string) {
  await page.click(aid('bottom-navigation-next-button'));
  await page.locator(aid('pageHeader'), { hasText: nextHeader }).waitFor();
}

const fill: GoldenFill = async (page, { fx, data, files }) => {
  const d = data as Record<string, string> & typeof data;
  const email = d.email;
  const password = strongPassword(email);

  // ---------------------------------------------------------------- job page
  await page.goto(fx.url('workday'));
  await page.locator(aid('jobPostingHeader'), { hasText: 'Associate Software Engineer' }).waitFor();
  await page.click(aid('adventureButton'));
  await page.locator('[role=dialog]', { hasText: 'Start Your Application' }).waitFor();
  await page.click(aid('autofillWithResume'));

  // ---------------------------------------------------------------- account
  const create = page.locator(aid('createAccountPage'));
  await create.waitFor();
  await create.locator(`input${aid('email')}`).fill(email);
  await create.locator(`input${aid('password')}`).fill(password);
  await create.locator(`input${aid('verifyPassword')}`).fill(password);
  await create.locator(`input${aid('createAccountCheckbox')}`).check();
  const mailsBefore = fx.mail().length;
  // The real button sits under Workday's click_filter overlay; click what a person clicks.
  await create.locator(aid('click_filter')).click();

  const verify = page.locator(aid('verifyAccountPage'));
  const exists = create.locator(aid('errorMessage'), { hasText: 'already exists' });
  await Promise.race([verify.waitFor(), exists.waitFor()]);
  if (await exists.isVisible().catch(() => false)) {
    // A previous application made this account: sign in to it instead.
    await create.locator(aid('signInLink')).click();
    const signIn = page.locator(aid('signInPage'));
    await signIn.locator(`input${aid('email')}`).fill(email);
    await signIn.locator(`input${aid('password')}`).fill(password);
    await signIn.locator(aid('click_filter')).click();
  } else {
    // Read the verification email like a person would: newest message to this address.
    let code = '';
    for (let i = 0; i < 50 && !code; i++) {
      const mail = fx.mail().slice(mailsBefore).filter((m) => s(m.to) === s(email) && /verify your candidate account/i.test(m.subject)).at(-1);
      code = mail?.text.match(/\b(\d{6})\b/)?.[1] ?? '';
      if (!code) await page.waitForTimeout(100);
    }
    if (!code) throw new Error('no verification email arrived');
    await verify.locator(`input${aid('verificationCode')}`).fill(code);
    await verify.locator(aid('click_filter')).click();
  }

  // ---------------------------------------------------------------- autofill with resume
  await page.locator(aid('pageHeader'), { hasText: 'Autofill with Resume' }).waitFor();
  await expectVisible(page.locator(aid('utilityMenuButton'), { hasText: email }), 'signed-in account menu');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(aid('select-files'))]);
  await chooser.setFiles(files.cv);
  await page.locator(aid('file-upload-item-status'), { hasText: 'Successfully Uploaded' }).waitFor();
  await page.click(aid('bottom-navigation-next-button'));

  // ---------------------------------------------------------------- 1. My Information
  await page.locator(aid('pageHeader'), { hasText: 'My Information' }).waitFor();
  await page.locator(aid('progressBarStepCounter'), { hasText: 'Step 1 of 6' }).waitFor();

  // Saving with required fields empty must be blocked.
  await page.click(aid('bottom-navigation-next-button'));
  await page.locator(aid('errorBanner'), { hasText: 'Errors Found' }).waitFor();
  await expectVisible(page.locator(aid('errorMessage'), { hasText: 'The field How Did You Hear About Us? is required and must have a value.' }), 'source required error');
  await expectVisible(page.locator(aid('pageHeader'), { hasText: 'My Information' }), 'still on My Information');

  // How Did You Hear About Us?  Job Board > LinkedIn (multi-level prompt).
  const source = page.locator(aid('formField-source'));
  await source.locator('input[data-uxi-widget-type=selectinput]').click();
  await page.locator(`${aid('promptPopup')} ${aid('promptOption')}[data-automation-label="Job Board"]`).click();
  await page.locator(`${aid('promptPopup')} ${aid('promptOption')}[data-automation-label="LinkedIn"]`).click();
  await source.locator(`${aid('selectedItem')}[title="LinkedIn"]`).waitFor();

  await page.locator(aid('formField-candidateIsPreviousWorker')).getByText('No', { exact: true }).click();

  // Country defaults to the site's country; this candidate lives in Pakistan.
  await pickDropdown(page, page.locator(`button${aid('countryDropdown')}`), d.country);

  // Parsed name is right; parsed address is mostly missing.
  await expectValue(page.locator(`input${aid('legalNameSection_firstName')}`), d.firstName, 'parsed first name');
  await expectValue(page.locator(`input${aid('legalNameSection_lastName')}`), d.lastName, 'parsed last name');
  await page.locator(`input${aid('addressSection_addressLine1')}`).fill(d.addressLine1);
  await page.locator(`input${aid('addressSection_city')}`).fill(d.city);
  await pickDropdown(page, page.locator(`button${aid('addressSection_countryRegion')}`), d.region);
  await page.locator(`input${aid('addressSection_postalCode')}`).fill(d.postalCode);
  await expectValue(page.locator(`input${aid('email')}`), email, 'account email');

  // Phone: the parser kept the trunk 0 and lost the country code.
  await pickDropdown(page, page.locator(`button${aid('phone-device-type')}`), 'Mobile');
  await promptSearch(page, page.locator(aid('formField-countryPhoneCode')), 'Pakistan', 'Pakistan (+92)');
  await page.locator(`input${aid('phone-number')}`).fill(d.phoneNational);

  await saveAndContinue(page, 'My Experience');

  // ---------------------------------------------------------------- 2. My Experience
  await page.locator(aid('progressBarStepCounter'), { hasText: 'Step 2 of 6' }).waitFor();

  // Bogus entry the parser built from the ledger-lite project.
  const w3 = page.locator(aid('workExperience-3'));
  await expectValue(w3.locator(`input${aid('jobTitle')}`), 'ledger-lite', 'bogus work entry title');
  await w3.locator(aid('panel-set-delete-button')).click();
  await w3.waitFor({ state: 'detached' });

  // Current job: title merged with company, location parsed as company, wrong start year, "Present" lost.
  const w1 = page.locator(aid('workExperience-1'));
  await w1.locator(`input${aid('jobTitle')}`).fill(d.currentTitle);
  await w1.locator(`input${aid('company')}`).fill(d.currentCompany);
  await w1.locator(`input${aid('location')}`).fill('Lahore, Pakistan');
  await w1.locator(`input${aid('currentlyWorkHere')}`).check();
  await page.locator(`${aid('workExperience-1')} ${aid('formField-endDate')}`).waitFor({ state: 'detached' });
  await typeDate(w1.locator(aid('formField-startDate')), `${d.currentStartMonth}${d.currentStartYear}`);

  // Internship parsed correctly; check it rather than trust it.
  const w2 = page.locator(aid('workExperience-2'));
  await expectValue(w2.locator(`input${aid('jobTitle')}`), d.previousTitle, 'internship title');
  await expectValue(w2.locator(`input${aid('company')}`), d.previousCompany, 'internship company');
  await expectValue(w2.locator(`${aid('formField-startDate')} input${aid('dateSectionMonth-input')}`), d.previousStartMonth, 'internship start month');
  await expectValue(w2.locator(`${aid('formField-startDate')} input${aid('dateSectionYear-input')}`), d.previousStartYear, 'internship start year');
  await expectValue(w2.locator(`${aid('formField-endDate')} input${aid('dateSectionMonth-input')}`), d.previousEndMonth, 'internship end month');
  await expectValue(w2.locator(`${aid('formField-endDate')} input${aid('dateSectionYear-input')}`), d.previousEndYear, 'internship end year');

  // Education: truncated school, missing degree, GPA with its scale.
  const e1 = page.locator(aid('education-1'));
  const school = e1.locator(aid('formField-schoolName'));
  await school.locator(`${aid('selectedItem')}[title="Lahore Institute of"] ${aid('DELETE_charm')}`).click();
  await promptSearch(page, school, 'Lahore Institute of Computing', d.school);
  await pickDropdown(page, e1.locator(`button${aid('degree')}`), d.degree);
  await e1.locator(aid('formField-fieldOfStudy')).locator(`${aid('selectedItem')}[title="${d.fieldOfStudy}"]`).waitFor();
  await e1.locator(`input${aid('gpa')}`).fill(d.gpa);
  await expectValue(e1.locator(`${aid('formField-lastYearAttended')} input${aid('dateSectionYear-input')}`), d.gradYear, 'graduation year');

  // Skills: add two the parser missed.
  const skills = page.locator(aid('formField-skills'));
  await promptSearch(page, skills, 'SQL', 'SQL'); // several matches (MySQL, PostgreSQL...): picked from the results
  await promptSearch(page, skills, 'Fastify', 'Fastify');

  // The autofill upload carries over as the Resume/CV.
  await expectVisible(page.locator(aid('formField-resumeAttachments')).locator(aid('file-upload-item-name'), { hasText: 'Rania-Haroon-CV.pdf' }), 'resume chip');
  await expectValue(page.locator(`${aid('website-1')} input`), d.github, 'website 1');
  await expectValue(page.locator(`${aid('website-2')} input`), d.portfolio, 'website 2');
  await page.locator(`input${aid('linkedinQuestion')}`).fill(d.linkedin);

  await saveAndContinue(page, 'Application Questions');

  // ---------------------------------------------------------------- 3. Application Questions
  // Back must keep the corrected values.
  await page.click(aid('bottom-navigation-back-button'));
  await page.locator(aid('pageHeader'), { hasText: 'My Experience' }).waitFor();
  await expectValue(page.locator(`${aid('workExperience-1')} input${aid('jobTitle')}`), d.currentTitle, 'job title after Back');
  if (await page.locator(aid('workExperience-3')).count()) throw new Error('deleted work entry came back after Back');
  await saveAndContinue(page, 'Application Questions');

  const a = d.answers;
  await pickDropdown(page, dropdownByLabel(page, 'legally authorized to work in Pakistan'), a.authorizedToWorkPakistan);
  await pickDropdown(page, dropdownByLabel(page, 'require sponsorship'), a.needsSponsorship);
  await pickDropdown(page, dropdownByLabel(page, 'at least 18 years of age'), a.over18);
  await pickDropdown(page, dropdownByLabel(page, 'previously been employed by Atlas Mutual'), a.previouslyEmployed);
  await page.locator('.wd-field', { has: page.locator('label', { hasText: 'desired annual salary' }) }).locator('input').fill(a.salaryNumber);
  await pickDropdown(page, dropdownByLabel(page, 'notice period'), a.noticePeriod);
  await saveAndContinue(page, 'Voluntary Disclosures');

  // ---------------------------------------------------------------- 4. Voluntary Disclosures
  await pickDropdown(page, page.locator(`button${aid('gender')}`), 'I do not wish to self-identify');
  await pickDropdown(page, page.locator(`button${aid('ethnicityDropdown')}`), 'I do not wish to self-identify (United States of America)');
  await pickDropdown(page, page.locator(`button${aid('veteranStatus')}`), "I don't wish to answer");
  // Consent is required: prove it blocks, then tick it.
  await page.click(aid('bottom-navigation-next-button'));
  await page.locator(aid('formField-agreementCheckbox')).locator(aid('errorMessage')).waitFor();
  await page.locator(`input${aid('agreementCheckbox')}`).check();
  await saveAndContinue(page, 'Self Identify');

  // ---------------------------------------------------------------- 5. Self Identify
  await page.locator(`input${aid('name')}`).fill(d.fullName);
  const now = new Date();
  const today = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${now.getFullYear()}`;
  await typeDate(page.locator(aid('formField-dateSignedOn')), today);
  await page.getByLabel('I do not want to answer', { exact: true }).check();
  await saveAndContinue(page, 'Review');

  // ---------------------------------------------------------------- 6. Review + Submit
  const review = page.locator(aid('reviewJobApplicationPage'));
  for (const text of [d.currentTitle, d.currentCompany, d.school, d.degree, 'Pakistan (+92)', d.addressLine1]) {
    await expectVisible(review.getByText(text, { exact: false }), `review shows ${text}`);
  }
  if (await review.getByText('ledger-lite').count()) throw new Error('review still lists the bogus work entry');
  await expectVisible(page.locator(aid('bottom-navigation-next-button'), { hasText: 'Submit' }), 'Submit button');
  await Promise.all([page.waitForURL(/\/__confirm\/workday/), page.click(aid('bottom-navigation-next-button'))]);
  await page.locator(aid('applicationSubmittedHeader'), { hasText: 'Application Submitted' }).waitFor();
  await page.locator(aid('applicationRow'), { hasText: 'Associate Software Engineer' }).first().waitFor();
};
export default fill;
