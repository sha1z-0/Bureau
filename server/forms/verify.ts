import type { Page } from 'playwright-core';
import type { FieldLogEntry, FieldValue, FormField, VerifyResult } from '../contracts/forms.ts';
import { extractStep, frameFor } from './extract.ts';
import { valuesMatch } from './normalize.ts';
import { inFrame, type RawField, type ReadResult } from './page.ts';

/**
 * Read back every field and compare with what was meant to be there. Checks:
 * each intended value is present (normalised per widget), every required field
 * is non-empty, uploads show their filename, and nothing on the page is flagged
 * invalid. `verified:false` means the engine must never submit.
 */

type VField = FormField & { meta?: RawField['meta'] };

export interface VerifyOptions {
  /** Fields the run deliberately left empty (unknown questions); still reported, never ok. */
  unknownIds?: Set<string>;
  /** Ignore page-level error texts matching this (adapter quirks: e.g. static "required" legends). */
  ignoreErrors?: RegExp;
}

async function readAll(page: Page, fields: VField[], expects: Map<string, string> = new Map()): Promise<Map<string, ReadResult>> {
  const byFrame = new Map<ReturnType<typeof frameFor>, VField[]>();
  for (const f of fields) {
    const fr = frameFor(page, f);
    byFrame.set(fr, [...(byFrame.get(fr) ?? []), f]);
  }
  const out = new Map<string, ReadResult>();
  for (const [fr, list] of byFrame) {
    const res = await inFrame<Record<string, ReadResult>>(fr, 'read', { items: list.map((f) => ({ id: f.id, kind: f.kind, trigger: f.meta?.trigger === 'button', expect: expects.get(f.id) })) }).catch(() => ({}) as Record<string, ReadResult>);
    for (const f of list) out.set(f.id, res[f.id] ?? { exists: false, value: '' });
  }
  return out;
}

export async function pageErrors(page: Page, ignore?: RegExp): Promise<string[]> {
  const msgs: string[] = [];
  for (const fr of page.frames()) {
    if (fr.isDetached()) continue;
    const e = await inFrame<{ messages: string[]; invalid: string[] }>(fr, 'errors').catch(() => null);
    if (!e) continue;
    for (const m of e.messages) if (!ignore?.test(m) && !msgs.includes(m)) msgs.push(m);
    for (const i of e.invalid) msgs.push(`invalid: ${i}`);
  }
  return msgs.filter((m) => !/^\s*\*?\s*(required|indicates a required field|required fields?)\s*\.?$/i.test(m) && !/indicates (a )?required/i.test(m)).slice(0, 10);
}

export async function verifyFields(page: Page, fields: FormField[], intended: (FieldValue & { unknown?: boolean })[], opts: VerifyOptions = {}): Promise<VerifyResult> {
  const vf = fields as VField[];
  const expects = new Map<string, string>();
  for (const v of intended) {
    const f = vf.find((x) => x.id === v.fieldId);
    if (f?.kind === 'file' && v.value) expects.set(f.id, v.value.split(/[\\/]/).pop() ?? v.value);
  }
  const reads = await readAll(page, vf, expects);
  // Fields re-rendered since extraction (SPA re-mounts): re-extract and match by signature.
  const missing = vf.filter((f) => !reads.get(f.id)?.exists);
  if (missing.length) {
    const fresh = (await extractStep(page, fields[0]?.step ?? 0)).fields;
    const remap = new Map<string, VField>();
    for (const m of missing) {
      const twin = fresh.find((f) => f.signature === m.signature) ?? fresh.find((f) => f.labelNorm === m.labelNorm && f.kind === m.kind);
      if (twin) remap.set(m.id, twin);
    }
    if (remap.size) {
      const again = await readAll(page, [...remap.values()], new Map([...remap].map(([oldId, twin]) => [twin.id, expects.get(oldId) ?? ''] as [string, string]).filter(([, e]) => e)));
      for (const [oldId, twin] of remap) reads.set(oldId, again.get(twin.id) ?? { exists: false, value: '' });
    }
  }
  const problems: string[] = [];
  const log: FieldLogEntry[] = [];
  const byId = new Map(intended.map((v) => [v.fieldId, v]));
  for (const f of vf) {
    const want = byId.get(f.id);
    const r = reads.get(f.id) ?? { exists: false, value: '' };
    const shown = r.value || r.display || '';
    let ok = true;
    let note: string | undefined;
    if (!r.exists) {
      ok = false;
      note = 'field disappeared';
    } else if (want && !want.unknown && want.value !== '') {
      ok = valuesMatch(f.kind, want.value, r.value, { display: r.display, chip: r.chip, format: f.meta?.format });
      if (!ok) note = `expected "${want.value.slice(0, 80)}", read "${shown.slice(0, 80)}"`;
      if (!ok && process.env.BUREAU_FORMS_DEBUG === '1') console.log(`    [verify] ${f.id} ${f.kind} ${f.label}: ${JSON.stringify(r).slice(0, 200)} expect=${expects.get(f.id) ?? ''}`);
    } else if (f.required) {
      const empty = !shown.trim() || (f.kind === 'checkbox' || f.kind === 'consent' ? r.value !== 'true' && !r.value.includes(';') && !(f.options?.length && r.value) : false);
      if (empty) {
        ok = false;
        note = want?.unknown ? `required and unanswered: ${(want as { reason?: string }).reason ?? 'unknown'}` : 'required field is empty';
      }
    } else if (!want) {
      // Optional and untouched: not part of the verification ratio.
      continue;
    }
    if (ok && r.invalid) {
      ok = false;
      note = `marked invalid${r.error ? `: ${r.error}` : ''}`;
    }
    if (!ok) problems.push(`${f.label || f.labelNorm}: ${note}`);
    log.push({
      signature: f.signature,
      label: f.label,
      kind: f.kind,
      required: f.required,
      source: want && !want.unknown ? want.source : null,
      key: want && !want.unknown ? want.key : null,
      intended: want && !want.unknown ? (f.kind === 'file' ? want.value.split(/[\\/]/).pop()! : want.value.slice(0, 2000)) : null,
      readBack: f.kind === 'file' ? (r.value || (r.chip ? r.chip.slice(0, 120) : '')) : shown.slice(0, 2000),
      ok,
      note,
    });
  }
  const errs = await pageErrors(page, opts.ignoreErrors);
  for (const e of errs) problems.push(`page shows: ${e}`);
  return { verified: problems.length === 0, problems, fieldLog: log };
}

/** Contract surface. */
export async function verifyForm(page: Page, fields: FormField[], intended: FieldValue[]): Promise<VerifyResult> {
  return verifyFields(page, fields, intended);
}
