import type { GoldenFill } from './types.ts';

/**
 * react-select v5: open the control, type to filter, commit with Enter/click,
 * then read the committed value back from the rendered chip / single value
 * (the visible <input> is always empty after a commit).
 */
const fill: GoldenFill = async (page, { fx, data }) => {
  await page.goto(fx.url('widget-react-select'));
  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);

  // Country: ~230 options; type to filter, Enter commits the focused option.
  const country = page.locator('#country-field');
  await country.locator('.select__control').click();
  await page.keyboard.type('Pakis', { delay: 20 });
  await country.locator('.select__option--is-focused', { hasText: 'Pakistan' }).waitFor();
  await page.keyboard.press('Enter');
  const single = (await country.locator('.select__single-value').innerText()).trim();
  if (single !== 'Pakistan') throw new Error(`country read-back: ${single}`);

  // Skills: creatable multi. Two existing options, then create PostgreSQL.
  const skills = page.locator('#skills-field');
  await skills.locator('.select__control').click();
  for (const [typed, option] of [
    ['TypeScr', 'TypeScript'],
    ['Node', 'Node.js'],
    ['PostgreSQL', 'Create "PostgreSQL"'],
  ] as const) {
    await page.keyboard.type(typed, { delay: 20 });
    await skills.locator('.select__option--is-focused', { hasText: option }).waitFor();
    await page.keyboard.press('Enter');
  }
  const chips = await skills.locator('.select__multi-value__label').allInnerTexts();
  if (chips.join(',') !== 'TypeScript,Node.js,PostgreSQL') throw new Error(`skills read-back: ${chips.join(',')}`);

  // School: async options arrive after a 400 ms "Loading..." notice; click the result.
  const school = page.locator('#school-field');
  await school.locator('.select__control').click();
  await page.keyboard.type('Lahore Inst', { delay: 20 });
  await school.locator('.select__menu-notice--loading').waitFor({ state: 'detached' });
  await school.locator('.select__option', { hasText: data.school as string }).click();
  const schoolVal = (await school.locator('.select__single-value').innerText()).trim();
  if (schoolVal !== data.school) throw new Error(`school read-back: ${schoolVal}`);

  await Promise.all([page.waitForURL(/__confirm\/widget-react-select/), page.getByRole('button', { name: 'Submit application' }).click()]);
};
export default fill;
