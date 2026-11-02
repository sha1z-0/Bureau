import { fastMode } from '../human.ts';
import { valuesMatch } from '../normalize.ts';
import { bestOf, blur, clickOption, closeMenus, type HandlerCtx, type HandlerResult, loc, readField, waitOptions } from './common.ts';

/**
 * Custom selects and typeaheads: react-select, MUI Autocomplete, Headless UI,
 * Workday prompts, Select2, location pickers. Open, type to filter, wait, pick
 * the best-matching option, confirm the chip / value. Button-triggered listboxes
 * (MUI Select, Workday "Select One") are opened by clicking.
 */

/** Queries to try, most specific first: the value, its first segment, its first word, a prefix. */
function queries(value: string, location: boolean): string[] {
  const v = value.trim();
  const first = v.split(/[,(|]/)[0].trim();
  const word = first.split(/\s+/)[0];
  const out = [location ? first : v, first, word, word.slice(0, 4)];
  return [...new Set(out.filter((q) => q && q.length >= 2))].slice(0, 4);
}

async function pickOne(c: HandlerCtx, want: string): Promise<{ picked: string | null; note?: string }> {
  const l = loc(c.frame, c.field.id);
  const location = c.field.kind === 'location';
  const button = c.field.meta?.trigger === 'button';
  await l.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});

  if (button) {
    await l.click({ timeout: 3000 });
    let opts = await waitOptions(c.frame, c.field.id, 2500);
    // Searchable menus focus a filter box: type into it.
    const focusedInput = await c.frame.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.tagName === 'INPUT' || a.getAttribute('role') === 'combobox');
    }).catch(() => false);
    let hit = bestOf(want, opts, 0.7);
    if (!hit && focusedInput) {
      for (const q of queries(want, location)) {
        await c.page.keyboard.press('Control+A').catch(() => {});
        await c.page.keyboard.type(q, { delay: fastMode() ? 0 : 30 });
        opts = await waitOptions(c.frame, c.field.id, 2000);
        hit = bestOf(want, opts, 0.7);
        if (hit) break;
      }
    }
    if (!hit) {
      await closeMenus(c.page);
      return { picked: null, note: `no option matches "${want}" (${opts.length} shown)` };
    }
    await clickOption(c.frame, hit);
    // Hierarchical prompts (Workday): a category opens a sub-list.
    for (let depth = 0; depth < 2; depth++) {
      const r = await readField(c.frame, c.field);
      if (r.value || r.display) break;
      const sub = await waitOptions(c.frame, c.field.id, 800);
      const next = bestOf(want, sub, 0.6);
      if (!next) break;
      await clickOption(c.frame, next);
    }
    return { picked: hit.text };
  }

  // Input-driven combobox / typeahead.
  let lastShown = 0;
  for (const q of queries(want, location)) {
    await l.click({ timeout: 3000 }).catch(() => {});
    await l.fill('').catch(() => {});
    await l.pressSequentially(q, { delay: fastMode() ? 10 : 40 });
    let opts = await waitOptions(c.frame, c.field.id, location ? 4000 : 2500);
    if (!opts.length) {
      // Search-on-Enter prompts (Workday) and closed menus.
      await l.press('Enter').catch(() => {});
      opts = await waitOptions(c.frame, c.field.id, 1500);
    }
    if (!opts.length) {
      await l.press('ArrowDown').catch(() => {});
      opts = await waitOptions(c.frame, c.field.id, 800);
    }
    lastShown = opts.length;
    const hit = bestOf(want, opts, location ? 0.6 : 0.7);
    if (hit) {
      await clickOption(c.frame, hit);
      for (let depth = 0; depth < 2; depth++) {
        const r = await readField(c.frame, c.field);
        if (valuesMatch(c.field.kind, hit.text, r.value, { display: r.display }) || r.display) break;
        const sub = await waitOptions(c.frame, c.field.id, 700);
        const next = bestOf(want, sub, 0.6);
        if (!next) break;
        await clickOption(c.frame, next);
      }
      return { picked: hit.text };
    }
  }
  await closeMenus(c.page);
  // Free-text typeaheads (no suggestion list at all) keep what was typed.
  if (!lastShown && !c.field.options?.length) {
    await l.fill(want).catch(() => {});
    await blur(c.frame, c.field.id);
    return { picked: want, note: 'no suggestions; kept the typed text' };
  }
  return { picked: null, note: `no option matches "${want}"` };
}

export async function fillCombobox(c: HandlerCtx): Promise<HandlerResult> {
  const multi = !!c.field.meta?.multi || /;/.test(c.value);
  const wants = multi ? c.value.split(/\s*;\s*/).filter(Boolean) : [c.value];
  const picked: string[] = [];
  const notes: string[] = [];
  for (const w of wants) {
    const { picked: p, note } = await pickOne(c, w);
    if (p) picked.push(p);
    if (note) notes.push(note);
  }
  if (!picked.length) return { ok: false, readBack: '', note: notes.join('; ') };
  const r = await readField(c.frame, c.field);
  const chosen = picked.join('; ');
  const ok = picked.every((p) => valuesMatch(c.field.kind, p, r.value, { display: r.display }) || valuesMatch(c.field.kind, p, `${r.value} ${r.display ?? ''}`));
  return { ok, readBack: r.value || r.display || '', display: r.display, chosen, note: notes.join('; ') || undefined };
}
