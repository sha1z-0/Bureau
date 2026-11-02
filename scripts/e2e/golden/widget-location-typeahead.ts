import type { GoldenFill } from './types.ts';

/**
 * Location typeahead: free text is refused, so type a prefix, wait out the
 * debounce + request, and pick the suggestion with the keyboard. The golden
 * first shows the rejection (typed label, no pick) and then does it right.
 */
const fill: GoldenFill = async (page, { fx, data }) => {
  await page.goto(fx.url('widget-location-typeahead'));
  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);

  const loc = page.getByRole('combobox', { name: 'Where are you currently based?' });
  const error = page.locator('#location-error');

  // Typing the label without picking is rejected on blur.
  await loc.fill(String(data.location));
  await loc.press('Tab');
  if (!(await error.isVisible()) || (await loc.getAttribute('aria-invalid')) !== 'true') throw new Error('free text was not rejected');

  // Now the careful way: type a prefix, wait for suggestions, pick with the keyboard.
  await loc.fill('');
  await loc.pressSequentially('Laho', { delay: 40 });
  const option = page.getByRole('option', { name: 'Lahore, Punjab, Pakistan', exact: true });
  await option.waitFor();
  const options = await page.getByRole('option').allInnerTexts();
  const idx = options.findIndex((t) => t.replace(/\s+/g, ' ').trim() === 'Lahore Punjab, Pakistan');
  for (let i = 0; i <= idx; i++) await loc.press('ArrowDown');
  await loc.press('Enter');
  if ((await loc.inputValue()) !== data.location) throw new Error(`location read-back: ${await loc.inputValue()}`);
  await loc.press('Tab');
  if (await error.isVisible()) throw new Error('picked location still flagged');

  await Promise.all([page.waitForURL(/__confirm\/widget-location-typeahead/), page.getByRole('button', { name: 'Submit application' }).click()]);
};
export default fill;
