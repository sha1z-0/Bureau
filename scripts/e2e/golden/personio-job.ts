import type { GoldenFill } from './types.ts';

/** Personio: job page -> Apply -> DynamicForm; documents upload on add; submit enables once complete. */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('personio-job'));
  await Promise.all([page.waitForURL(/\/job\/1458822\/apply/), page.getByRole('link', { name: 'Apply for this job' }).first().click()]);

  await page.getByPlaceholder('First', { exact: true }).fill(data.firstName);
  await page.getByPlaceholder('Last', { exact: true }).fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);
  await page.getByLabel('Phone', { exact: true }).fill(data.phone);
  await page.getByLabel('Link to LinkedIn profile').fill(String(data.linkedin));
  await page.getByLabel('Expected salary').fill(data.answers.salaryNumber);
  await page.getByLabel('Available from').fill(data.answers.startDate);
  await page.getByLabel('How did you hear about us?').selectOption({ label: 'Job board' });
  await page.getByLabel(/work permit/).selectOption({ label: data.answers.needsSponsorship });
  await page.getByLabel('TypeScript').check();
  await page.getByLabel('Python').check();
  await page.getByLabel(/Why would you like to join Kranich/).fill(text.whyUs);

  const add = (cat: string) => page.locator(`.document-field-wrapper[data-category=${cat}] .add-file-button`);
  const [cv] = await Promise.all([page.waitForEvent('filechooser'), add('cv').click()]);
  await cv.setFiles(files.cv);
  const [cl] = await Promise.all([page.waitForEvent('filechooser'), add('cover_letter').click()]);
  await cl.setFiles(files.letter);
  await page.locator('.document-item', { hasText: 'Rania-Haroon-Cover-Letter.pdf' }).filter({ hasNotText: 'uploading' }).waitFor();

  await page.getByLabel(/data privacy statement/).check();
  const submit = page.getByRole('button', { name: 'Submit Application' });
  await submit.click(); // auto-waits until the button is enabled
  await page.getByText('Thank you for your application').waitFor();
};
export default fill;
