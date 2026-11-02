import type { Page } from 'playwright-core';
import type { Recipe, RecipeStep } from '../contracts/forms.ts';
import { type ExtractedField, extractStep, frameFor } from '../forms/extract.ts';
import { withSubmitAllowed } from '../forms/guard.ts';
import { fillField, type FileSet } from '../forms/handlers/index.ts';
import { readField } from '../forms/handlers/common.ts';
import { type MapOptions, type MappedValue, mapFieldsWith, MIN_CONFIDENCE } from '../forms/map.ts';
import { labelNorm, valuesMatch } from '../forms/normalize.ts';
import { recipeValue, resolveSteps } from '../forms/recipeRun.ts';
import { verifyFields } from '../forms/verify.ts';
import { clickVerdict, type UrlPolicy } from './guard.ts';
import { agentOp, type Snapshot } from './page.ts';
import type { TraceRecorder } from './trace.ts';
import type { ValueCtx } from './values.ts';

/**
 * Deterministic recipe replay: clicks (reveal a form, open a section, a custom
 * wizard's Next) by their selector candidates, fills by A05's step resolution
 * (selectors → signature → label + widget) with values from A05's recipe
 * resolver, hooks through the mapper, then verifies. No Claude call. Never
 * presses a final submit: a `submit` step ends the replay.
 */

const FILLS = new Set(['fill', 'select', 'check', 'upload']);

export interface ReplayResult {
  verified: boolean;
  problems: string[];
  intended: { field: ExtractedField; value: MappedValue; page: number }[];
  filled: number;
  page: number;
}

