import type { GoldenFill } from './types.ts';

/**
 * Employer page on origin A, form in an origin-B iframe, resume widget in a
 * nested iframe inside that. Everything goes through frameLocator; the thank-you
 * banner appears on the host page once the frame's confirmation posts back.
 */
const fill: GoldenFill = async (page, { fx, data, files }) => {
  await page.goto(fx.url('widget-cross-origin-iframe'));
  const app = page.frameLocator('iframe[title="Job application form"]');

  await app.getByLabel('First name').fill(data.firstName);
  await app.getByLabel('Last name').fill(data.lastName);
  await app.getByLabel('Email').fill(data.email);
  await app.getByLabel('Phone').fill(data.phone);
  await app.getByLabel('LinkedIn URL').fill(String(data.linkedin));

  const upload = app.frameLocator('iframe[title="Resume upload"]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), upload.getByRole('button', { name: 'Upload resume' }).click()]);
  await chooser.setFiles(files.cv);
  await app.getByText('Attached: Rania-Haroon-CV.pdf').waitFor();

  await app.getByLabel('Are you legally authorized to work in the United States?').selectOption({ label: data.answers.authorizedToWorkHere });

  await app.getByRole('button', { name: 'Submit Application' }).click();
  await page.getByText('Thanks for applying to Halcyon Freight').waitFor();
};
export default fill;
