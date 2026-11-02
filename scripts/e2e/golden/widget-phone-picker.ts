import type { GoldenFill } from './types.ts';

/**
 * Phone pickers: switch intl-tel-input from United States to Pakistan via its
 * searchable dropdown, type the national number, and set the
 * react-phone-number-input country through its (transparent) native select.
 * The hidden E.164 fields are only written on submit, so verify the visible state.
 */
const fill: GoldenFill = async (page, { fx, data }) => {
  await page.goto(fx.url('widget-phone-picker'));
  await page.getByLabel('First name').fill(data.firstName);
  await page.getByLabel('Last name').fill(data.lastName);
  await page.getByLabel('Email address').fill(data.email);

  const national = String(data.phoneNational); // 3015550142

  // intl-tel-input: open the country dropdown, search, pick Pakistan.
  const iti = page.locator('#phone-field .iti');
  const selected = iti.getByRole('combobox', { name: /^Selected country/ });
  await selected.click();
  const search = iti.locator('.iti__search-input');
  await search.waitFor();
  await search.pressSequentially('Pakis', { delay: 30 });
  await iti.locator('li.iti__country.iti__highlight[data-country-code=pk]').waitFor();
  await search.press('Enter');
  if ((await selected.getAttribute('title')) !== 'Pakistan: +92') throw new Error(`iti country: ${await selected.getAttribute('title')}`);
  if ((await iti.locator('.iti__selected-dial-code').innerText()).trim() !== '+92') throw new Error('iti dial code not +92');
  const phone = page.getByLabel('Mobile phone');
  await phone.pressSequentially(national, { delay: 20 });
  const shown = (await phone.inputValue()).replace(/\D/g, '');
  if (shown !== national) throw new Error(`iti read-back: ${await phone.inputValue()}`);

  // react-phone-number-input: the flag is a transparent native <select>.
  await page.getByRole('combobox', { name: 'Phone number country' }).selectOption({ label: String(data.phoneCountry) });
  const wa = page.locator('#whatsapp-input');
  await wa.pressSequentially(national, { delay: 20 });
  if ((await wa.inputValue()).replace(/\D/g, '') !== national) throw new Error(`whatsapp read-back: ${await wa.inputValue()}`);
  if ((await page.locator('.PhoneInputCountryIcon').innerText()).trim() !== 'PK') throw new Error('whatsapp country not PK');

  await Promise.all([page.waitForURL(/__confirm\/widget-phone-picker/), page.getByRole('button', { name: 'Send application' }).click()]);
};
export default fill;
