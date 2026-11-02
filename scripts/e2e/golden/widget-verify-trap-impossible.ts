import type { GoldenFill } from './types.ts';

/**
 * Verify-trap, impossible variant (verify_blocked): fill everything, read the
 * required LinkedIn URL back after it settles, retry it two different ways
 * (fill + blur, typed + Tab), see the path stripped every time, and STOP:
 * the submit button is never pressed, so no wrong value goes out.
 */
const fill: GoldenFill = async (page, { fx, data }) => {
  await page.goto(fx.url('widget-verify-trap-impossible'));
  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);
  await page.getByLabel('Phone').fill(data.phone);

  const want = String(data.linkedin);
  const linkedin = page.getByLabel('LinkedIn profile URL');
  const attempts: string[] = [];

  await linkedin.fill(want);
  await linkedin.blur();
  await page.waitForTimeout(400);
  attempts.push(await linkedin.inputValue());

  await linkedin.fill('');
  await linkedin.pressSequentially(want, { delay: 5 });
  await linkedin.press('Tab'); // not Enter: Enter would implicitly submit the form
  await page.waitForTimeout(400);
  attempts.push(await linkedin.inputValue());

  if (attempts.some((got) => got === want)) throw new Error('the LinkedIn URL stuck: fixture no longer impossible');
  if (!attempts.every((got) => got === 'https://www.linkedin.com/')) throw new Error(`unexpected read-back: ${attempts.join(' | ')}`);

  // verify_blocked: do not submit. Nothing may have been sent.
  if (fx.submissions({ formId: 'widget-verify-trap-impossible' }).length) throw new Error('something was submitted');
};
export default fill;
