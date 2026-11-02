import type { Page } from 'playwright-core';
import type { Recipe, RecipeStep, ValueSource } from '../contracts/forms.ts';
import type { AtsFamily } from '../contracts/job.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { get } from '../db.ts';
import type { Candidate } from './candidate.ts';
import type { ExtractedField } from './extract.ts';
import { frameKey } from './extract.ts';
import type { MappedValue } from './map.ts';
import { profileValue } from './map.ts';
import { bestOption, declineOption, widgetFamily } from './normalize.ts';
import { inFrame } from './page.ts';

/**
 * Running a recipe: resolve each step to a field on the live page by its
 * selectors, then by signature, then by normalised label + widget (self-heal),
 * and record every patch so the engine can save a new recipe version.
 */

export interface RecipePage {
  steps: RecipeStep[];
  next: RecipeStep | null;
}

export function recipePages(recipe: Recipe): { pages: RecipePage[]; submit: RecipeStep | null } {
  const pages: RecipePage[] = [{ steps: [], next: null }];
  let submit: RecipeStep | null = null;
  for (const s of recipe.steps) {
    if (s.action === 'next') {
      pages[pages.length - 1].next = s;
      pages.push({ steps: [], next: null });
    } else if (s.action === 'submit') submit = s;
    else pages[pages.length - 1].steps.push(s);
  }
  return { pages, submit };
}

export interface Resolution {
  /** fieldId → the recipe step that drives it. */
  byField: Map<string, RecipeStep>;
  /** Steps whose selectors failed but were found again (with the new selectors). */
  healed: { step: RecipeStep; field: ExtractedField; how: 'signature' | 'label' }[];
  /** Steps that could not be found at all. */
  missing: RecipeStep[];
}

/** Resolve one page of recipe steps against freshly extracted fields. */
export async function resolveSteps(page: Page, steps: RecipeStep[], fields: ExtractedField[]): Promise<Resolution> {
  const out: Resolution = { byField: new Map(), healed: [], missing: [] };
  const byId = new Map(fields.map((f) => [f.id, f]));
  const taken = new Set<string>();
  for (const s of steps) {
    if (!['fill', 'select', 'check', 'upload'].includes(s.action)) continue;
    let hit: ExtractedField | null = null;
    // 1. Selectors, in every frame.
    if (s.selectors.length) {
      for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        const css = s.selectors.filter((x) => !x.startsWith('label='));
        if (!css.length) break;
        const found = await inFrame<{ selector: string; id: string }[]>(frame, 'stampOf', { selectors: css }).catch(() => []);
        const key = frameKey(page, frame);
        for (const fnd of found) {
          const f = byId.get(fnd.id);
          if (f && !taken.has(f.id) && (f.frame ?? 'b') === key) {
            hit = f;
            break;
          }
        }
        if (hit) break;
      }
      if (!hit) {
        const lbl = s.selectors.find((x) => x.startsWith('label='))?.slice(6);
        if (lbl) hit = fields.find((f) => !taken.has(f.id) && f.label === lbl && widgetFamily(f.kind) === widgetFamily(s.widget)) ?? null;
      }
    }
    if (hit) {
      // A selector that now lands on a different question is a broken selector, not a match.
      if (s.fieldSignature && hit.signature !== s.fieldSignature && s.labelNorm && hit.labelNorm !== s.labelNorm) hit = null;
    }
    if (hit) {
      taken.add(hit.id);
      out.byField.set(hit.id, s);
      continue;
    }
    // 2. Self-heal by signature, then by label + widget family.
    const bySig = s.fieldSignature ? fields.find((f) => !taken.has(f.id) && f.signature === s.fieldSignature) : undefined;
    const byLabel = !bySig && s.labelNorm ? fields.find((f) => !taken.has(f.id) && f.labelNorm === s.labelNorm && widgetFamily(f.kind) === widgetFamily(s.widget)) : undefined;
    const healed = bySig ?? byLabel;
    if (healed) {
      taken.add(healed.id);
      out.byField.set(healed.id, s);
      out.healed.push({ step: s, field: healed, how: bySig ? 'signature' : 'label' });
    } else out.missing.push(s);
  }
  return out;
}

