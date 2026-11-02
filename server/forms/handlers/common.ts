import type { Frame, Locator, Page } from 'playwright-core';
import type { FormField } from '../../contracts/forms.ts';
import { frameFor } from '../extract.ts';
import { fastMode } from '../human.ts';
import { optionScore } from '../normalize.ts';
import { inFrame, type RawField, type ReadResult } from '../page.ts';

/** Shared plumbing for widget handlers. */

export type FilePayload = string | { name: string; mimeType: string; buffer: Buffer };
export interface FileSet {
  cv: FilePayload;
  letter: FilePayload;
}

export type HField = FormField & { meta?: RawField['meta'] };

export interface HandlerCtx {
  page: Page;
  frame: Frame;
  field: HField;
  value: string;
  /** For uploads: which file the value names. */
  fileKey?: string;
  files: FileSet;
}

export interface HandlerResult {
  ok: boolean;
  readBack: string;
  /** The option actually picked, when it differs from the intended text. */
  chosen?: string;
  note?: string;
  display?: string;
  chip?: string;
}

export const sel = (id: string) => `[data-bureau-id="${id.replace(/"/g, '\\"')}"]`;

export function ctxFor(page: Page, field: HField): Frame {
  return frameFor(page, field);
}

export function loc(frame: Frame, id: string): Locator {
  return frame.locator(sel(id)).first();
}

export async function readField(frame: Frame, field: HField, expect?: string): Promise<ReadResult> {
  const res = await inFrame<Record<string, ReadResult>>(frame, 'read', { items: [{ id: field.id, kind: field.kind, trigger: field.meta?.trigger === 'button', expect }] });
  return res[field.id] ?? { exists: false, value: '' };
}

export async function blur(frame: Frame, id: string) {
  await inFrame(frame, 'blur', { id }).catch(() => {});
}

export interface OptionView {
  opt: string;
  text: string;
}

/** Poll for visible options (an open listbox / suggestion menu). */
export async function waitOptions(frame: Frame, forId: string | null, timeoutMs = 2500): Promise<OptionView[]> {
  const until = Date.now() + timeoutMs;
  let last: OptionView[] = [];
  while (Date.now() < until) {
    last = await inFrame<OptionView[]>(frame, 'options', forId ? { forId } : {}).catch(() => []);
    const real = last.filter((o) => o.text && !/^(no (results|options)|loading|searching|start typing|type to search)/i.test(o.text));
    if (real.length) return real;
    await frame.page().waitForTimeout(fastMode() ? 60 : 120);
  }
  return [];
}

export function bestOf(value: string, options: OptionView[], min = 0.7): OptionView | null {
  let best: OptionView | null = null;
  let score = 0;
  for (const o of options) {
    const s = optionScore(value, o.text);
    if (s > score) {
      score = s;
      best = o;
    }
  }
  return score >= min ? best : null;
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function clickOption(frame: Frame, o: OptionView) {
  const l = frame.locator(`[data-bureau-opt="${o.opt}"]`).first();
  await l.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
  try {
    await l.click({ timeout: 1200 });
    return;
  } catch {
    /* menus that redraw on hover detach the stamped node: find the option again by its text */
  }
  const exact = new RegExp(`^\\s*${escapeRe(o.text)}\\s*$`);
  const again = frame.locator('[role="option"], .select2-result-selectable, [class*="option" i], li').filter({ hasText: exact }).first();
  try {
    await again.click({ timeout: 2500 });
    return;
  } catch {
    /* last resort: the keyboard, like a person would */
  }
  await frame.page().keyboard.type(o.text, { delay: 10 }).catch(() => {});
  await frame.page().keyboard.press('Enter').catch(() => {});
}

/** Escape: close any menu left open. */
export async function closeMenus(page: Page) {
  await page.keyboard.press('Escape').catch(() => {});
}
