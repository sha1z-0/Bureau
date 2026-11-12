import { fastMode } from '../human.ts';
import { normText, optionScore, sameItem, valuesMatch } from '../normalize.ts';
import { bestOf, blur, clickOption, closeMenus, type HandlerCtx, type HandlerResult, loc, type OptionView, readField, waitOptions } from './common.ts';

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

/** A creatable menu's pseudo-option: 'Create "PostgreSQL"'. */
const CREATE = /^(?:create|add)\s*:?\s*["“'](.+?)["”']\s*$/i;

/**
 * The option to click for one value. Several picks (`strict`): the item itself, else the menu's offer to
 * create exactly it, else only a near-certain match. One pick: the usual best match.
 */
function choose(want: string, opts: OptionView[], min: number, strict: boolean): OptionView | null {
  const exact = opts.find((o) => !CREATE.test(o.text.trim()) && sameItem(want, o.text));
  if (exact) return exact;
  const create = opts.find((o) => {
    const m = o.text.trim().match(CREATE);
    return !!m && normText(m[1]) === normText(want);
  });
  const real = opts.filter((o) => !CREATE.test(o.text.trim()));
  if (strict) return create ?? (real.some((o) => optionScore(want, o.text) >= 0.95) ? bestOf(want, real, 0.95) : null);
  return bestOf(want, real, min) ?? create ?? null;
}

async function pickOne(c: HandlerCtx, want: string, strict = false): Promise<{ picked: string | null; note?: string }> {
  const l = loc(c.frame, c.field.id);
  const location = c.field.kind === 'location';
  const button = c.field.meta?.trigger === 'button';
  await l.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});

  if (button) {
    // A multi-pick menu stays open after a pick: clicking its button again would close it.
    if ((await l.getAttribute('aria-expanded', { timeout: 1000 }).catch(() => null)) !== 'true') await l.click({ timeout: 3000 });
    let opts = await waitOptions(c.frame, c.field.id, 2500);
    // Searchable menus focus a filter box: type into it.
    const focusedInput = await c.frame.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.tagName === 'INPUT' || a.getAttribute('role') === 'combobox');
    }).catch(() => false);
    let hit = choose(want, opts, 0.7, strict);
    if (!hit && focusedInput) {
      for (const q of queries(want, location)) {
        await c.page.keyboard.press('Control+A').catch(() => {});
        await c.page.keyboard.type(q, { delay: fastMode() ? 0 : 30 });
        opts = await waitOptions(c.frame, c.field.id, 2000);
        hit = choose(want, opts, 0.7, strict);
        if (hit) break;
      }
    }
    if (!hit) {
      await closeMenus(c.page);
      return { picked: null, note: `no option matches "${want}" (${opts.length} shown)` };
    }
    return { picked: await pickPath(c, want, hit) };
  }

  // Input-driven combobox / typeahead. First the menu as it opens (fixed lists, category trees).
  if (!location && c.field.options?.length) {
    await l.click({ timeout: 3000 }).catch(() => {});
    const first = await waitOptions(c.frame, c.field.id, 1200);
    const hit = choose(want, first, 0.75, strict);
    if (hit) return { picked: await pickPath(c, want, hit) };
  }
  let lastShown = 0;
  for (const q of queries(want, location)) {
    await l.click({ timeout: 3000 }).catch(() => {});
    await l.fill('').catch(() => {});
    await l.pressSequentially(q, { delay: fastMode() ? 10 : 40 });
    let opts = await waitOptions(c.frame, c.field.id, location ? 4000 : 2500);
    if (!opts.length) {
      // Search-on-Enter prompts (Workday) and closed menus. The submit guard keeps Enter from sending the form.
      await l.press('Enter').catch(() => {});
      opts = await waitOptions(c.frame, c.field.id, 1500);
    }
    if (!opts.length) {
      await l.press('ArrowDown').catch(() => {});
      opts = await waitOptions(c.frame, c.field.id, 800);
    }
    lastShown = opts.length;
    const hit = choose(want, opts, location ? 0.6 : 0.7, strict);
    if (hit) return { picked: await pickPath(c, want, hit) };
  }
  await closeMenus(c.page);
  // Free-text typeaheads (no suggestion list at all) keep what was typed. A location box whose suggestions never
  // matched keeps the full place too, never the last short query ("Rawa" for "Rawalpindi, Pakistan").
  if ((!lastShown || location) && !c.field.options?.length) {
    await l.fill(want).catch(() => {});
    await blur(c.frame, c.field.id);
    return { picked: want, note: 'no suggestions; kept the typed text' };
  }
  return { picked: null, note: `no option matches "${want}"` };
}