/** The value a recipe step names, resolved from the packet / profile / bank. Null → the mapper decides. */
export function recipeValue(s: RecipeStep, f: ExtractedField, ctx: { packet: ApplicationPacket; candidate: Candidate | null; job: { source: string } | null }): MappedValue | null {
  const src = s.valueSource;
  const key = s.valueKey ?? '';
  if (!src || !key) return null;
  const mk = (source: ValueSource, value: string, confidence: number): MappedValue | null => (value ? { fieldId: f.id, source, key, value, confidence } : null);
  switch (src) {
    case 'file':
      if (key === 'cv') return mk('file', ctx.packet.cvPdfPath, 0.97);
      if (key === 'letter') return mk('file', ctx.packet.letterPdfPath, 0.97);
      return null;
    case 'profile': {
      if (!ctx.candidate) return null;
      const synKey = key.replace(/^profile\./, '').replace(/^links\./, '');
      const alias: Record<string, string> = { name: 'full_name', yearsExperience: 'years_experience', location: 'location', email: 'email', phone: 'phone', linkedin: 'linkedin', github: 'github', portfolio: 'portfolio' };
      let v = profileValue(alias[synKey] ?? synKey, ctx.candidate, f, f.meta?.group?.index ?? 0);
      if (v && f.options?.length) v = bestOption(v, f.options, 0.6) ?? '';
      return mk('profile', v, 0.95);
    }
    case 'answer_bank': {
      const row = get<{ answer: string }>("SELECT answer FROM answer_bank WHERE id = ? AND answer <> ''", key);
      if (!row) return null;
      const v = f.options?.length ? bestOption(row.answer, f.options, 0.75) : row.answer;
      return v ? mk('answer_bank', v, 0.95) : null;
    }
    case 'writer': {
      if (key === 'coverLetter') return mk('writer', ctx.packet.coverLetter, 0.95);
      const k = key.replace(/^writer:/, '');
      return mk('writer', ctx.packet.shortAnswers[k] ?? '', 0.9);
    }
    case 'generated': {
      if (key.startsWith('eeo') && f.options?.length) return mk('generated', declineOption(f.options) ?? '', 0.95);
      if (key === 'consent:marketing' || key === 'consent:consent_marketing') return mk('generated', 'false', 0.95);
      if (key.startsWith('consent')) return mk('generated', 'true', 0.9);
      return null;
    }
    default:
      return null;
  }
}

export interface TraceField {
  field: ExtractedField;
  value: MappedValue;
  step: number;
}

const ACTION: Record<string, RecipeStep['action']> = { file: 'upload', checkbox: 'check', consent: 'check', radio: 'select', select: 'select', combobox: 'select', location: 'select' };

/** Turn a verified run into a recipe: filled fields by signature, wizard moves, the submit button. */
export function buildRecipe(input: {
  ats: AtsFamily;
  scope: Recipe['scope'];
  scopeKey: string;
  urlPattern?: string;
  filled: TraceField[];
  nexts: { step: number; selectors: string[] }[];
  submit: string[];
}): Recipe {
  const steps: RecipeStep[] = [];
  const hooks: Recipe['hooks'] = [];
  const maxStep = Math.max(0, ...input.filled.map((t) => t.step), ...input.nexts.map((n) => n.step));
  for (let st = 0; st <= maxStep; st++) {
    for (const t of input.filled.filter((x) => x.step === st)) {
      const v = t.value;
      // Long, company-specific answers stay hooks: their text is never baked into a recipe.
      if (v.source === 'writer' && v.key !== 'coverLetter') {
        hooks.push({ fieldSignature: t.field.signature, labelNorm: t.field.labelNorm });
        continue;
      }
      steps.push({
        action: ACTION[t.field.kind] ?? 'fill',
        fieldSignature: t.field.signature,
        selectors: t.field.selectors,
        widget: t.field.kind,
        valueSource: v.source,
        valueKey: v.source === 'file' ? v.key : v.synKey && v.source === 'profile' ? v.synKey : v.key,
        labelNorm: t.field.labelNorm,
      });
    }
    const n = input.nexts.find((x) => x.step === st);
    if (n) steps.push({ action: 'next', selectors: n.selectors, widget: 'button' });
  }
  if (input.submit.length) steps.push({ action: 'submit', selectors: input.submit, widget: 'button' });
  return {
    ats: input.ats,
    scope: input.scope,
    scopeKey: input.scopeKey,
    version: 1,
    status: 'active',
    match: input.urlPattern ? { urlPattern: input.urlPattern } : {},
    steps,
    hooks,
  };
}

/** Patch healed selectors into a copy of the recipe. */
export function patchRecipe(recipe: Recipe, healed: Resolution['healed'], extra: RecipeStep[] = []): Recipe {
  const steps = recipe.steps.map((s) => {
    const h = healed.find((x) => x.step === s);
    if (!h) return s;
    return { ...s, selectors: [...new Set([...h.field.selectors, ...s.selectors])].slice(0, 8), fieldSignature: h.field.signature, labelNorm: h.field.labelNorm };
  });
  return { ...recipe, steps: [...steps, ...extra] };
}
