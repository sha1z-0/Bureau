import crypto from 'node:crypto';
import { z } from 'zod/v4';
import { FactKind, type ProfileFact } from '../contracts/profile.ts';
import { all, get, getSetting, now, run, setSetting, tx } from '../db.ts';
import { AppError } from '../errors.ts';
import { bump } from './state.ts';
import { normText, sha } from './text.ts';

/**
 * profile_facts: every claim the writer and form engine may use, with where it
 * came from. Synced sources (cv, github, portfolio, linkedin) are reconciled,
 * never overwritten: a fact that disappears from its source is deactivated, a
 * new one is added, an unchanged one keeps its id and date. Manual facts are
 * the owner's and no sync ever touches them. A fact the owner hides stays
 * hidden even if the next sync finds it again.
 */

export type FactSource = ProfileFact['source'];
export type FactKindT = z.infer<typeof FactKind>;

export interface IncomingFact {
  kind: FactKindT;
  text: string;
  sourceRef: string;
  /** Disambiguates identical text in different places (e.g. the same bullet under two roles). */
  context?: string;
}

interface Row {
  id: string;
  kind: string;
  text: string;
  source: FactSource;
  source_ref: string;
  added_at: string;
  active: number;
}

export interface FactView extends ProfileFact {
  /** The owner hid it; syncs won't bring it back. */
  hidden: boolean;
}

const HIDDEN_KEY = 'profile.hiddenFacts';

function hiddenSet(): Set<string> {
  return new Set(getSetting<string[]>(HIDDEN_KEY, []));
}

function saveHidden(ids: Set<string>) {
  setSetting(HIDDEN_KEY, [...ids]);
}

const toFact = (r: Row): ProfileFact => ({
  id: r.id,
  kind: (FactKind.safeParse(r.kind).success ? r.kind : 'other') as FactKindT,
  text: r.text,
  source: r.source,
  sourceRef: r.source_ref,
  addedAt: r.added_at,
  active: r.active === 1,
});

export function factId(source: FactSource, f: IncomingFact): string {
  return `${source}_${sha(`${source}|${f.kind}|${f.context ?? ''}|${normText(f.text)}`, 16)}`;
}

export function activeFacts(): ProfileFact[] {
  return all<Row>('SELECT * FROM profile_facts WHERE active = 1 ORDER BY source, kind, added_at, id').map(toFact);
}

export function listFacts(filter: { source?: FactSource; active?: boolean } = {}): FactView[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.source) {
    where.push('source = ?');
    params.push(filter.source);
  }
  if (filter.active !== undefined) {
    where.push('active = ?');
    params.push(filter.active ? 1 : 0);
  }
  const hidden = hiddenSet();
  return all<Row>(`SELECT * FROM profile_facts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY active DESC, source, kind, added_at, id`, ...params).map(
    (r) => ({ ...toFact(r), hidden: hidden.has(r.id) }),
  );
}

export function getFact(id: string): FactView | null {
  const r = get<Row>('SELECT * FROM profile_facts WHERE id = ?', id);
  return r ? { ...toFact(r), hidden: hiddenSet().has(r.id) } : null;
}

export interface ReconcileResult {
  added: number;
  reactivated: number;
  deactivated: number;
  kept: number;
}

/**
 * Bring the facts of one source (optionally one slice of it, picked by
 * `inScope(sourceRef)`) in line with what the source says now.
 */
export function reconcileFacts(source: FactSource, incoming: IncomingFact[], inScope: (sourceRef: string) => boolean = () => true): ReconcileResult {
  if (source === 'manual') throw new Error('Manual facts are never reconciled');
  const hidden = hiddenSet();
  const out: ReconcileResult = { added: 0, reactivated: 0, deactivated: 0, kept: 0 };
  tx(() => {
    const existing = new Map(
      all<Row>('SELECT * FROM profile_facts WHERE source = ?', source)
        .filter((r) => inScope(r.source_ref))
        .map((r) => [r.id, r]),
    );
    const seen = new Set<string>();
    const ts = now();
    for (const f of incoming) {
      const text = f.text.trim();
      if (!text) continue;
      const id = factId(source, f);
      if (seen.has(id)) continue;
      seen.add(id);
      const cur = existing.get(id) ?? get<Row>('SELECT * FROM profile_facts WHERE id = ?', id);
      if (!cur) {
        run('INSERT INTO profile_facts (id, kind, text, source, source_ref, added_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)', id, f.kind, text.slice(0, 2000), source, f.sourceRef.slice(0, 1000), ts);
        out.added++;
        continue;
      }
      if (cur.source_ref !== f.sourceRef) run('UPDATE profile_facts SET source_ref = ? WHERE id = ?', f.sourceRef.slice(0, 1000), id);
      if (cur.active === 1) out.kept++;
      else if (!hidden.has(id)) {
        run('UPDATE profile_facts SET active = 1 WHERE id = ?', id);
        out.reactivated++;
      }
    }
    for (const [id, r] of existing) {
      if (!seen.has(id) && r.active === 1) {
        run('UPDATE profile_facts SET active = 0 WHERE id = ?', id);
        out.deactivated++;
      }
    }
  });
  bump();
  return out;
}

