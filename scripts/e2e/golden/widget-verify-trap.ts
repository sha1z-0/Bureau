import type { Locator, Page } from 'playwright-core';
import type { GoldenFill } from './types.ts';

/**
 * Verify-trap (submitted): a careful human writes, waits for the field to settle,
 * reads it back, and corrects. Each trap is first sprung the naive way, so the
 * golden documents what goes wrong, then fixed the careful way.
 */
const settle = (page: Page) => page.waitForTimeout(400);
async function readBack(field: Locator, want: string | RegExp, what: string): Promise<void> {
  const got = await field.inputValue();
  if (typeof want === 'string' ? got !== want : !want.test(got)) throw new Error(`${what}: read back "${got}", wanted ${String(want)}`);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const fill: GoldenFill = async (page, { fx, data }) => {
  await page.goto(fx.url('widget-verify-trap'));
  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);

  // phone-reformat (benign): blur reformats, digits survive; accept the equivalent value.
  const phone = page.getByLabel('Mobile phone');
  await phone.fill(data.phone);
  await phone.press('Tab');
  await readBack(phone, '(301) 555-0142', 'phone');

  // salary-truncate: the sentence gets cut to 10 chars; the plain number fits.
  const salary = page.getByLabel('Expected annual salary (USD)');
  await salary.fill(data.answers.salaryExpectation);
  if ((await salary.inputValue()) === data.answers.salaryExpectation) throw new Error('salary was not truncated: fixture broken');
  await salary.fill(data.answers.salaryNumber);
  await readBack(salary, data.answers.salaryNumber, 'salary');

  // inline-commit: leaving the field by focusing another one discards it after 300 ms...
  const linkedin = page.getByLabel('LinkedIn profile URL');
  await linkedin.fill(String(data.linkedin));
  await page.getByLabel('Email').focus();
  await settle(page);
  await readBack(linkedin, '', 'linkedin (expected the naive fill to be discarded)');
  // ...so commit it with Enter as the hint says, then check it stuck.
  await linkedin.fill(String(data.linkedin));
  await linkedin.press('Enter');
  await page.getByLabel('Email').focus();
  await settle(page);
  await readBack(linkedin, String(data.linkedin), 'linkedin');

  // reset-dependent: City is before Country in the DOM, and Country clears City.
  const city = page.getByLabel('City');
  const country = page.getByLabel('Country of residence');
  await city.fill(data.city as string);
  await country.selectOption({ label: data.country as string });
  await readBack(city, '', 'city (expected the country change to clear it)');
  await city.fill(data.city as string);
  await readBack(city, data.city as string, 'city');
  await readBack(country, 'PK', 'country');

  // picker-only: typing is ignored; use the calendar.
  const avail = page.getByLabel('Available from');
  await avail.pressSequentially('12/01/2026');
  await readBack(avail, '', 'available-from (typed text should be ignored)');
  await avail.click();
  const [y, m, d] = data.answers.startDate.split('-').map(Number);
  const title = page.locator('.dp-popup .dp-title');
  for (let i = 0; i < 240; i++) {
    const [mon, yr] = (await title.innerText()).split(' ');
    const diff = (y - Number(yr)) * 12 + (m - 1 - MONTHS.indexOf(mon));
    if (diff === 0) break;
    await page.getByRole('button', { name: diff > 0 ? 'Next month' : 'Previous month' }).click();
  }
  await page.getByRole('gridcell', { name: `${MONTHS[m - 1]} ${d}, ${y}`, exact: true }).click();
  await readBack(avail, `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`, 'available-from display');
  await readBack(page.locator('input[name="available_from"]'), data.answers.startDate, 'available-from value');

  // fake-checkbox: the box only changes its look. Clicking it shows aria-checked=true but
  // the submitted value stays empty, so undo that and click the label text instead.
  const box = page.getByRole('checkbox', { name: /I agree to Meridian/ });
  const consent = page.locator('input[name="privacy_consent"]');
  await box.click();
  if ((await box.getAttribute('aria-checked')) !== 'true') throw new Error('consent box did not toggle');
  await readBack(consent, '', 'consent (box click should not set the value)');
  await box.click();
  await page.locator('#consent_label').click();
  if ((await box.getAttribute('aria-checked')) !== 'true') throw new Error('consent not shown as checked');
  await readBack(consent, 'yes', 'consent');

  // Final read-back of everything the traps touch, after they had time to fire.
  await settle(page);
  await readBack(linkedin, String(data.linkedin), 'linkedin (final)');
  await readBack(city, data.city as string, 'city (final)');
  await readBack(salary, data.answers.salaryNumber, 'salary (final)');

  await Promise.all([page.waitForURL(/__confirm\/widget-verify-trap/), page.getByRole('button', { name: 'Submit application' }).click()]);
};
export default fill;
