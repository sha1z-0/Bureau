import type { Trace } from '../contracts/agent.ts';
import type { AtsFamily } from '../contracts/job.ts';
import type { FieldValue, FormField, Recipe } from '../contracts/forms.ts';
import type { Answered } from '../contracts/profile.ts';
import type { ApplicationPacket, WriteResult } from '../contracts/writer.ts';

/**
 * The API's seam to other modules. Production resolves each function lazily
 * from its owner (so `npm run mcp` never loads the browser stack); tests swap
 * in fakes with `setApiDeps`. A module still on its Phase 0 stub throws
 * NotImplemented, which the service turns into a 503 UNAVAILABLE.
 */
export interface ApiDeps {
  /** A04 */
  writeApplication(jobId: string, campaignId: string): Promise<WriteResult>;
  /** A04 */
  answerQuestion(jobId: string, question: string, opts: { maxChars?: number; options?: string[] }): Promise<Answered | null>;
  /** A05: deterministic synonyms map. */
  mapFields(fields: FormField[], packet: ApplicationPacket): Promise<FieldValue[]>;
  /** A05 */
  detectAts(url: string): AtsFamily | null;
  /** A05 */
  findRecipe(q: { ats: AtsFamily | null; company?: string; url: string; statuses?: Recipe['status'][] }): Recipe | null;
  /** A06 */
  submitExternalTrace(trace: Trace, keyId: string): string;
  /** A03 */
  answerFor(question: string, ctx: { jobId?: string; fieldKind?: string; options?: string[] }): Promise<Answered | null>;
  /** A03 */
  recordUnknown(q: { question: string; jobId: string | null; fieldKind: string; options?: string[] }): string;
  /** A03 */
  normalizeQuestion(raw: string): string;
}

function realDeps(): ApiDeps {
  return {
    writeApplication: async (jobId, campaignId) => (await import('../writer/index.ts')).writeApplication(jobId, campaignId),
    answerQuestion: async (jobId, question, opts) => (await import('../writer/index.ts')).answerQuestion(jobId, question, opts),
    mapFields: async (fields, packet) => (await import('../forms/index.ts')).mapFields(fields, packet),
    detectAts: (url) => formsMod!.detectAts(url),
    findRecipe: (q) => recipesMod!.findRecipe(q),
    submitExternalTrace: (trace, keyId) => agentMod!.submitExternalTrace(trace, keyId),
    answerFor: async (question, ctx) => (await import('../profile/index.ts')).answerFor(question, ctx),
    recordUnknown: (q) => profileMod!.recordUnknown(q),
    normalizeQuestion: (raw) => profileMod!.normalizeQuestion(raw),
  };
}

// Synchronous contract functions need their modules loaded up front; `loadApiModules()` does that once.
let formsMod: typeof import('../forms/index.ts') | null = null;
let recipesMod: typeof import('../forms/recipes.ts') | null = null;
let agentMod: typeof import('../agent/index.ts') | null = null;
let profileMod: typeof import('../profile/index.ts') | null = null;
let loading: Promise<void> | null = null;

export function loadApiModules(): Promise<void> {
  loading ??= (async () => {
    [formsMod, recipesMod, agentMod, profileMod] = await Promise.all([
      import('../forms/index.ts'),
      import('../forms/recipes.ts'),
      import('../agent/index.ts'),
      import('../profile/index.ts'),
    ]);
  })();
  return loading;
}

let current: ApiDeps = realDeps();

export async function apiDeps(): Promise<ApiDeps> {
  await loadApiModules();
  return current;
}

/** Tests: replace some functions. */
export function setApiDeps(over: Partial<ApiDeps>) {
  current = { ...current, ...over };
}

export function resetApiDeps() {
  current = realDeps();
}

export function isNotImplemented(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as Error).name === 'NotImplemented';
}
