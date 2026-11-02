import { typeInto } from '../human.ts';
import { valuesMatch } from '../normalize.ts';
import { blur, type HandlerCtx, type HandlerResult, loc, readField } from './common.ts';

/** Text, email, url, number, tel and textarea: type, commit, read back. One retry with a plain fill. */
export async function fillText(c: HandlerCtx): Promise<HandlerResult> {
  const l = loc(c.frame, c.field.id);
  await l.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await l.click({ timeout: 3000 }).catch(() => {});
  await typeInto(l, c.value);
  await blur(c.frame, c.field.id);
  let r = await readField(c.frame, c.field);
  if (!valuesMatch(c.field.kind, c.value, r.value)) {
    await l.fill(c.value).catch(() => {});
    await blur(c.frame, c.field.id);
    r = await readField(c.frame, c.field);
  }
  return { ok: valuesMatch(c.field.kind, c.value, r.value), readBack: r.value };
}

/** contenteditable editors (Quill, Draft, ProseMirror): select all, replace, read innerText. */
export async function fillRichText(c: HandlerCtx): Promise<HandlerResult> {
  const l = loc(c.frame, c.field.id);
  await l.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await l.click({ timeout: 3000 });
  await c.page.keyboard.press('Control+A');
  await c.page.keyboard.press('Delete');
  const paras = c.value.split(/\n/);
  for (let i = 0; i < paras.length; i++) {
    if (i) await c.page.keyboard.press('Enter');
    if (paras[i]) await c.page.keyboard.insertText(paras[i]);
  }
  await blur(c.frame, c.field.id);
  const r = await readField(c.frame, c.field);
  return { ok: valuesMatch('richtext', c.value, r.value), readBack: r.value };
}
