import type { Locator } from 'playwright-core';
import type { GoldenFill } from './types.ts';

interface Scope {
  locator(selector: string, options?: { hasText?: string | RegExp }): Locator;
}

const exact = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** Open a react-select by clicking its control, narrow it by typing, click the option. */
async function pick(scope: Scope, id: string, label: string, typed = '') {
  await scope.locator(`.select__control:has(#${id})`).click();
  if (typed) await scope.locator(`#${id}`).pressSequentially(typed, { delay: 20 });
  await scope.locator(`#react-select-${id}-listbox .select__option`, { hasText: exact(label) }).click();
}

/** Keyboard path: focus the combobox, type to filter, Enter selects the focused option. */
async function pickByKeyboard(scope: Scope, id: string, typed: string) {
  const input = scope.locator(`#${id}`);
  await input.focus();
  await input.pressSequentially(typed, { delay: 20 });
  await scope.locator(`#react-select-${id}-listbox .select__option--is-focused`).waitFor();
  await input.press('Enter');
}

/** Greenhouse job-boards (React): react-select dropdowns, phone country, async location, Attach uploads, EEOC. */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('greenhouse-jobboards'));
  await page.locator('#first_name').fill(data.firstName);
  await page.locator('#last_name').fill(data.lastName);
  await page.locator('#preferred_name').fill(String(data.preferredName));
  await page.locator('#email').fill(data.email);

  await pickByKeyboard(page, 'country', 'Pakis');
  await page.locator('#phone').fill(String(data.phoneNational));

  await page.locator('.select__control:has(#candidate-location)').click();
  await page.locator('#candidate-location').pressSequentially('Laho', { delay: 30 });
  await page.locator('#react-select-candidate-location-listbox .select__option', { hasText: 'Lahore, Punjab, Pakistan' }).click();

  const [cv] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[aria-labelledby="upload-label-resume"] button', { hasText: 'Attach' }).click()]);
  await cv.setFiles(files.cv);
  const [cl] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[aria-labelledby="upload-label-cover_letter"] button', { hasText: 'Attach' }).click()]);
  await cl.setFiles(files.letter);

  await page.locator('#question_41208813002').fill(String(data.linkedin));
  await page.locator('#question_41208814002').fill(String(data.github));
  // Inflated posting: answer the truth (2 years), not the 5+ it asks for.
  await pick(page, 'question_41208815002', '1-2 years');
  for (const tech of ['TypeScript', 'Node.js', 'PostgreSQL', 'Docker']) await pick(page, 'question_41208816002', tech);
  await pick(page, 'question_41208817002', data.answers.needsSponsorship);
  await page.locator('#question_41208818002').fill(text.whyUs);
  await pickByKeyboard(page, 'question_41208819002', 'Job board');
  await pick(page, 'question_41208820002', data.answers.previouslyEmployed);

  await pick(page, 'gender', 'Decline To Self Identify');
  await pick(page, 'hispanic_ethnicity', 'Decline To Self Identify');
  await pick(page, 'veteran_status', "I don't wish to answer");
  await pick(page, 'disability_status', 'I do not want to answer');

  await page.locator('#application-form button[type=submit]', { hasText: 'Submit application' }).click();
  await page.locator('.confirmation h1', { hasText: 'Thank you for applying' }).waitFor();
};
export default fill;
