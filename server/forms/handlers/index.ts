import type { Page } from 'playwright-core';
import type { FieldValue, FormField } from '../../contracts/forms.ts';
import { fillCheckbox, fillRadio, fillSelect } from './choice.ts';
import { fillCombobox } from './combobox.ts';
import { ctxFor, type FileSet, type HandlerCtx, type HandlerResult, type HField } from './common.ts';
import { fillDate } from './date.ts';
import { fillFile } from './file.ts';
import { fillPhone } from './phone.ts';
import { fillRichText, fillText } from './text.ts';

export type { FilePayload, FileSet, HandlerResult } from './common.ts';

/** One handler per widget kind. Every handler reads back what it wrote. */
export async function dispatch(c: HandlerCtx): Promise<HandlerResult> {
  switch (c.field.kind) {
    case 'select':
      return fillSelect(c);
    case 'radio':
      return fillRadio(c);
    case 'checkbox':
    case 'consent':
      return fillCheckbox(c);
    case 'combobox':
    case 'location':
      return fillCombobox(c);
    case 'date':
      return fillDate(c);
    case 'file':
      return fillFile(c);
    case 'phone':
      return fillPhone(c);
    case 'richtext':
      return fillRichText(c);
    case 'text':
    case 'email':
    case 'tel':
    case 'url':
    case 'number':
    case 'textarea':
    default:
      return fillText(c);
  }
}

/** Fill one field with the right handler and read it back. Never throws: failures come back as ok:false. */
export async function fillField(page: Page, field: FormField, value: FieldValue | string, files: FileSet): Promise<HandlerResult> {
  const v = typeof value === 'string' ? { value, key: '' } : value;
  const f = field as HField;
  const c: HandlerCtx = { page, frame: ctxFor(page, f), field: f, value: v.value, fileKey: v.key, files };
  try {
    return await dispatch(c);
  } catch (err) {
    return { ok: false, readBack: '', note: (err as Error).message.split('\n')[0].slice(0, 200) };
  }
}
