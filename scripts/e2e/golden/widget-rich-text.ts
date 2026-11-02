import type { GoldenFill } from './types.ts';

/**
 * Rich text: type the cover letter into the contenteditable editor paragraph by
 * paragraph (insertText + Enter, like a fast typist or IME), check the counter,
 * and add a short note in the Draft.js-like editor.
 */
const fill: GoldenFill = async (page, { fx, data, text }) => {
  await page.goto(fx.url('widget-rich-text'));
  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);

  const editor = page.getByRole('textbox', { name: /Cover letter/ });
  await editor.click();
  const paragraphs = text.coverLetter.split(/\n+/).filter((p) => p.trim());
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.insertText(paragraphs[i]);
  }
  const counter = (await page.locator('#cl_counter').innerText()).trim();
  const n = Number(counter.split('/')[0].trim());
  if (!(n > 1000 && n <= 3000)) throw new Error(`unexpected counter: ${counter}`);

  const extra = page.getByRole('textbox', { name: /Anything else/ });
  await extra.click();
  await page.keyboard.type('Available to start with two weeks of notice.');

  await Promise.all([page.waitForURL(/__confirm\/widget-rich-text/), page.getByRole('button', { name: 'Submit application' }).click()]);
};
export default fill;
