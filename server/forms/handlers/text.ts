import { fastMode, typeInto } from '../human.ts';
import { valuesMatch } from '../normalize.ts';
import { blur, type HandlerCtx, type HandlerResult, loc, readField } from './common.ts';

/** Text, email, url, number, tel and textarea: type, commit, read back. One retry with a plain fill. */
export async function fillText(c: HandlerCtx): Promise<HandlerResult> {
  if ((c.field.meta as { closed?: boolean } | undefined)?.closed) return fillClosed(c);
  const l = loc(c.frame, c.field.id);
  await l.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await l.click({ timeout: 3000 }).catch(() => {});
  await typeInto(l, c.value);
  // Leave the field the way a person does (Tab): inline editors commit on Tab/Enter, not on a programmatic blur.
  await l.press('Tab').catch(() => blur(c.frame, c.field.id));
  await c.page.waitForTimeout(120);
  let r = await readField(c.frame, c.field);
  if (!valuesMatch(c.field.kind, c.value, r.value)) {
    await l.click({ timeout: 2000 }).catch(() => {});
    await l.fill(c.value).catch(() => {});
    await l.press('Tab').catch(() => {});
    await c.page.waitForTimeout(350);
    r = await readField(c.frame, c.field);
  }
  return { ok: valuesMatch(c.field.kind, c.value, r.value), readBack: r.value };
}

/**
 * A field inside a CLOSED shadow root: nothing can be located inside it, so click the host (it delegates focus
 * to its input), replace the text with the keyboard and read the value back from the form's FormData.
 */
async function fillClosed(c: HandlerCtx): Promise<HandlerResult> {
  const l = loc(c.frame, c.field.id);
  await l.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await l.click({ timeout: 3000 });
  await c.page.keyboard.press('Control+A');
  await c.page.keyboard.press('Delete');
  await c.page.keyboard.type(c.value, { delay: fastMode() ? 0 : 40 });
  await c.page.keyboard.press('Tab');
  await c.page.waitForTimeout(120);
  const r = await readField(c.frame, c.field);
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
