import type { GoldenFill } from './types.ts';

/**
 * MUI X DatePicker: type the start date digit by digit into the sectioned
 * field, and pick the graduation date (June 2023) through the calendar's year
 * view and month arrows. Read both back from the visible field.
 */
const fill: GoldenFill = async (page, { fx, data }) => {
  await page.goto(fx.url('widget-mui-datepicker'));
  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);

  // Earliest start date: digits only; the field supplies the slashes and advances sections.
  const start = page.getByRole('textbox', { name: 'Earliest start date' });
  await start.click();
  await start.pressSequentially(data.answers.startDateUs.replace(/\D/g, ''), { delay: 30 });
  await start.press('Tab');
  const startShown = await start.inputValue();
  if (startShown !== data.answers.startDateUs) throw new Error(`start date read-back: ${startShown}`);
  if ((await start.getAttribute('aria-invalid')) !== 'false') throw new Error('start date flagged invalid');

  // Graduation date: calendar -> year view -> 2023 -> walk months to June -> day 30.
  const grad = page.locator('#graduation-date-picker');
  await grad.getByRole('button', { name: /^Choose date/ }).click();
  const dialog = page.locator('.MuiPickersPopper-root[role=dialog]');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'calendar view is open, switch to year view' }).click();
  await dialog.getByRole('radio', { name: '2023', exact: true }).click();
  const header = dialog.locator('.MuiPickersCalendarHeader-label');
  const target = 'June 2023';
  for (let i = 0; i < 12 && (await header.innerText()) !== target; i++) {
    const [month] = (await header.innerText()).split(' ');
    const idx = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(month);
    await dialog.getByRole('button', { name: idx > 5 ? 'Previous month' : 'Next month' }).click();
  }
  if ((await header.innerText()) !== target) throw new Error(`calendar stuck at ${await header.innerText()}`);
  await dialog.getByRole('gridcell', { name: '30', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const gradShown = await grad.getByRole('textbox').inputValue();
  if (gradShown !== '06/30/2023') throw new Error(`graduation read-back: ${gradShown}`);

  await Promise.all([page.waitForURL(/__confirm\/widget-mui-datepicker/), page.getByRole('button', { name: 'Submit application' }).click()]);
};
export default fill;
