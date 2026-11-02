import { attemptSubmit, expectFrame, fillApplication } from './widget-captcha-shared.ts';
import type { GoldenFill } from './types.ts';

/**
 * hCaptcha checkbox (needs_you): fill everything, click "I am human" (trusted),
 * see the challenge frame appear, do NOT solve it, dismiss it, try to submit and
 * get "Please complete the CAPTCHA" with nothing valid sent.
 */
const fill: GoldenFill = async (page, ctx) => {
  const checkboxTitle = 'Widget containing checkbox for hCaptcha security challenge';
  const challengeTitle = 'Main content of the hCaptcha challenge';
  await page.goto(ctx.fx.url('widget-captcha-hcaptcha'));
  await fillApplication(page, ctx);

  await expectFrame(page, checkboxTitle, 'hcaptcha.com', { w: 303, h: 78 });
  const anchor = page.frameLocator(`iframe[title="${checkboxTitle}"]`);
  await anchor.getByRole('checkbox').click();

  await expectFrame(page, challengeTitle, 'frame=challenge');
  await page.frameLocator(`iframe[title="${challengeTitle}"]`).getByText('Please click each image containing').waitFor();
  if ((await anchor.getByRole('checkbox').getAttribute('aria-checked')) === 'true') throw new Error('checkbox ticked without a solved challenge');

  await page.mouse.click(10, 10);
  await page.locator(`iframe[title="${challengeTitle}"]`).waitFor({ state: 'hidden' });
  await attemptSubmit(page, ctx, 'widget-captcha-hcaptcha', 'textarea[name="h-captcha-response"]');
};
export default fill;
