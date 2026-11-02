import type { GoldenFill } from './types.ts';

/** Greenhouse classic: plain inputs, Select2 dropdowns, Places location, attach buttons, EEOC. */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('greenhouse-classic'));
  await page.fill('#first_name', data.firstName);
  await page.fill('#last_name', data.lastName);
  await page.fill('#email', data.email);
  await page.fill('#phone', data.phone);

  await page.locator('#job_application_location').pressSequentially('Laho', { delay: 30 });
  await page.locator('.pac-container .pac-item', { hasText: 'Lahore' }).first().dispatchEvent('mousedown');

  const [cvChooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#resume_fieldset [data-source=attach]')]);
  await cvChooser.setFiles(files.cv);
  const [clChooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#cover_letter_fieldset [data-source=attach]')]);
  await clChooser.setFiles(files.letter);

  await page.fill('#job_application_answers_attributes_0_text_value', String(data.linkedin));
  await page.fill('#job_application_answers_attributes_1_text_value', String(data.portfolio));

  const pick = async (selectId: string, option: string) => {
    await page.locator(`#s2id_${selectId} .select2-choice`).dispatchEvent('mousedown');
    const search = page.locator(`#s2id_${selectId} .select2-input`);
    await search.fill(option);
    await search.press('Enter');
  };
  await pick('job_application_answers_attributes_2_answer_selected_options_attributes_2_question_option_id', 'Job Board');
  await pick('job_application_answers_attributes_3_boolean_value', data.answers.needsSponsorship);
  await page.fill('#job_application_answers_attributes_4_text_value', text.whyUs);
  await page.fill('#job_application_answers_attributes_5_text_value', data.answers.salaryNumber);
  await pick('job_application_gender', 'Decline To Self Identify');
  await pick('job_application_hispanic_ethnicity', 'Decline To Self Identify');
  await pick('job_application_veteran_status', "I don't wish to answer");
  await pick('job_application_disability_status', 'I do not want to answer');

  await Promise.all([page.waitForURL(/__confirm\/greenhouse-classic/), page.click('#submit_app')]);
};
export default fill;
