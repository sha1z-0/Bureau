import { inFrame } from '../page.ts';
import { bestOption, truthy, valuesMatch } from '../normalize.ts';
import { type HandlerCtx, type HandlerResult, loc, readField, sel } from './common.ts';

/** Native <select>: pick the best option by text, read the selected text back. */
export async function fillSelect(c: HandlerCtx): Promise<HandlerResult> {
  const opts = await inFrame<{ index: number; text: string; value: string; placeholder: boolean; disabled: boolean }[]>(c.frame, 'selectOptions', { id: c.field.id });
  const usable = opts.filter((o) => !o.placeholder && !o.disabled);
  const wanted = c.value.split(/\s*;\s*/).filter(Boolean);
  const picks: number[] = [];
  for (const w of wanted.length ? wanted : [c.value]) {
    const text = bestOption(w, usable.map((o) => o.text), 0.7) ?? usable.find((o) => o.value === w)?.text ?? null;
    const hit = usable.find((o) => o.text === text);
    if (hit) picks.push(hit.index);
  }
  if (!picks.length) return { ok: false, readBack: '', note: `no option matches "${c.value}"` };
  const l = loc(c.frame, c.field.id);
  await l.selectOption(picks.map((index) => ({ index })), { force: true, timeout: 5000 });
  const r = await readField(c.frame, c.field);
  const chosen = picks.map((i) => opts.find((o) => o.index === i)!.text).join('; ');
  return { ok: valuesMatch('select', chosen, r.value), readBack: r.value, chosen };
}

/** Radio groups (native, role=radio, aria-pressed toggles). */
export async function fillRadio(c: HandlerCtx): Promise<HandlerResult> {
  const options = c.field.options ?? [];
  const text = bestOption(c.value, options, 0.7);
  if (!text) return { ok: false, readBack: '', note: `no option matches "${c.value}"` };
  const idx = options.indexOf(text);
  const member = c.frame.locator(sel(`${c.field.id}:${idx}`)).first();
  await member.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  const tag = await member.evaluate((e) => e.tagName + '|' + ((e as HTMLInputElement).type || '')).catch(() => '');
  if (/^INPUT\|radio/i.test(String(tag))) {
    await member.check({ force: true, timeout: 3000 }).catch(async () => {
      await member.click({ force: true, timeout: 3000 }).catch(() => {});
    });
  } else {
    await member.click({ timeout: 3000 }).catch(async () => member.dispatchEvent('click'));
  }
  let r = await readField(c.frame, c.field);
  if (!valuesMatch('radio', text, r.value)) {
    // Styled radios hide the input: click its label instead.
    const id = await member.getAttribute('id').catch(() => null);
    if (id) await c.frame.locator(`label[for="${id}"]`).first().click({ timeout: 2000 }).catch(() => {});
    else await member.locator('xpath=ancestor::label[1]').click({ timeout: 2000 }).catch(() => {});
    r = await readField(c.frame, c.field);
  }
  return { ok: valuesMatch('radio', text, r.value), readBack: r.value, chosen: text };
}

/** Single checkboxes (true/false) and checkbox groups ("A; B"). */
export async function fillCheckbox(c: HandlerCtx): Promise<HandlerResult> {
  if (c.field.options?.length && c.field.meta?.multi !== false && (c.field.options.length > 1 || /;/.test(c.value))) {
    const wanted = c.value.split(/\s*[;|,]\s*/).filter(Boolean);
    const want = new Set(wanted.map((w) => bestOption(w, c.field.options!, 0.7)).filter((x): x is string => !!x));
    if (!want.size) return { ok: false, readBack: '', note: `no option matches "${c.value}"` };
    for (let i = 0; i < c.field.options.length; i++) {
      const m = c.frame.locator(sel(`${c.field.id}:${i}`)).first();
      const on = want.has(c.field.options[i]);
      await setBox(m, on);
    }
    const chosen = c.field.options.filter((o) => want.has(o)).join('; ');
    const r = await readField(c.frame, c.field);
    return { ok: valuesMatch('checkbox', chosen, r.value), readBack: r.value, chosen };
  }
  const desired = truthy(c.value) ?? false;
  const l = loc(c.frame, c.field.id);
  await setBox(l, desired);
  let r = await readField(c.frame, c.field);
  if ((r.value === 'true') !== desired) {
    const id = await l.getAttribute('id').catch(() => null);
    if (id) await c.frame.locator(`label[for="${id}"]`).first().click({ timeout: 2000 }).catch(() => {});
    r = await readField(c.frame, c.field);
  }
  return { ok: (r.value === 'true') === desired, readBack: r.value, chosen: String(desired) };
}

async function setBox(l: ReturnType<HandlerCtx['frame']['locator']>, on: boolean) {
  const state = String(await l.evaluate((e) => ((e as HTMLInputElement).checked === true || e.getAttribute('aria-checked') === 'true' ? '1' : '0')).catch(() => '0'));
  if ((state === '1') === on) return;
  const isInput = String(await l.evaluate((e) => e.tagName).catch(() => '')) === 'INPUT';
  if (isInput) await l.setChecked(on, { force: true, timeout: 3000 }).catch(async () => l.click({ force: true, timeout: 3000 }).catch(() => {}));
  else await l.click({ timeout: 3000 }).catch(() => {});
}
