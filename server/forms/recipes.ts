import crypto from 'node:crypto';
import type { AtsFamily } from '../contracts/job.ts';
import { RecipeSchema, type Recipe } from '../contracts/forms.ts';
import { all, get, now, run, tx } from '../db.ts';
import { emit } from '../services/bus.ts';
import { effectiveUrl } from './detect.ts';
import { companyKey } from './normalize.ts';
import './schema.ts';

/**
 * A05 — recipe store (`form_recipes`). Scope priority: url > company > ats.
 * A06 writes compiled recipes through `saveRecipe`. Runs are recorded in
 * `form_recipe_runs`; two consecutive failures demote a recipe.
 *
 * URL-scope keys are patterns: `*` matches anything, everything else is literal,
 * compared against the URL without query or fragment (a leading `^` makes it a
 * regular expression). Company keys are normalised company names
 * (`companyKey()`), ATS keys are the family name.
 */

export const DEMOTE_AFTER = 2;

interface Row {
  id: string;
  ats: string;
  scope: Recipe['scope'];
  scope_key: string;
  version: number;
  recipe: string;
  status: Recipe['status'];
  successes: number;
  failures: number;
  created_at: string;
  updated_at: string;
}

export type StoredRecipe = Recipe & { id: string; successes: number; failures: number; updatedAt: string };

function toRecipe(r: Row): StoredRecipe {
  const body = JSON.parse(r.recipe) as Partial<Recipe>;
  const parsed = RecipeSchema.parse({ ...body, id: r.id, ats: r.ats, scope: r.scope, scopeKey: r.scope_key, version: r.version, status: r.status });
  return { ...parsed, id: r.id, successes: r.successes, failures: r.failures, updatedAt: r.updated_at };
}

