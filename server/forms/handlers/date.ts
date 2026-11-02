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
  if (!sameDate(text, r.value, fmt)) {
    // Picker-only fields: open the calendar and click the day.
    if (await pickFromCalendar(c, p.y, p.m ?? 1, p.d ?? 1)) r = await readField(c.frame, c.field);
  }
  return { ok: sameDate(text, r.value, fmt) || sameDate(isoOf(p), r.value, fmt) || sameDate(`${MONTHS[(p.m ?? 1) - 1]} ${p.d ?? 1}, ${p.y}`, r.value), readBack: r.value, chosen: text };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoOf = (p: { y: number; m: number | null; d: number | null }) => `${p.y}-${String(p.m ?? 1).padStart(2, '0')}-${String(p.d ?? 1).padStart(2, '0')}`;

/** Drive a calendar popup: read its "Month YYYY" title, step with next/previous, click the day. */
async function pickFromCalendar(c: HandlerCtx, y: number, m: number, d: number): Promise<boolean> {
  const l = loc(c.frame, c.field.id);
  await l.click({ timeout: 2000 }).catch(() => {});
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const popup = c.frame.locator('[role="dialog"], .MuiPickersPopper-root, [class*="datepicker" i], [class*="calendar" i], [class*="dp-popup" i], .flatpickr-calendar.open').filter({ visible: true }).first();
  if (!(await popup.isVisible({ timeout: 1500 }).catch(() => false))) {
    const btn = l.locator('xpath=following::button[contains(translate(@aria-label,"CDAHOSE","cdahose"),"choose date") or contains(translate(@aria-label,"CALENDR","calendr"),"calendar")][1]');
    await btn.click({ timeout: 1500 }).catch(() => {});
    if (!(await popup.isVisible({ timeout: 1500 }).catch(() => false))) return false;
  }
  const dayLabel = `${MONTHS[m - 1]} ${d}, ${y}`;
  const ts = new Date(y, m - 1, d).getTime();
  for (let i = 0; i < 80; i++) {
    const day = popup.locator(`[data-date="${iso}"], [aria-label="${dayLabel}"], [aria-label^="${dayLabel}"], [data-timestamp="${ts}"], [data-day="${iso}"]`).first();
    if (await day.isVisible({ timeout: 100 }).catch(() => false)) {
      await day.click({ timeout: 2000 }).catch(() => {});
      await c.page.waitForTimeout(150);
      return true;
    }
    const title = (await popup.innerText().catch(() => '')).match(new RegExp(`(${MONTHS.join('|')})\\s+(\\d{4})`, 'i'));
    let forward = true;
    if (title) {
      const cur = Number(title[2]) * 12 + MONTHS.findIndex((x) => x.toLowerCase() === title[1].toLowerCase());
      const want = y * 12 + (m - 1);
      if (cur === want) {
        // Right month, no labelled cell: click the day number.
        const cell = popup.locator('[role="gridcell"], button, td').filter({ hasText: new RegExp(`^\\s*${d}\\s*$`) }).first();
        if (await cell.isVisible({ timeout: 200 }).catch(() => false)) {
          await cell.click({ timeout: 2000 }).catch(() => {});
          return true;
        }
        return false;
      }
      forward = want > cur;
    }
    const nav = popup.locator(forward ? '[aria-label*="next" i], .dp-next, .flatpickr-next-month, [class*="next" i]' : '[aria-label*="previous" i], [aria-label*="prev" i], .dp-prev, .flatpickr-prev-month, [class*="prev" i]').first();
    if (!(await nav.isVisible({ timeout: 200 }).catch(() => false))) return false;
    await nav.click({ timeout: 1500 }).catch(() => {});
  }
  return false;
}
