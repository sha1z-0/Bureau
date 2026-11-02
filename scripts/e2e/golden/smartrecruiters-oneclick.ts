import type { GoldenFill } from './types.ts';

/**
 * SmartRecruiters OneClick: spl-* web components with open shadow roots.
 * Playwright CSS locators pierce open shadow DOM, so `#first-name-input input`
 * reaches the <input> inside <spl-input id="first-name-input">'s shadow tree.
 */
const Q = (n: number) => `#question-5f3c9a1e-7d2b-4c61-9a0e-2b8f6d4e1a0${n}`;

const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('smartrecruiters-oneclick'));

  await page.locator('#first-name-input input').fill(data.firstName);
  await page.locator('#last-name-input input').fill(data.lastName);
  await page.locator('#email-input input').fill(data.email);
  await page.locator('#confirm-email-input input').fill(data.email);

  const loc = page.locator('#location-autocomplete-input input');
  await loc.click();
  await loc.pressSequentially('Laho', { delay: 40 });
  await page.locator('#location-autocomplete-input [role=option]', { hasText: 'Lahore, Punjab, Pakistan' }).first().click();

  await page.locator('#phone-number-input input[type=tel]').fill(data.phone);

  // Experience: Add -> inline form -> Save
  await page.locator('[data-test=add-experience]').click();
  await page.locator('[data-test=job-title-autocomplete] input').fill(String(data.currentTitle));
  await page.locator('[data-test=company-autocomplete] input').fill(String(data.currentCompany));
  await page.locator('[data-test=experience-description] textarea').fill('Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL).');
  await page.locator('[data-test=experience-current] input[type=checkbox]').check();
  await page.locator('[data-test=experience-date-from] input').fill(`${data.currentStartMonth}/${data.currentStartYear}`);
  await page.locator('[data-test=experience-save]').click();
  await page.locator('[data-test=experience-entry]').first().waitFor();

  // Education
  await page.locator('[data-test=add-education]').click();
  await page.locator('[data-test=institution-autocomplete] input').fill(String(data.school));
  await page.locator('[data-test=education-major] input').fill(String(data.fieldOfStudy));
  await page.locator('[data-test=education-degree] input').fill(String(data.degree));
  await page.locator('[data-test=education-date-from] input').fill('09/2019');
  await page.locator('[data-test=education-date-to] input').fill(`${data.gradMonth}/${data.gradYear}`);
  await page.locator('[data-test=education-save]').click();
  await page.locator('[data-test=education-entry]').first().waitFor();

  // Resume dropzone: the "Choose a file" label opens the shadow-DOM file input
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('spl-dropzone[data-test=resume-upload] .c-spl-dropzone-label-browse').click(),
  ]);
  await chooser.setFiles(files.cv);
  await page.locator('spl-dropzone[data-test=resume-upload] .c-spl-file-list-item-name', { hasText: 'Rania-Haroon-CV.pdf' }).waitFor();

  await page.locator('#linkedin-input input').fill(String(data.linkedin));
  await page.locator('#website-input input').fill(String(data.portfolio));
  await page.locator('#hiring-manager-message-input textarea').fill(text.whyUs);

  await page.locator('[data-test=footer-next]').click();
  await page.waitForURL(/\/screening$/);

  // Preliminary questions
  await page.locator(`${Q(1)} button[role=combobox]`).click();
  await page.locator(`${Q(1)} [role=option]`, { hasText: 'Job board' }).click();
  await page.locator(`${Q(2)} spl-radio[label="${data.answers.needsSponsorship}"]`).click();
  await page.locator(`${Q(3)} spl-radio[label="${data.answers.over18}"]`).click();
  await page.locator(`${Q(4)} input`).fill(data.answers.salaryNumber);
  await page.locator(`${Q(5)} textarea`).fill(text.whyUs);
  await page.locator('#consent-privacy-policy input[type=checkbox]').check();

  await Promise.all([page.waitForURL(/__confirm\/smartrecruiters-oneclick/), page.locator('[data-test=footer-submit]').click()]);
};
export default fill;