function bareUrl(u: string): string {
  try {
    const x = new URL(effectiveUrl(u));
    return `${x.origin}${x.pathname}`.replace(/\/$/, '');
  } catch {
    return u.split(/[?#]/)[0].replace(/\/$/, '');
  }
}

export function urlMatches(pattern: string, url: string): boolean {
  const target = bareUrl(url);
  if (pattern.startsWith('^')) {
    try {
      return new RegExp(pattern).test(target);
    } catch {
      return false;
    }
  }
  const pat = pattern.split(/[?#]/)[0].replace(/\/$/, '');
  const re = new RegExp(`^${pat.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
  return re.test(target) || re.test(target.replace(/^https?:\/\//, ''));
}

export function findRecipe(q: { ats: AtsFamily | null; company?: string; url: string; statuses?: Recipe['status'][] }): Recipe | null {
  const statuses = q.statuses?.length ? q.statuses : (['active'] as Recipe['status'][]);
  const marks = statuses.map(() => '?').join(',');
  const pickLatest = (rows: Row[]) => {
    const ok = rows.filter((r) => {
      const rec = toRecipe(r);
      return !rec.match.urlPattern || urlMatches(rec.match.urlPattern, q.url);
    });
    ok.sort((a, b) => b.version - a.version || b.updated_at.localeCompare(a.updated_at));
    return ok[0] ? toRecipe(ok[0]) : null;
  };
  // 1. URL scope.
  const urlRows = all<Row>(`SELECT * FROM form_recipes WHERE scope = 'url' AND status IN (${marks})`, ...statuses).filter((r) => urlMatches(r.scope_key, q.url));
  const byUrl = pickLatest(urlRows);
  if (byUrl) return byUrl;
  // 2. Company scope.
  const ck = companyKey(q.company ?? '');
  if (ck) {
    const byCompany = pickLatest(all<Row>(`SELECT * FROM form_recipes WHERE scope = 'company' AND scope_key = ? AND status IN (${marks})${q.ats ? ' AND ats = ?' : ''}`, ck, ...statuses, ...(q.ats ? [q.ats] : [])));
    if (byCompany) return byCompany;
  }
  // 3. ATS scope.
  if (q.ats) {
    const byAts = pickLatest(all<Row>(`SELECT * FROM form_recipes WHERE scope = 'ats' AND scope_key = ? AND status IN (${marks})`, q.ats, ...statuses));
    if (byAts) return byAts;
  }
  return null;
}

function normaliseKey(recipe: Recipe): string {
  if (recipe.scope === 'company') return companyKey(recipe.scopeKey);
  if (recipe.scope === 'ats') return recipe.ats;
  return recipe.scopeKey.trim();
}

/** Insert a new recipe, or a new version when one with the same scope exists. Returns its id. */
export function saveRecipe(recipe: Recipe): string {
  const r = RecipeSchema.parse(recipe);
  const key = normaliseKey(r);
  const id = crypto.randomUUID();
  return tx(() => {
    const prev = get<{ v: number | null }>('SELECT MAX(version) AS v FROM form_recipes WHERE ats = ? AND scope = ? AND scope_key = ?', r.ats, r.scope, key)?.v ?? 0;
    const version = prev ? prev + 1 : Math.max(1, r.version);
    const body = { ...r, id: undefined, scopeKey: key, version };
    const ts = now();
    run(
      `INSERT INTO form_recipes (id, ats, scope, scope_key, version, recipe, status, successes, failures, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      id,
      r.ats,
      r.scope,
      key,
      version,
      JSON.stringify(body),
      r.status,
      ts,
      ts,
    );
    // A new active version supersedes older active ones of the same scope.
    if (r.status === 'active') {
      run("UPDATE form_recipes SET status = 'demoted', updated_at = ? WHERE ats = ? AND scope = ? AND scope_key = ? AND id <> ? AND status = 'active'", ts, r.ats, r.scope, key, id);
    }
    return id;
  });
}

/** Record one run of a recipe. Two consecutive failures demote it. */
export function recordRecipeRun(id: string, ok: boolean, detail?: string) {
  const row = get<Row>('SELECT * FROM form_recipes WHERE id = ?', id);
  if (!row) return;
  const ts = now();
  run('INSERT INTO form_recipe_runs (recipe_id, ok, detail, at) VALUES (?, ?, ?, ?)', id, ok ? 1 : 0, detail?.slice(0, 1000) ?? null, ts);
  run(`UPDATE form_recipes SET ${ok ? 'successes = successes + 1' : 'failures = failures + 1'}, updated_at = ? WHERE id = ?`, ts, id);
  if (!ok && row.status !== 'demoted' && consecutiveFailures(id) >= DEMOTE_AFTER) {
    setRecipeStatus(id, 'demoted');
    emit({ type: 'activity', message: `Recipe for ${row.ats} (${row.scope}: ${row.scope_key}) demoted after ${DEMOTE_AFTER} failures in a row`, level: 'warn' });
  }
}

export function consecutiveFailures(id: string): number {
  const runs = all<{ ok: number }>('SELECT ok FROM form_recipe_runs WHERE recipe_id = ? ORDER BY id DESC LIMIT 20', id);
  let n = 0;
  for (const r of runs) {
    if (r.ok) break;
    n++;
  }
  return n;
}

export function setRecipeStatus(id: string, status: Recipe['status']) {
  const row = get<Row>('SELECT * FROM form_recipes WHERE id = ?', id);
  if (!row) return;
  run('UPDATE form_recipes SET status = ?, updated_at = ? WHERE id = ?', status, now(), id);
  if (status === 'active' && row.status !== 'active') {
    run("UPDATE form_recipes SET status = 'demoted', updated_at = ? WHERE ats = ? AND scope = ? AND scope_key = ? AND id <> ? AND status = 'active'", now(), row.ats, row.scope, row.scope_key, id);
    emit({ type: 'recipe.promoted', recipeId: id, ats: row.ats, scope: row.scope });
  }
}

export function getRecipe(id: string): StoredRecipe | null {
  const row = get<Row>('SELECT * FROM form_recipes WHERE id = ?', id);
  return row ? toRecipe(row) : null;
}

export function listRecipes(): StoredRecipe[] {
  return all<Row>('SELECT * FROM form_recipes ORDER BY ats, scope, scope_key, version DESC').map(toRecipe);
}

export function recipeRuns(id: string, limit = 50): { ok: boolean; detail: string | null; at: string }[] {
  return all<{ ok: number; detail: string | null; at: string }>('SELECT ok, detail, at FROM form_recipe_runs WHERE recipe_id = ? ORDER BY id DESC LIMIT ?', id, limit).map((r) => ({ ...r, ok: !!r.ok }));
}