const CHIP_REMOVE = '[data-automation-id="DELETE_charm"], [class*="multiValue__remove"], [class*="multi-value__remove"], [class*="clear-indicator" i], [class*="clearIndicator"], .MuiChip-deleteIcon, .MuiAutocomplete-clearIndicator, button[aria-label^="Remove" i], button[aria-label^="Delete" i]';

/** A wrong pre-filled pick (resume parse, a previous visit) is removed before choosing again. */
async function clearWrongPick(c: HandlerCtx, wants: string[]) {
  const r = await readField(c.frame, c.field);
  const shown = r.display || '';
  if (!shown || wants.every((w) => valuesMatch(c.field.kind, w, shown))) return;
  const box = loc(c.frame, c.field.id).locator('xpath=ancestor::*[.//*[@data-automation-id="DELETE_charm"] or .//*[contains(@class,"remove")] or .//*[contains(@class,"clear")]][1]');
  const btns = box.locator(CHIP_REMOVE);
  const n = Math.min(await btns.count().catch(() => 0), 10);
  for (let i = n - 1; i >= 0; i--) await btns.nth(i).click({ timeout: 1500 }).catch(() => {});
}

/**
 * Click an option; when it is a category (a tree prompt: "Job Board ›"), keep going
 * into its sub-list and pick the best leaf (a leaf that names the answer, else
 * the category's "Other …"). Returns the label of the leaf actually picked.
 */
async function pickPath(c: HandlerCtx, want: string, first: OptionView): Promise<string> {
  const created = first.text.trim().match(CREATE);
  let picked = created ? created[1] : first.text;
  await clickOption(c.frame, first);
  if (created) return picked;
  for (let depth = 0; depth < 3; depth++) {
    const r = await readField(c.frame, c.field);
    if (r.value && valuesMatch(c.field.kind, picked, r.value)) break;
    if (r.display && valuesMatch(c.field.kind, picked, r.display)) break;
    const sub = (await waitOptions(c.frame, c.field.id, 700)).filter((o) => o.text !== picked);
    if (!sub.length) break;
    const next = bestOf(want, sub, 0.6) ?? sub.find((o) => /^other\b/i.test(o.text)) ?? null;
    if (!next) break;
    picked = next.text;
    await clickOption(c.frame, next);
  }
  return picked;
}

export async function fillCombobox(c: HandlerCtx): Promise<HandlerResult> {
  const multi = !!c.field.meta?.multi || /;/.test(c.value);
  const wants = multi ? c.value.split(/\s*;\s*/).filter(Boolean) : [c.value];
  // Several picks: the ones already there (an earlier pass) stay, only the missing ones are added. A menu hides
  // what is picked, so picking them again would grab a near neighbour ("SQL Server" for "SQL").
  const several = multi && wants.length > 1;
  const before = several ? await readField(c.frame, c.field).catch(() => null) : null;
  const shown = before ? `${before.value};${before.display ?? ''}`.split(/\s*[;,]\s*/).filter(Boolean) : [];
  const present = (w: string) => shown.some((s) => sameItem(w, s));
  if (c.field.meta?.trigger !== 'button' && !(several && wants.some(present))) await clearWrongPick(c, wants).catch(() => {});
  const picked: string[] = [];
  const notes: string[] = [];
  for (const w of wants) {
    if (several && present(w)) {
      picked.push(w);
      continue;
    }
    const { picked: p, note } = await pickOne(c, w, several);
    if (p) picked.push(p);
    if (note) notes.push(note);
  }
  if (multi && c.field.meta?.trigger === 'button') await closeMenus(c.page).catch(() => {});
  if (!picked.length) return { ok: false, readBack: '', note: notes.join('; ') };
  const r = await readField(c.frame, c.field);
  const chosen = picked.join('; ');
  const ok = picked.every((p) => valuesMatch(c.field.kind, p, r.value, { display: r.display }) || valuesMatch(c.field.kind, p, `${r.value} ${r.display ?? ''}`));
  return { ok, readBack: r.value || r.display || '', display: r.display, chosen, note: notes.join('; ') || undefined };
}

/** Open a custom select just long enough to read its options (no selection). */
export async function probeOptions(page: import('playwright-core').Page, field: HandlerCtx['field']): Promise<string[]> {
  const { ctxFor } = await import('./common.ts');
  const frame = ctxFor(page, field);
  const l = loc(frame, field.id);
  try {
    await l.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    await l.click({ timeout: 2000 });
  } catch {
    return [];
  }
  const opts = await waitOptions(frame, field.id, 1200);
  await page.keyboard.press('Escape').catch(() => {});
  await blur(frame, field.id);
  return opts.map((o) => o.text).filter(Boolean).slice(0, 300);
}
