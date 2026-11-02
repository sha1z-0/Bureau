import type { RecipeStep, ValueSource } from '../contracts/forms.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import type { Candidate } from '../forms/candidate.ts';
import type { ExtractedField } from '../forms/extract.ts';
import type { JobInfo, MappedValue } from '../forms/map.ts';
import { profileValue } from '../forms/map.ts';
import { recipeValue } from '../forms/recipeRun.ts';

/**
 * Value keys: the only way the agent can put data into a form. It names a key,
 * Bureau resolves the value from the profile, the packet or the answer bank
 * (through A05's recipe resolver, so compiled recipes resolve exactly the same
 * way). Free-typed facts are impossible by construction.
 *
 *   profile:<key>      a profile fact (A05's synonym keys: first_name, email, linkedin, …)
 *   file:cv | file:letter
 *   writer:coverLetter | writer:<short-answer key from the packet>
 *   generated:consent:privacy | generated:consent:marketing | generated:eeo:decline
 *   suggested          the value A05's mapper found for this very field
 */

export const PROFILE_KEYS: [string, string][] = [
  ['first_name', 'first / given name'],
  ['last_name', 'last / family name'],
  ['middle_name', 'middle name'],
  ['preferred_name', 'preferred name'],
  ['full_name', 'full name'],
  ['email', 'email address'],
  ['phone', 'phone number'],
  ['location', 'where the candidate lives (city, country)'],
  ['city', 'city'],
  ['state', 'state / region'],
  ['country', 'country'],
  ['linkedin', 'LinkedIn URL'],
  ['github', 'GitHub URL'],
  ['portfolio', 'portfolio or personal website URL'],
  ['twitter', 'X / Twitter URL'],
  ['current_company', 'current employer'],
  ['current_title', 'current job title'],
  ['school', 'school / university (latest)'],
  ['degree', 'degree (latest)'],
  ['discipline', 'field of study (latest)'],
  ['work_company', 'employer of a work-history entry'],
  ['work_title', 'job title of a work-history entry'],
  ['work_start', 'start date of a work-history entry'],
  ['work_end', 'end date of a work-history entry'],
  ['work_current', 'whether a work-history entry is current'],
];

export const GENERATED_KEYS: [string, string][] = [
  ['consent:privacy', 'tick a privacy / data-processing / certify-accurate box'],
  ['consent:marketing', 'untick a marketing / job-alert opt-in'],
  ['eeo:decline', 'voluntary demographic question: the decline option'],
];

export interface ValueCtx {
  packet: ApplicationPacket;
  candidate: Candidate | null;
  job: JobInfo | null;
}

export interface CatalogueEntry {
  key: string;
  what: string;
  has: boolean;
}

const DUMMY = { id: 'x', kind: 'text', label: '', labelNorm: '', required: false, step: 0, signature: '' } as never;

/** Every value key the agent may use, with whether Bureau has a value for it. Values themselves are never shown. */
export function catalogue(ctx: ValueCtx): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  const c = ctx.candidate;
  for (const [k, what] of PROFILE_KEYS) out.push({ key: `profile:${k}`, what, has: !!c && !!profileValue(k, c, DUMMY, 0) });
  out.push({ key: 'file:cv', what: 'upload the tailored CV (PDF)', has: !!ctx.packet.cvPdfPath });
  out.push({ key: 'file:letter', what: 'upload the cover letter (PDF)', has: !!ctx.packet.letterPdfPath });
  out.push({ key: 'writer:coverLetter', what: 'the cover letter text (for a text box)', has: !!ctx.packet.coverLetter });
  for (const k of Object.keys(ctx.packet.shortAnswers ?? {})) out.push({ key: `writer:${k}`, what: `pre-written answer to "${k}"`, has: !!ctx.packet.shortAnswers[k] });
  for (const [k, what] of GENERATED_KEYS) out.push({ key: `generated:${k}`, what, has: true });
  return out;
}

const SOURCES = new Set<ValueSource>(['profile', 'answer_bank', 'writer', 'file', 'generated']);

export function parseKey(valueKey: string): { source: ValueSource; key: string } | null {
  const i = valueKey.indexOf(':');
  if (i <= 0) return null;
  const source = valueKey.slice(0, i) as ValueSource;
  const key = valueKey.slice(i + 1).trim();
  if (!SOURCES.has(source) || !key || key.length > 120) return null;
  return { source, key };
}

export function isKnownKey(valueKey: string, ctx: ValueCtx): boolean {
  if (valueKey === 'suggested') return true;
  const p = parseKey(valueKey);
  if (!p) return false;
  if (p.source === 'answer_bank') return /^[\w-]{1,64}$/.test(p.key);
  return catalogue(ctx).some((e) => e.key === valueKey);
}

/** The value a key names for this field, or why there is none. Never a free-typed string. */
export function resolveKey(valueKey: string, field: ExtractedField, ctx: ValueCtx, suggested: Map<string, MappedValue>): { value: MappedValue } | { error: string } {
  if (valueKey === 'suggested') {
    const s = suggested.get(field.id);
    if (!s || s.unknown || !s.value) return { error: `Bureau has no confident value for "${field.label}"` };
    return { value: s };
  }
  if (!isKnownKey(valueKey, ctx)) return { error: `"${valueKey.slice(0, 60)}" is not a value key (values are never typed freely)` };
  const p = parseKey(valueKey)!;
  const step: RecipeStep = { action: 'fill', selectors: [], widget: field.kind, valueSource: p.source, valueKey: p.key };
  const v = recipeValue(step, field, ctx);
  if (!v || !v.value) return { error: `no value for ${valueKey} in this field${field.options?.length ? ' (no option fits)' : ''}` };
  return { value: v };
}

/** The key a mapped value should be recorded under, so a recipe resolves it the same way next time. */
export function keyOf(v: MappedValue): { source: ValueSource; key: string } {
  if (v.source === 'profile' && v.synKey) return { source: 'profile', key: v.synKey };
  return { source: v.source, key: v.key };
}

export async function loadCandidate(): Promise<Candidate | null> {
  const { loadProfile } = await import('../services/profileStore.ts');
  const { candidateFrom } = await import('../forms/candidate.ts');
  const p = loadProfile();
  if (!p) return null;
  let links = {};
  try {
    links = (await import('../profile/links.ts')).getLinks(p);
  } catch {
    /* no links module: links from the CV only */
  }
  return candidateFrom(p, links);
}
