import type { AtsFamily } from '../contracts/job.ts';
import type { Recipe } from '../contracts/forms.ts';
import { NotImplemented } from '../contracts/stub.ts';

/** A05 — recipe store (form_recipes). Scope priority: url > company > ats. A06 writes compiled recipes through here. */

export function findRecipe(q: { ats: AtsFamily | null; company?: string; url: string; statuses?: Recipe['status'][] }): Recipe | null {
  void q;
  throw new NotImplemented('A05', 'findRecipe');
}

/** Insert a new recipe, or a new version when one with the same scope exists. Returns its id. */
export function saveRecipe(recipe: Recipe): string {
  void recipe;
  throw new NotImplemented('A05', 'saveRecipe');
}

export function recordRecipeRun(id: string, ok: boolean, detail?: string) {
  void id;
  void ok;
  void detail;
  throw new NotImplemented('A05', 'recordRecipeRun');
}

export function setRecipeStatus(id: string, status: Recipe['status']) {
  void id;
  void status;
  throw new NotImplemented('A05', 'setRecipeStatus');
}

export function listRecipes(): (Recipe & { id: string; successes: number; failures: number; updatedAt: string })[] {
  throw new NotImplemented('A05', 'listRecipes');
}
