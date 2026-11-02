import type { GoldenFill } from './types.ts';

/** Breezy portal: placeholder-only fields, resume pre-upload, Places address, 3-section wizard. */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('breezy-portal'));
  // Wait for translate.breezy.js to replace the %TOKENS%.
  await page.getByPlaceholder('Full Name').waitFor();

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#upload-resume-btn').click()]);
  await chooser.setFiles(files.cv);
  await page.locator('#resume-attached a', { hasText: 'Rania-Haroon-CV.pdf' }).waitFor();

  await page.getByPlaceholder('Full Name').fill(data.fullName);
  await page.getByPlaceholder('Email Address').fill(data.email);
  await page.getByPlaceholder('Phone Number').fill(data.phone);
  await page.locator('#fullAddress').pressSequentially('Laho', { delay: 30 });
  await page.locator('.pac-container .pac-item', { hasText: 'Lahore' }).first().dispatchEvent('mousedown');
  await page.getByPlaceholder('Desired Salary').fill(data.answers.salaryNumber);

  await page.locator('#add-position').click();
  const pos = page.locator('#work-history > li').first();
  await pos.getByPlaceholder('Company').fill(String(data.currentCompany));
  await pos.getByPlaceholder('Title').fill(String(data.currentTitle));
  await pos.locator('[data-k=date_start]').fill(`${data.currentStartYear}-${data.currentStartMonth}-01`);
  await page.locator('#add-education').click();
  const edu = page.locator('#education > li').first();
  await edu.getByPlaceholder('School').fill(String(data.school));
  await edu.getByPlaceholder('Field of Study').fill(String(data.fieldOfStudy));
  await page.locator('textarea[name=cCoverLetter]').fill(text.coverLetter);
  await page.getByRole('button', { name: 'Next' }).click();

  const q = (id: string) => page.locator(`.question[data-question-id=${id}]`);
  await q('q1f04a7c').getByLabel(data.answers.needsSponsorship).check();
  for (const opt of ['Python', 'SQL', 'TypeScript']) await q('q2b93e10').getByLabel(opt, { exact: true }).check();
  await q('q3c5d822').locator('input').fill(data.answers.noticePeriod);
  await q('q4e7a019').locator('textarea').fill(text.project);
  await q('q5a1b6f3').locator('select').selectOption({ label: 'Job board' });
  await page.getByRole('button', { name: 'Next' }).click();

  await page.locator('input[name=gdprAgreement]').check();
  await Promise.all([page.waitForURL(/\/apply\/submitted$/), page.getByRole('button', { name: 'Submit Application' }).click()]);
};
export default fill;