export async function replayRecipe(
  page: Page,
  recipe: Recipe,
  opts: { vctx: ValueCtx; files: FileSet; signal?: AbortSignal; policy: UrlPolicy; rec?: TraceRecorder; mapDeps?: MapOptions['deps'] },
): Promise<ReplayResult> {
  const problems: string[] = [];
  const intended = new Map<string, { field: ExtractedField; value: MappedValue; page: number }>();
  let pending: RecipeStep[] = [];
  let pageNo = 0;
  let filled = 0;
  const aborted = () => {
    if (opts.signal?.aborted) {
      const e = new Error('Recipe replay stopped by the kill switch.');
      e.name = 'AbortError';
      throw e;
    }
  };

  const fillOne = async (f: ExtractedField, v: MappedValue, s: { action: RecipeStep['action'] | 'fill' }) => {
    const cur = await readField(frameFor(page, f), f).catch(() => null);
    let ok = !!cur?.exists && f.kind !== 'file' && !!cur.value && valuesMatch(f.kind, v.value, cur.value, { display: cur.display, format: f.meta?.format, strict: true });
    if (!ok) {
      const r = await fillField(page, f, v, opts.files);
      if (r.chosen && f.kind !== 'file') v.value = r.chosen;
      ok = r.ok;
    }
    if (ok) {
      intended.set(f.id, { field: f, value: v, page: pageNo });
      filled++;
    } else problems.push(`${f.label || f.labelNorm}: did not take the recipe's value`);
    await opts.rec?.add({ action: s.action === 'submit' ? 'fill' : (s.action as 'fill'), fieldSignature: f.signature, labelNorm: f.labelNorm, widget: f.kind, selectors: f.selectors, valueSource: v.source, valueKey: v.key, step: pageNo, ok, note: 'recipe' });
  };

  const flush = async () => {
    if (!pending.length) return;
    aborted();
    const ex = await extractStep(page, pageNo);
    const res = await resolveSteps(page, pending, ex.fields);
    for (const [fid, s] of res.byField) {
      const f = ex.fields.find((x) => x.id === fid)!;
      let v = recipeValue(s, f, opts.vctx);
      if (!v) {
        // The step names no resolvable key (e.g. "how did you hear"): the mapper decides, as in A05.
        const m = (await mapFieldsWith([f], opts.vctx.packet, { writer: false, job: opts.vctx.job, deps: opts.mapDeps }).catch(() => []))[0];
        v = m && !m.unknown && m.confidence >= MIN_CONFIDENCE ? m : null;
      }
      if (!v) {
        if (f.required) problems.push(`${f.label}: no value for ${s.valueSource}:${s.valueKey}`);
        continue;
      }
      await fillOne(f, { ...v, fieldId: f.id }, s);
    }
    for (const s of res.missing) if (s.labelNorm) problems.push(`recipe step not found on the page: "${s.labelNorm}"`);
    pending = [];
  };

  const click = async (s: RecipeStep): Promise<boolean> => {
    aborted();
    const ref = await agentOp<string | null>(page.mainFrame(), 'find', { selectors: s.selectors }).catch(() => null);
    if (!ref) {
      problems.push(`control not found: ${s.labelNorm ?? s.selectors[0] ?? s.action}`);
      return false;
    }
    const snap = await agentOp<Snapshot>(page.mainFrame(), 'snapshot', { maxText: 10 }).catch(() => null);
    const c = snap?.clickables.find((x) => x.ref === ref);
    const verdict = c ? clickVerdict(c, opts.policy) : ({ ok: false, why: 'control vanished' } as const);
    if (!verdict.ok) {
      problems.push(`refused to click "${c?.name ?? ref}": ${verdict.why}`);
      return false;
    }
    if (s.action === 'next' || verdict.next) {
      const cur = [...intended.values()].filter((x) => x.page === pageNo);
      if (cur.length) {
        const v = await verifyFields(page, cur.map((x) => x.field), cur.map((x) => x.value));
        if (!v.verified) {
          problems.push(...v.problems.slice(0, 3));
          return false;
        }
      }
    }
    const loc = page.locator(`[data-bureau-agent="${ref}"]`).first();
    const go = () => loc.click({ timeout: 5_000 }).then(() => true).catch(() => false);
    const ok = s.action === 'next' || verdict.next ? await withSubmitAllowed(page, go) : await go();
    await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(400).catch(() => {});
    await opts.rec?.add({ action: s.action === 'next' || verdict.next ? 'next' : 'click', labelNorm: c ? labelNorm(c.name) : s.labelNorm, widget: 'button', selectors: s.selectors, step: pageNo, ok, note: 'recipe' });
    if (!ok) problems.push(`could not click "${c?.name ?? ref}"`);
    if (ok && (s.action === 'next' || verdict.next)) pageNo++;
    return ok;
  };

  for (const s of recipe.steps) {
    if (FILLS.has(s.action)) {
      pending.push(s);
      continue;
    }
    await flush();
    if (s.action === 'submit') break;
    if (s.action === 'wait') {
      await page.waitForTimeout(800);
      continue;
    }
    if (s.action === 'click' || s.action === 'next') {
      if (!(await click(s))) return { verified: false, problems, intended: [...intended.values()], filled, page: pageNo };
    }
  }
  await flush();

  // Hooks: company-specific questions answered fresh (answer bank / writer), never baked in.
  if (recipe.hooks.length) {
    const ex = await extractStep(page, pageNo);
    for (const h of recipe.hooks) {
      const f = ex.fields.find((x) => x.signature === h.fieldSignature && !intended.has(x.id)) ?? ex.fields.find((x) => x.labelNorm === h.labelNorm && !intended.has(x.id));
      if (!f) continue;
      const m = (await mapFieldsWith([f], opts.vctx.packet, { writer: true, job: opts.vctx.job, deps: opts.mapDeps }).catch(() => []))[0];
      if (m && !m.unknown && m.confidence >= MIN_CONFIDENCE) await fillOne(f, m, { action: 'fill' });
      else if (f.required) problems.push(`${f.label}: no truthful answer for this company question`);
    }
  }

  // Verify the page the replay ends on: everything it filled there, and every required field.
  const ex = await extractStep(page, pageNo);
  const cur = [...intended.values()].filter((x) => x.page === pageNo);
  const check = [...cur.map((x) => x.field), ...ex.fields.filter((f) => f.required && !intended.has(f.id))];
  const v = check.length ? await verifyFields(page, check, cur.map((x) => x.value)) : { verified: false, problems: ['nothing to verify: the recipe filled no field'], fieldLog: [] };
  const fatal = problems.filter((p) => !p.startsWith('recipe step not found'));
  return { verified: v.verified && !fatal.length && filled > 0, problems: [...fatal, ...v.problems, ...problems.filter((p) => p.startsWith('recipe step not found'))], intended: [...intended.values()], filled, page: pageNo };
}
