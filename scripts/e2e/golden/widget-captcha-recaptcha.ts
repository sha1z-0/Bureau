import { attemptSubmit, expectFrame, fillApplication } from './widget-captcha-shared.ts';
import type { GoldenFill } from './types.ts';

/**
 * reCAPTCHA v2 checkbox (needs_you): fill everything, click "I'm not a robot"
 * (a trusted click), see the image challenge appear, do NOT solve it, dismiss
 * it, try to submit and get "Please complete the CAPTCHA" with nothing valid sent.
 */
const fill: GoldenFill = async (page, ctx) => {
  await page.goto(ctx.fx.url('widget-captcha-recaptcha'));
  await fillApplication(page, ctx);

  await expectFrame(page, 'reCAPTCHA', 'recaptcha/api2/anchor', { w: 304, h: 78 });
  const anchor = page.frameLocator('iframe[title="reCAPTCHA"]');
  await anchor.getByRole('checkbox', { name: "I'm not a robot" }).click();

  // The click is trusted, but it only opens the image grid; no token yet.
  await expectFrame(page, 'recaptcha challenge expires in two minutes', 'recaptcha/api2/bframe');
  const bframe = page.frameLocator('iframe[title="recaptcha challenge expires in two minutes"]');
  await bframe.getByText('Select all images with').waitFor();
  if ((await anchor.locator('#recaptcha-anchor').getAttribute('aria-checked')) === 'true') throw new Error('checkbox ticked without a solved challenge');

  // Stop here, as the form engine must (needs_you). Dismiss the popup like a person clicking away.
  await page.mouse.click(10, 10);
  await page.locator('iframe[title="recaptcha challenge expires in two minutes"]').waitFor({ state: 'hidden' });
  await attemptSubmit(page, ctx, 'widget-captcha-recaptcha', '#g-recaptcha-response');
};
export default fill;
