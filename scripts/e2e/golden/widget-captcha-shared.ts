import type { Page } from 'playwright-core';
import type { GoldenCtx } from './types.ts';

/**
 * Shared steps for the three CAPTCHA fixtures (widget-captcha-*). Not a golden
 * itself (no form has this id). The CAPTCHA pages expect `needs_you`: the
 * golden fills every field like a careful human, proves the challenge is
 * visible and blocks, attempts the submit, and checks that nothing valid was
 * sent. It never tries to solve the challenge.
 */
export async function fillApplication(page: Page, { data, files }: GoldenCtx): Promise<void> {
  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);
  await page.getByLabel('Phone').fill(data.phone);
  await page.getByLabel('LinkedIn profile').fill(String(data.linkedin));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByLabel('Resume/CV').click()]);
  await chooser.setFiles(files.cv);
}

export async function expectFrame(page: Page, title: string, srcPart: string, size?: { w: number; h: number }): Promise<void> {
  const frame = page.locator(`iframe[title="${title}"]`);
  await frame.waitFor({ state: 'visible' });
  const src = (await frame.getAttribute('src')) ?? '';
  if (!src.includes(srcPart)) throw new Error(`captcha iframe src ${src} lacks ${srcPart}`);
  if (size) {
    const box = await frame.boundingBox();
    if (!box || Math.round(box.width) !== size.w || Math.round(box.height) !== size.h) throw new Error(`captcha iframe is ${box?.width}x${box?.height}, expected ${size.w}x${size.h}`);
  }
}

/** Submit, then require the client-side CAPTCHA error and an empty token field. */
export async function attemptSubmit(page: Page, ctx: GoldenCtx, formId: string, tokenSelector: string): Promise<void> {
  const before = ctx.fx.submissions({ formId, final: true }).length;
  await page.getByRole('button', { name: 'Submit application' }).click();
  await page.getByText('Please complete the CAPTCHA').waitFor({ state: 'visible' });
  const token = await page.locator(tokenSelector).first().inputValue();
  if (token) throw new Error(`a CAPTCHA token was minted without a human: ${token}`);
  if (!page.url().includes(ctx.fx.form(formId).route)) throw new Error(`left the form page: ${page.url()}`);
  const valid = ctx.fx.submissions({ formId, final: true }).slice(before).filter((s) => s.valid);
  if (valid.length) throw new Error('a valid final submission was recorded despite the CAPTCHA');
}
