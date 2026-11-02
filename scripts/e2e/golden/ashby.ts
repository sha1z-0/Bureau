import fs from 'node:fs';
import path from 'node:path';
import type { GoldenFill } from './types.ts';

const PHONE = '9a2b7c4d-3e5f-4061-8b7a-c9d0e1f2a3b4';
const LINKEDIN = '3d4e5f60-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
const GITHUB = '4e5f6071-8b9c-4dae-9f10-2b3c4d5e6f70';
const COVER = '5f607182-9cad-4ebf-8021-3c4d5e6f7081';
const SPONSOR = 'a1c3e5f7-0b2d-4f6a-8c1e-3a5c7e9b1d2f';
const PREVIOUS = 'b2d4f6a8-1c3e-4a7b-9d2f-4b6d8f0c2e3a';
const TECH = 'c3e5a7b9-2d4f-4b8c-ae30-5c7e9a1d3f4b';
const HEARD = 'd4f6b8ca-3e5a-4c9d-bf41-6d8f0b2e4a5c';
const WHY = 'e5a7c9db-4f6b-4dae-8c52-7e9a1c3f5b6d';

/** Ashby: async-rendered SPA, path-keyed fields, drop zones, Yes/No toggles, checkbox/radio groups, comboboxes, JSON submit. */
const fill: GoldenFill = async (page, { fx, data, files, text }) => {
  await page.goto(fx.url('ashby'));
  await page.locator('#_systemfield_name').waitFor(); // form renders after the definition "loads"

  await page.locator('#_systemfield_name').fill(data.fullName);
  await page.locator('#_systemfield_email').fill(data.email);
  await page.locator(`[id="${PHONE}"]`).fill(data.phone);

  const loc = page.locator('#_systemfield_location');
  await loc.pressSequentially('Lahore', { delay: 30 });
  await page.locator('#_systemfield_location-listbox [role=option]', { hasText: 'Lahore, Punjab, Pakistan' }).first().waitFor();
  await page.locator('#_systemfield_location-listbox [role=option]', { hasText: 'Lahore, Punjab, Pakistan' }).first().click();

  const [cv] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-field-path=_systemfield_resume] button', { hasText: 'Upload File' }).click()]);
  await cv.setFiles(files.cv);
  await page.locator('[data-field-path=_systemfield_resume] ._fileName_1y4ge_20').waitFor();

  await page.locator(`[id="${LINKEDIN}"]`).fill(String(data.linkedin));
  await page.locator(`[id="${GITHUB}"]`).fill(String(data.github));

  // Cover letter by drag and drop onto the zone.
  const bytes = fs.readFileSync(files.letter).toString('base64');
  const dt = await page.evaluateHandle(
    ({ b64, name }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const d = new DataTransfer();
      d.items.add(new File([buf], name, { type: 'application/pdf' }));
      return d;
    },
    { b64: bytes, name: path.basename(files.letter) },
  );
  const zone = page.locator(`[data-field-path="${COVER}"] ._dropzone_1y4ge_1`);
  await zone.dispatchEvent('dragenter', { dataTransfer: dt });
  await zone.dispatchEvent('dragover', { dataTransfer: dt });
  await zone.dispatchEvent('drop', { dataTransfer: dt });
  await page.locator(`[data-field-path="${COVER}"] ._fileName_1y4ge_20`).waitFor();

  await page.locator(`[data-field-path="${SPONSOR}"] button`, { hasText: data.answers.needsSponsorship }).click();
  await page.locator(`[data-field-path="${PREVIOUS}"] button`, { hasText: data.answers.previouslyEmployed }).click();
  for (const tech of ['TypeScript', 'Node.js', 'React', 'PostgreSQL']) await page.locator(`[data-field-path="${TECH}"] label`, { hasText: tech }).click();
  await page.locator(`[data-field-path="${HEARD}"] label`, { hasText: 'Job board' }).click();
  await page.locator(`[id="${WHY}"]`).fill(text.whyUs);

  const eeo = async (path: string, label: string) => {
    await page.locator(`#${path}`).click();
    await page.locator(`#${path}-listbox [role=option]`, { hasText: label }).click();
  };
  await eeo('_systemfield_eeoc_gender', 'Decline to self-identify');
  await eeo('_systemfield_eeoc_race', 'Decline to self-identify');
  // Keyboard path on the last one: type to filter, Enter picks the focused option.
  const vet = page.locator('#_systemfield_eeoc_veteran_status');
  await vet.focus();
  await vet.pressSequentially('decline', { delay: 20 });
  await vet.press('Enter');

  await page.locator('.ashby-application-form-submit-button').click();
  await page.locator('.ashby-application-form-success-container', { hasText: 'Thank you for applying' }).waitFor();
  await page.waitForURL(/__confirm\/ashby/);
};
export default fill;
