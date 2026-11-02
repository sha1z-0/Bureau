import type { Recipe } from '../contracts/forms.ts';
import { all, get, now, run } from '../db.ts';
import { emit } from '../services/bus.ts';
import type { ExtractedField } from '../forms/extract.ts';
import type { MappedValue } from '../forms/map.ts';
import { valuesMatch, widgetFamily } from '../forms/normalize.ts';
import { recipeValue } from '../forms/recipeRun.ts';
import { getRecipe, setRecipeStatus } from '../forms/recipes.ts';
import type { ValueCtx } from './values.ts';
import './schema.ts';

/**
 * Shadow verification: a candidate recipe runs in dry mode next to a real run
 * (the agent, an adapter, a generic fill): for every step it resolves the field
 * the real run filled and the value the recipe WOULD have used, and compares.
 * Nothing is typed. Three internal matches promote the recipe to `active`
 * (A05 emits `recipe.promoted`); a mismatch keeps it a candidate with its diff;
 * three mismatches discard it (`demoted`). External observations are recorded
 * but never count, so an external trace can never be promoted on its own say-so.
 */

export const PROMOTE_AFTER = 3;
export const DISCARD_AFTER = 3;
/** Share of the recipe's field steps that must be found on the real run's form. */
export const MIN_FOUND = 0.75;

const FILLS = new Set(['fill', 'select', 'check', 'upload']);

export interface Observed {
  field: Pick<ExtractedField, 'id' | 'signature' | 'labelNorm' | 'kind' | 'label' | 'required' | 'step'> & Partial<ExtractedField>;
  value: Pick<MappedValue, 'source' | 'key' | 'value'> & Partial<MappedValue>;
}

export interface ShadowDiff {
  labelNorm: string;
  problem: string;
  recipe?: string;
  observed?: string;
}

export interface ShadowResult {
  recipeId: string;
  ok: boolean;
  found: number;
  total: number;
  diff: ShadowDiff[];
  counted: boolean;
  status: Recipe['status'];
}

/** Compare a recipe's intended values with what a real run used. Pure apart from answer-bank reads. */
export function compareRecipe(recipe: Recipe, observed: Observed[], vctx: ValueCtx): { ok: boolean; found: number; total: number; diff: ShadowDiff[] } {
  const steps = recipe.steps.filter((s) => FILLS.has(s.action));
  const taken = new Set<string>();
  const diff: ShadowDiff[] = [];
  let found = 0;
  for (const s of steps) {
    const o =
      (s.fieldSignature ? observed.find((x) => !taken.has(x.field.id) && x.field.signature === s.fieldSignature) : undefined) ??
      (s.labelNorm ? observed.find((x) => !taken.has(x.field.id) && x.field.labelNorm === s.labelNorm && widgetFamily(x.field.kind) === widgetFamily(s.widget)) : undefined);
    if (!o) continue;
    taken.add(o.field.id);
    found++;
    const want = recipeValue(s, { meta: {}, selectors: [], rawLabel: o.field.label, order: 0, ...o.field } as ExtractedField, vctx);
    const label = s.labelNorm ?? o.field.labelNorm;
    if (!want) {
      diff.push({ labelNorm: label, problem: `the recipe's key ${s.valueSource}:${s.valueKey} resolves to nothing`, observed: o.value.value.slice(0, 80) });
      continue;
    }
    const same = o.field.kind === 'file' ? want.key === o.value.key || baseName(want.value) === baseName(o.value.value) : valuesMatch(o.field.kind, want.value, o.value.value, { strict: false });
    if (!same) diff.push({ labelNorm: label, problem: 'different value', recipe: want.value.slice(0, 80), observed: o.value.value.slice(0, 80) });
  }
  const total = steps.length;
  const enough = total > 0 && found / total >= MIN_FOUND;
  if (!enough) diff.push({ labelNorm: '', problem: `only ${found} of ${total} recipe steps matched fields on this form` });
  return { ok: enough && diff.length === 0, found, total, diff };
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function shadowCounts(recipeId: string): { matches: number; mismatches: number; external: number } {
  const r = get<{ m: number; x: number; e: number }>(
    "SELECT COALESCE(SUM(CASE WHEN source = 'internal' AND ok = 1 THEN 1 ELSE 0 END), 0) AS m, COALESCE(SUM(CASE WHEN source = 'internal' AND ok = 0 THEN 1 ELSE 0 END), 0) AS x, COALESCE(SUM(CASE WHEN source <> 'internal' THEN 1 ELSE 0 END), 0) AS e FROM recipe_shadow_runs WHERE recipe_id = ?",
    recipeId,
  );
  return { matches: Number(r?.m ?? 0), mismatches: Number(r?.x ?? 0), external: Number(r?.e ?? 0) };
}

/** Promote or discard a candidate when its internal shadow runs reach a threshold. Returns the new status. */
export function evaluateCandidate(recipeId: string): Recipe['status'] | null {
  const rec = getRecipe(recipeId);
  if (!rec || (rec.status !== 'candidate' && rec.status !== 'shadow')) return rec?.status ?? null;
  const c = shadowCounts(recipeId);
  if (c.mismatches >= DISCARD_AFTER) {
    setRecipeStatus(recipeId, 'demoted');
    emit({ type: 'activity', level: 'warn', message: `Candidate recipe for ${rec.ats} (${rec.scope}: ${rec.scopeKey}) discarded after ${c.mismatches} shadow mismatches` });
    return 'demoted';
  }
  if (c.matches >= PROMOTE_AFTER) {
    setRecipeStatus(recipeId, 'active');
    emit({ type: 'activity', message: `Recipe for ${rec.ats} (${rec.scope}: ${rec.scopeKey}) promoted after ${c.matches} matching shadow runs` });
    return 'active';
  }
  return rec.status;
}

/** Run one shadow comparison and record it. `source` is `internal` or `external:<keyId>` (never counts). */
export async function shadowVerify(input: { recipe: Recipe & { id?: string }; observed: Observed[]; source: string; ref?: string; vctx: ValueCtx }): Promise<ShadowResult | null> {
  const id = input.recipe.id;
  if (!id) return null;
  const cur = getRecipe(id);
  if (!cur || (cur.status !== 'candidate' && cur.status !== 'shadow')) return null;
  const cmp = compareRecipe(cur, input.observed, input.vctx);
  const internal = input.source === 'internal';
  run('INSERT INTO recipe_shadow_runs (recipe_id, source, ref, ok, found, total, diff, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, internal ? 'internal' : input.source.slice(0, 80), input.ref ?? null, cmp.ok ? 1 : 0, cmp.found, cmp.total, JSON.stringify(cmp.diff.slice(0, 30)), now());
  if (internal && cur.status === 'candidate') setRecipeStatus(id, 'shadow');
  const status = internal ? (evaluateCandidate(id) ?? cur.status) : cur.status;
  return { recipeId: id, ok: cmp.ok, found: cmp.found, total: cmp.total, diff: cmp.diff, counted: internal, status };
}

export function shadowRuns(recipeId: string, limit = 50): { source: string; ref: string | null; ok: boolean; found: number; total: number; diff: ShadowDiff[]; at: string }[] {
  return all<{ source: string; ref: string | null; ok: number; found: number; total: number; diff: string; at: string }>('SELECT source, ref, ok, found, total, diff, at FROM recipe_shadow_runs WHERE recipe_id = ? ORDER BY id DESC LIMIT ?', recipeId, limit).map((r) => ({
    ...r,
    ok: !!r.ok,
    diff: JSON.parse(r.diff) as ShadowDiff[],
  }));
}
