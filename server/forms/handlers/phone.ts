import { inFrame } from '../page.ts';
import { bestOption, valuesMatch } from '../normalize.ts';
import { DIAL_CODES, splitPhone } from '../candidate.ts';
import { bestOf, blur, clickOption, closeMenus, type HandlerCtx, type HandlerResult, loc, readField, waitOptions } from './common.ts';
import { fastMode } from '../human.ts';

/**
 * Phone numbers with a country picker (intl-tel-input, react-phone-number-input,
 * a dial-code <select>): set the country first, then type the national number.
 * Without a picker the full international number is typed as given.
 */
export async function fillPhone(c: HandlerCtx): Promise<HandlerResult> {
  const sp = splitPhone(c.value, '');
  const country = sp.country || Object.entries(DIAL_CODES).find(([, code]) => code === sp.cc)?.[0] || '';
  const l = loc(c.frame, c.field.id);
  const picker = c.frame.locator(`[data-bureau-cc="${c.field.id}"]`).first();
  let countrySet = false;
  if (c.field.meta?.cc === 'select') {
    const opts = await picker.evaluate((s) => Array.from((s as HTMLSelectElement).options).map((o, i) => ({ i, t: o.text, v: o.value }))).catch(() => [] as { i: number; t: string; v: string }[]);
    const byName = bestOption(country, opts.map((o) => o.t), 0.75);
    const hit = opts.find((o) => o.t === byName) ?? opts.find((o) => new RegExp(`\\+\\s?${sp.cc}\\b`).test(o.t)) ?? opts.find((o) => o.v.toLowerCase() === country.slice(0, 2).toLowerCase());
    if (hit) {
      await picker.selectOption({ index: hit.i }, { force: true }).catch(() => {});
      countrySet = true;
    }
  } else if (c.field.meta?.cc === 'button') {
    await picker.click({ timeout: 3000 }).catch(() => {});
    let opts = await waitOptions(c.frame, null, 1500);
    const searching = await c.frame.evaluate(() => document.activeElement?.tagName === 'INPUT').catch(() => false);
    if (searching && country) {
      await c.page.keyboard.type(country, { delay: fastMode() ? 0 : 25 });
      opts = await waitOptions(c.frame, null, 1500);
    }
    const hit = bestOf(country, opts, 0.7) ?? opts.find((o) => new RegExp(`\\+\\s?${sp.cc}(\\D|$)`).test(o.text)) ?? null;
    if (hit) {
      await clickOption(c.frame, hit);
      countrySet = true;
    } else await closeMenus(c.page);
  }
  const text = countrySet ? sp.national : c.value;
  await l.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await l.click({ timeout: 3000 }).catch(() => {});
  await l.fill('').catch(() => {});
  await l.pressSequentially(text, { delay: fastMode() ? 0 : 30 });
  await blur(c.frame, c.field.id);
  let r = await readField(c.frame, c.field);
  if (!valuesMatch('phone', c.value, r.value) && countrySet) {
    // Some pickers want the number with its dial code.
    await l.fill('').catch(() => {});
    await l.pressSequentially(c.value, { delay: fastMode() ? 0 : 30 });
    await blur(c.frame, c.field.id);
    r = await readField(c.frame, c.field);
  }
  const ccOk = !c.field.meta?.cc || !country || !r.display || new RegExp(`${country}|\\+\\s?${sp.cc}\\b|\\b${country.slice(0, 2)}\\b`, 'i').test(r.display);
  void inFrame;
  return { ok: valuesMatch('phone', c.value, r.value) && ccOk, readBack: r.value, display: r.display, note: ccOk ? undefined : `country shows "${r.display}"` };
}
