import { attemptSubmit, expectFrame, fillApplication } from './widget-captcha-shared.ts';
import type { GoldenFill } from './types.ts';

/**
 * Cloudflare Turnstile (needs_you): fill everything, wait out "Verifying...",
 * click "Verify you are human" (trusted), see the widget grow into a grid
 * challenge, do NOT solve it, try to submit and get "Please complete the CAPTCHA".
 */
const fill: GoldenFill = async (page, ctx) => {
  const title = 'Widget containing a Cloudflare security challenge';
  await page.goto(ctx.fx.url('widget-captcha-turnstile'));
  await fillApplication(page, ctx);

  await expectFrame(page, title, 'challenges.cloudflare.com', { w: 300, h: 65 });
  const widget = page.frameLocator(`iframe[title="${title}"]`);
  await widget.getByLabel('Verify you are human').click();
  await widget.getByText('Select every image with').waitFor();
  const box = await page.locator(`iframe[title="${title}"]`).boundingBox();
  if (!box || box.height < 400) throw new Error('Turnstile widget did not expand into its challenge');
  if (await widget.getByLabel('Verify you are human').isVisible()) throw new Error('checkbox still shown while the challenge is open');

  await attemptSubmit(page, ctx, 'widget-captcha-turnstile', 'input[name="cf-turnstile-response"]');
};
export default fill;
