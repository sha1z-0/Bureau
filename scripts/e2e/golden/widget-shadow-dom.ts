import type { GoldenFill } from './types.ts';

/**
 * Web components: open shadow roots (locators pierce them), nested shadow roots,
 * a form-associated element, a slot-projected label, a CLOSED shadow root (click
 * the host, focus is delegated, then type) and a custom checkbox.
 */
const fill: GoldenFill = async (page, { fx, data, files }) => {
  await page.goto(fx.url('widget-shadow-dom'));

  // Open shadow roots: getByLabel resolves the shadow <label for>.
  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);

  // Nested: fx-contact-card > shadow > fx-text-field > shadow > input.
  await page.locator('fx-contact-card fx-text-field[name=email] input').fill(data.email);
  await page.locator('fx-contact-card fx-text-field[name=phone] input').fill(data.phone);

  await page.getByLabel('Preferred name').fill(String(data.preferredName));

  // Slot-projected label.
  await page.getByRole('textbox', { name: 'LinkedIn profile' }).fill(String(data.linkedin));

  // Closed shadow root: no locator can reach the input. Click the host (focus is
  // delegated to the inner input), then type like a person would.
  await page.locator('fx-secure-field').click();
  await page.keyboard.type(String(data.yearsExperience));

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#resume').click()]);
  await chooser.setFiles(files.cv);

  const consent = page.getByRole('checkbox', { name: /privacy notice/ });
  await consent.focus();
  await page.keyboard.press('Space');
  if ((await consent.getAttribute('aria-checked')) !== 'true') throw new Error('consent checkbox did not toggle');

  await Promise.all([page.waitForURL(/__confirm\/widget-shadow-dom/), page.getByRole('button', { name: 'Submit application' }).click()]);
};
export default fill;