export const ManualFactInput = z.object({
  kind: FactKind,
  text: z.string().trim().min(2).max(2000),
  sourceRef: z.string().trim().max(1000).default('owner'),
});

export function addManualFact(input: z.input<typeof ManualFactInput>): FactView {
  const f = ManualFactInput.parse(input);
  const dup = get<Row>("SELECT * FROM profile_facts WHERE source = 'manual' AND lower(text) = lower(?)", f.text);
  if (dup) {
    if (dup.active !== 1) run('UPDATE profile_facts SET active = 1 WHERE id = ?', dup.id);
    bump();
    return getFact(dup.id)!;
  }
  const id = `manual_${crypto.randomUUID()}`;
  run("INSERT INTO profile_facts (id, kind, text, source, source_ref, added_at, active) VALUES (?, ?, ?, 'manual', ?, ?, 1)", id, f.kind, f.text, f.sourceRef || 'owner', now());
  bump();
  return getFact(id)!;
}

export const FactPatch = z.object({
  active: z.boolean().optional(),
  text: z.string().trim().min(2).max(2000).optional(),
  kind: FactKind.optional(),
});

/**
 * The owner edits a fact. Synced facts can be hidden or restored but not
 * reworded (they must stay verbatim to their source); rewording one creates a
 * manual fact and hides the original, so the edit survives every later sync.
 */
export function updateFact(id: string, patch: z.input<typeof FactPatch>): FactView {
  const p = FactPatch.parse(patch);
  const cur = getFact(id);
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'No such fact');
  if (cur.source === 'manual') {
    run(
      'UPDATE profile_facts SET text = COALESCE(?, text), kind = COALESCE(?, kind), active = COALESCE(?, active) WHERE id = ?',
      p.text ?? null,
      p.kind ?? null,
      p.active === undefined ? null : p.active ? 1 : 0,
      id,
    );
    bump();
    return getFact(id)!;
  }
  if (p.text !== undefined && normText(p.text) !== normText(cur.text)) {
    setHidden(id, true);
    return addManualFact({ kind: p.kind ?? cur.kind, text: p.text, sourceRef: `edited from ${cur.source}: ${cur.sourceRef}` });
  }
  if (p.active !== undefined) setHidden(id, !p.active);
  return getFact(id)!;
}

/** Hide (deactivate and remember) or restore a fact. */
export function setHidden(id: string, hide: boolean) {
  const hidden = hiddenSet();
  if (hide) hidden.add(id);
  else hidden.delete(id);
  saveHidden(hidden);
  run('UPDATE profile_facts SET active = ? WHERE id = ?', hide ? 0 : 1, id);
  bump();
}

/** Manual facts are deleted; synced ones are hidden instead (deleting them would just bring them back). */
export function deleteFact(id: string): { deleted: boolean; hidden: boolean } {
  const cur = getFact(id);
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'No such fact');
  if (cur.source === 'manual') {
    run('DELETE FROM profile_facts WHERE id = ?', id);
    bump();
    return { deleted: true, hidden: false };
  }
  setHidden(id, true);
  return { deleted: false, hidden: true };
}

/** Facts rendered for a prompt, grouped by kind, each with its source. Stable order so prompts cache. */
export function factsForPrompt(facts: ProfileFact[] = activeFacts()): string {
  const byKind = new Map<string, ProfileFact[]>();
  for (const f of facts) if (f.active) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  const lines: string[] = [];
  for (const kind of FactKind.options) {
    const list = byKind.get(kind);
    if (!list?.length) continue;
    lines.push(`## ${kind}`);
    for (const f of list) lines.push(`- [${f.id}] ${f.text} (source: ${f.source}${f.sourceRef ? ` ${f.sourceRef}` : ''})`);
    lines.push('');
  }
  return lines.join('\n').trim();
}
