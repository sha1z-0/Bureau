import type { GoldenFill } from './types.ts';

/**
 * Repeaters: fill the pre-rendered first block, add more with "Add another",
 * and remove a stray empty block (the rest re-index). Two positions (current
 * first) and one education entry.
 */
const fill: GoldenFill = async (page, { fx, data }) => {
  const d = data as Record<string, unknown>;
  const s = (k: string) => String(d[k]);
  await page.goto(fx.url('widget-repeating-sections'));

  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);

  const exp = page.locator('section[data-section=experience]');
  const entry = (i: number) => exp.locator('.entry').nth(i);

  // Position 1: the current job (pre-rendered block).
  const cur = entry(0);
  await cur.getByLabel('Company').fill(s('currentCompany'));
  await cur.getByLabel('Job title').fill(s('currentTitle'));
  await cur.getByLabel('Start month').selectOption(s('currentStartMonth'));
  await cur.getByLabel('Start year').selectOption(s('currentStartYear'));
  await cur.getByLabel('I currently work here').check();
  if (!(await cur.getByLabel('End month').isDisabled())) throw new Error('end date should be disabled for the current job');

  // Add two blocks, use the second, then remove the empty one in between:
  // the filled block re-indexes from experience[2] to experience[1].
  const add = exp.getByRole('button', { name: '+ Add another position' });
  await add.click();
  await add.click();
  const prev = entry(2);
  await prev.getByLabel('Company').fill(s('previousCompany'));
  await prev.getByLabel('Job title').fill(s('previousTitle'));
  await prev.getByLabel('Start month').selectOption(s('previousStartMonth'));
  await prev.getByLabel('Start year').selectOption(s('previousStartYear'));
  await prev.getByLabel('End month').selectOption(s('previousEndMonth'));
  await prev.getByLabel('End year').selectOption(s('previousEndYear'));
  await entry(1).getByRole('button', { name: 'Remove' }).click();
  const name = await entry(1).getByLabel('Company').getAttribute('name');
  if (name !== 'experience[1][company]') throw new Error(`re-index failed: ${name}`);
  if ((await entry(1).getByLabel('Company').inputValue()) !== s('previousCompany')) throw new Error('previous company lost on re-index');

  const edu = page.locator('section[data-section=education] .entry').first();
  await edu.getByLabel('School or university').fill(s('school'));
  await edu.getByLabel('Degree').selectOption({ label: s('degree') });
  await edu.getByLabel('Field of study').fill(s('fieldOfStudy'));
  await edu.getByLabel('Graduation year').selectOption(s('gradYear'));

  await Promise.all([page.waitForURL(/__confirm\/widget-repeating-sections/), page.getByRole('button', { name: 'Submit application' }).click()]);
};
export default fill;
