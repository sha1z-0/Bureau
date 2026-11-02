import type { GoldenFill } from './types.ts';

/** Workable: phone country dropdown, Education/Experience sub-forms, drop zone, custom listbox, XHR submit. */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('workable'));
  await page.locator('#firstname').fill(data.firstName);
  await page.locator('#lastname').fill(data.lastName);
  await page.locator('#email').fill(data.email);
  await page.locator('#headline').fill(`${String(data.currentTitle)} at ${String(data.currentCompany)}`);

  // The country defaults to United States: switch it before typing the local number.
  await page.locator('[data-ui=phone-country]').click();
  await page.locator('.styles--country-search').pressSequentially('Pakis', { delay: 20 });
  await page.locator('.styles--country-search').press('Enter');
  await page.locator('#phone').fill(String(data.phoneLocal));
  await page.locator('#address').fill(`${String(data.addressLine1)}, ${String(data.city)} ${String(data.postalCode)}, ${String(data.country)}`);

  const edu = page.locator('[data-ui=education]');
  await edu.locator('[data-ui=add-section]').click();
  await page.locator('#education-school').fill(String(data.school));
  await page.locator('#education-field_of_study').fill(String(data.fieldOfStudy));
  await page.locator('#education-degree').fill(String(data.degree));
  await page.locator('#education-start_date').pressSequentially('092019', { delay: 10 });
  await page.locator('#education-end_date').pressSequentially(`${String(data.gradMonth)}${String(data.gradYear)}`, { delay: 10 });
  await edu.locator('[data-ui=save-section]').click();
  await edu.locator('[data-ui=education-entry]').waitFor();

  const exp = page.locator('[data-ui=experience]');
  await exp.locator('[data-ui=add-section]').click();
  await page.locator('#experience-title').fill(String(data.currentTitle));
  await page.locator('#experience-company').fill(String(data.currentCompany));
  await page.locator('#experience-industry').fill('Software');
  await page.locator('#experience-summary').fill('Build and maintain the invoicing service (Node.js, TypeScript, PostgreSQL); cut the nightly reconciliation job from 41 to 6 minutes.');
  await page.locator('#experience-start_date').pressSequentially(`${String(data.currentStartMonth)}${String(data.currentStartYear)}`, { delay: 10 });
  await page.locator('#experience-current').check();
  await exp.locator('[data-ui=save-section]').click();
  await exp.locator('[data-ui=experience-entry]').waitFor();

  await page.locator('#summary').fill(text.project);
  const [cv] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-ui=resume-dropzone]').click()]);
  await cv.setFiles(files.cv);
  await page.locator('[data-ui=resume-filename]', { hasText: 'Rania-Haroon-CV.pdf' }).waitFor();

  await page.locator('#cover_letter').fill(text.coverLetter);
  await page.locator('#CA_18811').click();
  await page.locator('#CA_18811-listbox [role=option]', { hasText: '2 weeks' }).click();
  await page.locator('[data-ui=QA_9102341] label', { hasText: data.answers.authorizedToWorkPakistan }).click();
  await page.locator('#QA_9102342').fill(text.project);
  await page.locator('#gdpr').check();

  await page.locator('[data-ui=apply-button]').click();
  await page.locator('[data-ui=application-success]', { hasText: 'Your application was submitted' }).waitFor();
  await page.waitForURL(/__confirm\/workable/);
};
export default fill;
