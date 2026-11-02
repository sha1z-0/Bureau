import type { Locator } from 'playwright-core';
import type { GoldenFill } from './types.ts';

interface Scope {
  locator(selector: string, options?: { hasText?: string | RegExp }): Locator;
}

const exact = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

async function pick(scope: Scope, id: string, label: string, typed = '') {
  await scope.locator(`.select__control:has(#${id})`).click();
  if (typed) await scope.locator(`#${id}`).pressSequentially(typed, { delay: 20 });
  await scope.locator(`#react-select-${id}-listbox .select__option`, { hasText: exact(label) }).click();
}

/**
 * Greenhouse embed: the careers page (origin A) hosts #grnhse_iframe from origin B.
 * Everything is filled inside the cross-origin frame; the confirmation renders there too.
 */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('greenhouse-embed'));
  const iframe = page.locator('#grnhse_iframe');
  await iframe.waitFor();
  // The loader sizes the frame from the frame's postMessage; wait until it has grown.
  await page.waitForFunction(() => Number(document.getElementById('grnhse_iframe')?.getAttribute('height') ?? 0) > 1000);
  const frame = page.frameLocator('#grnhse_iframe');

  await frame.locator('#first_name').fill(data.firstName);
  await frame.locator('#last_name').fill(data.lastName);
  await frame.locator('#email').fill(data.email);
  await pick(frame, 'country', 'Pakistan +92', 'Pak');
  await frame.locator('#phone').fill(String(data.phoneNational));

  const [cv] = await Promise.all([page.waitForEvent('filechooser'), frame.locator('[aria-labelledby="upload-label-resume"] button', { hasText: 'Attach' }).click()]);
  await cv.setFiles(files.cv);
  const [cl] = await Promise.all([page.waitForEvent('filechooser'), frame.locator('[aria-labelledby="upload-label-cover_letter"] button', { hasText: 'Attach' }).click()]);
  await cl.setFiles(files.letter);

  await frame.locator('#question_52990417008').fill(String(data.linkedin));
  await frame.locator('#question_52990418008').fill(String(data.portfolio));
  await pick(frame, 'question_52990419008', data.answers.over18);
  await pick(frame, 'question_52990420008', data.answers.needsSponsorship);
  // Keyboard: open with ArrowDown, filter, Tab selects the focused option (react-select tabSelectsValue).
  const tz = frame.locator('#question_52990421008');
  await tz.focus();
  await tz.press('ArrowDown');
  await tz.pressSequentially('Pakistan', { delay: 20 });
  await tz.press('Tab');
  await frame.locator('#question_52990422008').fill(data.answers.salaryExpectation);
  await frame.locator('#question_52990423008').fill(text.project);

  await pick(frame, 'gender', 'Decline To Self Identify');
  await pick(frame, 'hispanic_ethnicity', 'Decline To Self Identify');
  await pick(frame, 'veteran_status', "I don't wish to answer");
  await pick(frame, 'disability_status', 'I do not want to answer');

  await frame.locator('#application-form button[type=submit]', { hasText: 'Submit application' }).click();
  await frame.locator('.confirmation h1', { hasText: 'Thank you for applying' }).waitFor();

  // The runner reads the top document's text, which does not include the frame's.
  // Having confirmed inside the frame, open the frame's document on its own.
  const confirmed = page.frames().find((f) => f.url().includes('/embed/job_app/confirmation'));
  if (!confirmed) throw new Error('confirmation did not load inside #grnhse_iframe');
  await page.goto(confirmed.url());
};
export default fill;
