import type { GoldenFill } from './types.ts';

const CARD = 'cards[d4e8a1f2-6b3c-4a9d-8e7f-0c2b5a9d1e43]';

/** Lever: full-name field, resume parse states, location typeahead, posting card, EEO, consent, invisible hCaptcha. */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('lever'));

  const [cv] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.visible-resume-upload').click()]);
  await cv.setFiles(files.cv);
  await page.locator('.resume-upload-success').waitFor({ state: 'visible' });

  await page.locator('input[name=name]').fill(data.fullName);
  await page.locator('input[name=email]').fill(data.email);
  await page.locator('input[name=phone]').fill(data.phone);

  const loc = page.locator('#location-input');
  await loc.pressSequentially('Lahore', { delay: 30 });
  await page.locator('.dropdown-results .dropdown-location', { hasText: 'Lahore, Punjab, Pakistan' }).first().waitFor();
  await loc.press('ArrowDown');
  await loc.press('Enter');

  await page.locator('input[name=org]').fill(String(data.currentCompany));
  await page.locator('input[name="urls[LinkedIn]"]').fill(String(data.linkedin));
  await page.locator('input[name="urls[GitHub]"]').fill(String(data.github));
  await page.locator('input[name="urls[Portfolio]"]').fill(String(data.portfolio));

  await page.locator(`li.custom-question label:has(input[name="${CARD}[field0]"])`, { hasText: data.answers.authorizedToWorkPakistan }).click();
  await page.locator(`select[name="${CARD}[field1]"]`).selectOption({ label: '1-2 years' });
  await page.locator(`textarea[name="${CARD}[field2]"]`).fill(text.project);
  await page.locator('#additional-information').fill(text.coverLetter);

  await page.locator('select[name="eeo[gender]"]').selectOption({ label: 'Decline to self-identify' });
  await page.locator('select[name="eeo[race]"]').selectOption({ label: 'Decline to self-identify' });
  await page.locator('select[name="eeo[veteran]"]').selectOption({ label: 'Decline to self-identify' });

  await page.locator('input[type=checkbox][name="consent[store]"]').check();

  await Promise.all([page.waitForURL(/__confirm\/lever|\/thanks$/), page.locator('#btn-submit').click()]);
  await page.locator('[data-qa=msg-submit-success]', { hasText: 'Application submitted!' }).waitFor();
};
export default fill;
