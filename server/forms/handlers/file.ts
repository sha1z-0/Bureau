import path from 'node:path';
import { normText } from '../normalize.ts';
import { type FilePayload, type HandlerCtx, type HandlerResult, loc, readField } from './common.ts';

/**
 * Uploads: input[type=file] (hidden or not), drag zones and "Attach" buttons
 * that open a file chooser. Read-back is the input's file list or the filename
 * chip the widget renders.
 */

export function payloadName(p: FilePayload): string {
  return typeof p === 'string' ? path.basename(p) : p.name;
}

export async function fillFile(c: HandlerCtx): Promise<HandlerResult> {
  const which = c.fileKey === 'letter' || /letter/i.test(c.fileKey ?? '') ? c.files.letter : c.files.cv;
  const name = payloadName(which);
  const l = loc(c.frame, c.field.id);
  const setFiles = async () => {
    if (typeof which === 'string') await l.setInputFiles(which, { timeout: 8000 });
    else await l.setInputFiles(which, { timeout: 8000 });
  };
  try {
    await setFiles();
  } catch (err) {
    // Not a real input (a drop zone): click it and answer the chooser.
    const chooser = c.page.waitForEvent('filechooser', { timeout: 5000 });
    await l.click({ timeout: 3000 }).catch(() => {});
    const fc = await chooser.catch(() => null);
    if (!fc) return { ok: false, readBack: '', note: `upload failed: ${(err as Error).message.split('\n')[0]}` };
    await fc.setFiles(which as string);
  }
  // Uploads that post first (S3 direct, pre-upload endpoints) need a moment to render the chip.
  let r = await readField(c.frame, c.field, name);
  for (let i = 0; i < 20 && !shows(name, r.value, r.chip); i++) {
    await c.page.waitForTimeout(150);
    r = await readField(c.frame, c.field, name);
  }
  // Uploads that post and then parse ("Uploading...", "Reading your resume..."): wait for them to settle.
  const busy = /\b(uploading|reading your (resume|cv)|analy[sz]ing your|parsing your|please wait)\b/i;
  for (let i = 0; i < 60; i++) {
    const text = await c.frame.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (!busy.test(text)) break;
    await c.page.waitForTimeout(250);
  }
  r = await readField(c.frame, c.field, name);
  return { ok: shows(name, r.value, r.chip), readBack: r.value, chip: r.chip, chosen: name };
}

function shows(name: string, value: string, chip?: string): boolean {
  const n = normText(name);
  return normText(value).includes(n) || (!!chip && normText(chip).includes(n));
}
