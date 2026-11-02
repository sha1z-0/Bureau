import type { GoldenFill } from './types.ts';

/** Recruitee careers site: dotted names, +1 pre-filled phone, invisible file inputs, in-page success. */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('recruitee-careers'));
  const byName = (n: string) => page.locator(`[name="${n}"]`);

  await byName('candidate.name').fill(data.fullName);
  await byName('candidate.email').fill(data.email);
  // The phone input starts as "+1" (United States); pick Pakistan from the country listbox, then type the national number.
  await page.locator('button[aria-haspopup=listbox][aria-label^="Select country calling code"]').click();
  await page.locator('#downshift-0-menu [role=option][aria-label=Pakistan]').click();
  await byName('candidate.phone').press('End');
  await byName('candidate.phone').pressSequentially(` ${data.phoneNational}`, { delay: 10 });

  const [cv] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.upload[data-for=cv] .drop').click()]);
  await cv.setFiles(files.cv);
  const [cl] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.upload[data-for=coverLetterFile] .drop').click()]);
  await cl.setFiles(files.letter);

  await page.getByRole('group', { name: /visa sponsorship/ }).getByLabel('Yes').check();
  await page.getByRole('group', { name: /years of professional web development/ }).getByLabel('1-2 years').check();
  await page.getByLabel('React', { exact: true }).check();
  await page.getByLabel('TypeScript', { exact: true }).check();
  await page.getByLabel(/salary expectations/).fill(data.answers.salaryNumber);
  await page.getByLabel('When could you start?').fill(data.answers.startDate);
  await page.getByLabel(/web project you are proud of/).fill(text.project);
  await byName('candidate.agreements.0.consent').check();

  await page.locator('[data-testid=submit-application-form-button]').click();
  await page.getByText('Your application has been successfully submitted!').waitFor();
};
export default fill;
