import type { GoldenFill } from './types.ts';

/** Teamtailor: questions first, menu-checkbox multi choice, intl-tel-input, Dropzone (hidden input on <body>). */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('teamtailor-careersite'));

  await page.getByLabel(/years of professional software development/).fill(String(data.yearsExperience));
  await page.getByRole('group', { name: /visa sponsorship/ }).getByLabel('Yes').check();
  await page.getByRole('group', { name: /18 years of age/ }).getByLabel('Yes').check();
  await page.getByLabel(/salary expectations/).fill(data.answers.salaryExpectation);
  await page.locator('#trigger-dropdown-5e0c2a71').click();
  for (const opt of ['React', 'Node.js', 'PostgreSQL']) await page.getByRole('menuitemcheckbox', { name: opt }).click();
  await page.keyboard.press('Escape');

  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);
  // Pick Pakistan in the intl-tel-input list, then type the national number.
  await page.locator('.iti__selected-flag').click();
  await page.locator('.iti__country[data-country-code=pk]').click();
  await page.locator('#candidate_phone').fill(String(data.phoneLocal));

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Upload CV' }).click()]);
  await chooser.setFiles(files.cv);
  await page.locator('[data-forms--inputs--upload-target=previewsContainer] [data-dz-name]', { hasText: 'Rania-Haroon-CV.pdf' }).waitFor();
  await page.locator('[data-forms--inputs--upload-target=previewsContainer] [data-progress]').waitFor({ state: 'detached' });

  await page.getByLabel('Cover letter').fill(text.coverLetter);
  await page.locator('#candidate_consent_given').check();

  await Promise.all([page.waitForURL(/__confirm\/teamtailor-careersite/), page.getByRole('button', { name: 'Submit application' }).click()]);
};
export default fill;
