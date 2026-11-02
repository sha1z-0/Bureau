import type { Frame, Page } from 'playwright-core';
import type { FieldKind, FormField } from '../contracts/forms.ts';
import { labelNorm, signatureOf } from './normalize.ts';
import { inFrame, type RawAdder, type RawApply, type RawExtract, type RawField, type RawNav } from './page.ts';

/**
 * Extraction across the whole page: the main document, open shadow roots, and
 * every child frame (same-origin Greenhouse embeds, cross-origin ATS iframes).
 * Challenge, analytics and invisible frames are skipped and recorded.
 */

const FIELD_KINDS = new Set<FieldKind>(['text', 'email', 'tel', 'url', 'number', 'textarea', 'select', 'combobox', 'radio', 'checkbox', 'date', 'file', 'richtext', 'location', 'phone', 'consent', 'unknown']);

export interface ExtractedField extends FormField {
  meta: RawField['meta'];
  selectors: string[];
  /** Label exactly as shown (with the required mark). */
  rawLabel: string;
  /** Document order within the frame. */
  order: number;
}

export interface FrameNote {
  key: string;
  url: string;
  origin: string;
  sameOrigin: boolean;
  skipped?: string;
}

export interface StepExtract {
  fields: ExtractedField[];
  navs: (RawNav & { frame: string })[];
  adders: (RawAdder & { frame: string })[];
  applies: (RawApply & { frame: string })[];
  frames: FrameNote[];
  url: string;
  title: string;
}

const SKIP_FRAME = /recaptcha|hcaptcha|challenges\.cloudflare|arkoselabs|funcaptcha|google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|hotjar|intercom|drift|zendesk|youtube\.com|vimeo\.com|stripe\.com|paypal|maps\.google|captcha/i;

interface PageReg {
  keys: WeakMap<Frame, string>;
  frames: Map<string, Frame>;
  n: number;
}
const registry = new WeakMap<Page, PageReg>();

function reg(page: Page): PageReg {
  let r = registry.get(page);
  if (!r) {
    r = { keys: new WeakMap(), frames: new Map(), n: 0 };
    registry.set(page, r);
  }
  return r;
}

/** The id prefix for a frame: `b` for the main frame, `b<n>x` for child frames. */
export function frameKey(page: Page, frame: Frame): string {
  const r = reg(page);
  if (frame === page.mainFrame()) {
    r.frames.set('b', frame);
    return 'b';
  }
  let k = r.keys.get(frame);
  if (!k) {
    k = `b${++r.n}x`;
    r.keys.set(frame, k);
  }
  r.frames.set(k, frame);
  return k;
}

/** The frame holding a field (by its id prefix). Falls back to the main frame. */
export function frameFor(page: Page, field: Pick<FormField, 'id'>): Frame {
  const m = field.id.match(/^(b\d+x)/);
  if (m) {
    const f = reg(page).frames.get(m[1]);
    if (f && !f.isDetached()) return f;
  }
  return page.mainFrame();
}

export function frameByKey(page: Page, key: string): Frame {
  if (key === 'b') return page.mainFrame();
  const f = reg(page).frames.get(key);
  return f && !f.isDetached() ? f : page.mainFrame();
}

async function frameUsable(frame: Frame): Promise<string | null> {
  const url = frame.url();
  if (SKIP_FRAME.test(url)) return 'challenge or third-party widget';
  try {
    const el = await frame.frameElement();
    const box = await el.boundingBox();
    if (!box || box.width < 40 || box.height < 40) return 'invisible';
  } catch {
    return 'detached';
  }
  return null;
}

function toField(raw: RawField, step: number, frame: string): ExtractedField {
  const kind = (FIELD_KINDS.has(raw.kind as FieldKind) ? raw.kind : 'unknown') as FieldKind;
  const ln = labelNorm(raw.label);
  const section = raw.meta.group ? `${raw.section || raw.meta.group.name}#${raw.meta.group.index + 1}` : raw.section;
  const f: ExtractedField = {
    id: raw.id,
    kind,
    label: raw.label,
    labelNorm: ln,
    required: raw.required,
    options: raw.options,
    section: section || undefined,
    step,
    signature: '',
    frame: frame === 'b' ? undefined : frame,
    meta: raw.meta,
    selectors: raw.selectors,
    rawLabel: raw.rawLabel,
    order: raw.order,
  };
  f.signature = signatureOf({ labelNorm: ln, kind, options: raw.options, section });
  return f;
}

/** Every field, button and frame on the current step. */
export async function extractStep(page: Page, step = 0): Promise<StepExtract> {
  const out: StepExtract = { fields: [], navs: [], adders: [], applies: [], frames: [], url: page.url(), title: '' };
  const mainOrigin = safeOrigin(page.url());
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    const isMain = frame === page.mainFrame();
    const key = frameKey(page, frame);
    if (!isMain) {
      const note: FrameNote = { key, url: frame.url(), origin: safeOrigin(frame.url()), sameOrigin: safeOrigin(frame.url()) === mainOrigin };
      const skip = await frameUsable(frame);
      if (skip) {
        note.skipped = skip;
        out.frames.push(note);
        continue;
      }
      out.frames.push(note);
    }
    let res: RawExtract | null = null;
    try {
      res = await inFrame<RawExtract>(frame, 'extract', { prefix: key });
    } catch {
      res = null;
    }
    if (!res) continue;
    if (isMain) out.title = res.title;
    for (const f of res.fields) out.fields.push(toField(f, step, key));
    for (const n of res.navs) out.navs.push({ ...n, frame: key });
    for (const a of res.adders) out.adders.push({ ...a, frame: key });
    for (const a of res.applies) out.applies.push({ ...a, frame: key });
  }
  return out;
}

function safeOrigin(u: string): string {
  try {
    return new URL(u).origin;
  } catch {
    return '';
  }
}

/** The contract surface: plain FormFields for the current step. */
export async function extractFields(page: Page, step = 0): Promise<FormField[]> {
  return (await extractStep(page, step)).fields;
}

/** Fields that count as "a form is here" (not just a newsletter box or a lone upload). */
export function formPresent(fields: FormField[]): boolean {
  return fields.filter((f) => f.kind !== 'file' && f.kind !== 'checkbox' && f.kind !== 'consent').length >= 2;
}
