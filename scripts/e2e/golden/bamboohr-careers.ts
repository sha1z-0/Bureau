import type { GoldenFill } from './types.ts';

/** BambooHR careers: Apply button, fab-Select portal menus (country before state), date input, upload buttons. */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('bamboohr-careers'));
  await page.getByRole('button', { name: 'Apply for This Job' }).click();

  await page.getByLabel('First Name').fill(data.firstName);
  await page.getByLabel('Last Name').fill(data.lastName);
  await page.getByLabel('Email').fill(data.email);
  await page.getByLabel('Phone').fill(data.phone);
  await page.getByLabel('Street Address').fill(String(data.addressLine1));
  await page.getByLabel('City').fill(String(data.city));
  await page.getByLabel('Zip').fill(String(data.postalCode));

  // Country first: it drives the State/Province list.
  await page.locator('#country').click();
  await page.locator('.fab-MenuVessel .fab-MenuSearch__input').fill('Pak');
  await page.locator('.fab-MenuVessel [role=option]', { hasText: 'Pakistan' }).click();
  await page.locator('#state').click();
  await page.locator('.fab-MenuVessel [role=option]', { hasText: String(data.region) }).click();

  const upload = async (label: string, file: string) => {
    const box = page.locator('.FileUpload', { has: page.getByText(label, { exact: true }) });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), box.getByRole('button', { name: 'Upload File' }).click()]);
    await chooser.setFiles(file);
    await box.locator('.FileUpload__name').waitFor();
  };
  await upload('Resume', files.cv);
  await upload('Cover Letter', files.letter);

  await page.getByLabel('Date Available').fill(data.answers.startDateUs);
  await page.getByLabel('Desired Pay').fill(data.answers.salaryNumber);
  await page.getByLabel('Website, Blog, or Portfolio').fill(String(data.portfolio));
  await page.getByLabel('LinkedIn Profile URL').fill(String(data.linkedin));
  await page.locator('#customQuestions_1043').click();
  await page.locator('.fab-MenuVessel [role=option]', { hasText: data.answers.needsSponsorship }).click();
  await page.getByLabel(/bug you tracked down/).fill(text.project);

  await Promise.all([page.waitForURL(/__confirm\/bamboohr-careers/), page.getByRole('button', { name: 'Submit Application' }).click()]);
};
export default fill;
