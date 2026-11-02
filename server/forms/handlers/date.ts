import { formatDate, parseDate, sameDate } from '../normalize.ts';
import { blur, type HandlerCtx, type HandlerResult, loc, readField, sel } from './common.ts';

/**
 * Dates: native date/month inputs (ISO), masked text fields (MUI DateField,
 * flatpickr, "MM/DD/YYYY" placeholders: a whole-date fill is parsed like a paste),
 * and segmented inputs (Workday month/day/year boxes, spinbutton sections).
 */
export async function fillDate(c: HandlerCtx): Promise<HandlerResult> {
  const fmt = c.field.meta?.format ?? 'MM/DD/YYYY';
  const p = parseDate(c.value, /^DD/i.test(fmt));
  if (!p) return { ok: false, readBack: '', note: `not a date: "${c.value}"` };

  const segs = c.field.meta?.segments;
  if (segs?.length) {
    for (let i = 0; i < segs.length; i++) {
      const part = segs[i];
      const v = part === 'MM' ? (p.m ? String(p.m).padStart(2, '0') : '') : part === 'DD' ? (p.d ? String(p.d).padStart(2, '0') : '') : String(p.y);
      if (!v) continue;
      const s = c.frame.locator(sel(`${c.field.id}:${i}`)).first();
      await s.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await s.click({ timeout: 3000 }).catch(() => {});
      const isInput = (await s.evaluate((e) => e.tagName).catch(() => '')) === 'INPUT';
      if (isInput) await s.fill('').catch(() => {});
      else {
        await c.page.keyboard.press('Backspace').catch(() => {});
      }
      await c.page.keyboard.type(v, { delay: 20 });
    }
    await c.page.keyboard.press('Tab').catch(() => {});
    const r = await readField(c.frame, c.field);
    const parts = r.value.split('|');
    const got: Record<string, string> = {};
    segs.forEach((s, i) => (got[s] = parts[i] ?? ''));
    const ok = Number(got.YYYY ?? p.y) === p.y && (!got.MM || !p.m || Number(got.MM) === p.m) && (!got.DD || !p.d || Number(got.DD) === p.d);
    return { ok, readBack: segs.map((s) => got[s]).join('/') };
  }

  const text = formatDate(p, fmt);
  const l = loc(c.frame, c.field.id);
  await l.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await l.click({ timeout: 3000 }).catch(() => {});
  await l.fill(text).catch(() => {});
  await c.page.keyboard.press('Escape').catch(() => {});
  await blur(c.frame, c.field.id);
  let r = await readField(c.frame, c.field);
  if (!sameDate(text, r.value, fmt)) {
    // Masked inputs that ignore fill: type digit by digit.
    await l.click({ timeout: 3000 }).catch(() => {});
    await c.page.keyboard.press('Control+A').catch(() => {});
    await c.page.keyboard.press('Backspace').catch(() => {});
    await c.page.keyboard.type(text.replace(/\D/g, ''), { delay: 30 });
    await c.page.keyboard.press('Escape').catch(() => {});
    await blur(c.frame, c.field.id);
    r = await readField(c.frame, c.field);
  }
  return { ok: sameDate(text, r.value, fmt), readBack: r.value, chosen: text };
}
