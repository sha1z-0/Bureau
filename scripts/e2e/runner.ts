/**
 * The staged e2e pipeline. A stage passes, fails, or is *pending*: it hit a
 * module that still throws NotImplemented, a recording that doesn't exist yet
 * (REPLAY_MISSING), or a contract hook that hasn't merged (pending()). Pending
 * stages don't fail the run unless --strict. A stage whose prerequisites
 * failed is "blocked" (counts as a failure only through its prerequisite).
 */

export type StageStatus = 'pass' | 'fail' | 'pending' | 'blocked' | 'skipped';

export interface StageResult {
  id: string;
  title: string;
  status: StageStatus;
  ms: number;
  /** Why it failed / is pending / blocked. */
  reason: string;
  /** Assertions that held, for the report. */
  notes: string[];
  /** Sub-results (e.g. one per fixture form). */
  items: { name: string; status: StageStatus; detail: string }[];
}

export interface Stage<C> {
  id: string;
  title: string;
  /** Stages that must have passed (or be pending with a fallback) first. */
  needs?: string[];
  /** Stages whose real output this one consumes (no fallback): if one is pending, so is this. */
  consumes?: string[];
  run: (ctx: C, s: StageApi) => Promise<void>;
}

export interface StageApi {
  note: (msg: string) => void;
  /** Record a per-item result; a failed item fails the stage, a pending item makes it pending unless others failed. */
  item: (name: string, status: StageStatus, detail?: string) => void;
  pending: (reason: string) => never;
}

export class PendingError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PendingError';
  }
}

/** Errors that mean "not built yet" rather than "broken". */
export function pendingReason(err: unknown): string | null {
  const e = err as { name?: string; code?: string; message?: string } | null;
  if (!e) return null;
  if (e.name === 'NotImplemented' || e.name === 'PendingError') return e.message ?? e.name;
  if (e.code === 'REPLAY_MISSING') return `needs a Claude recording: ${e.message}`;
  if (e.code === 'REPLAY_FETCH_MISSING') return `needs a feed fixture: ${e.message}`;
  return null;
}

export function errText(err: unknown): string {
  const e = err as Error;
  return (e?.message ?? String(err)).split('\n').slice(0, 3).join(' | ');
}

export async function runStages<C>(stages: Stage<C>[], ctx: C, opts: { only?: string[]; log?: (s: string) => void } = {}): Promise<StageResult[]> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const results = new Map<string, StageResult>();
  for (const st of stages) {
    const res: StageResult = { id: st.id, title: st.title, status: 'pass', ms: 0, reason: '', notes: [], items: [] };
    results.set(st.id, res);
    if (opts.only?.length && !opts.only.some((o) => st.id.includes(o))) {
      res.status = 'skipped';
      res.reason = 'not selected';
      continue;
    }
    const failedDep = (st.needs ?? []).find((d) => ['fail', 'blocked'].includes(results.get(d)?.status ?? 'pass'));
    if (failedDep) {
      res.status = 'blocked';
      res.reason = `needs ${failedDep}`;
      log(`\n▸ ${st.title}\n  ⊘ blocked (${failedDep} failed)`);
      continue;
    }
    const pendingDep = (st.consumes ?? []).find((d) => results.get(d)?.status === 'pending');
    if (pendingDep) {
      res.status = 'pending';
      res.reason = `waits on ${pendingDep} (pending)`;
      log(`\n▸ ${st.title}\n  … pending: waits on ${pendingDep}`);
      continue;
    }
    log(`\n▸ ${st.title}`);
    const api: StageApi = {
      note: (m) => {
        res.notes.push(m);
        log(`  ✓ ${m}`);
      },
      item: (name, status, detail = '') => {
        res.items.push({ name, status, detail });
        const mark = status === 'pass' ? '✓' : status === 'pending' ? '…' : status === 'skipped' ? '–' : '✗';
        log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
      },
      pending: (reason) => {
        throw new PendingError(reason);
      },
    };
    const t0 = Date.now();
    try {
      await st.run(ctx, api);
      const bad = res.items.find((i) => i.status === 'fail');
      const pend = res.items.find((i) => i.status === 'pending');
      if (bad) {
        res.status = 'fail';
        res.reason = `${res.items.filter((i) => i.status === 'fail').length} item(s) failed, first: ${bad.name}: ${bad.detail}`;
      } else if (pend) {
        res.status = 'pending';
        res.reason = `${res.items.filter((i) => i.status === 'pending').length} item(s) pending, first: ${pend.name}: ${pend.detail}`;
      }
    } catch (err) {
      const p = pendingReason(err);
      if (p) {
        res.status = 'pending';
        res.reason = p;
      } else {
        res.status = 'fail';
        res.reason = errText(err);
        if (process.env.BUREAU_E2E_DEBUG) console.error(err);
      }
    }
    res.ms = Date.now() - t0;
    const mark = res.status === 'pass' ? '✓ pass' : res.status === 'pending' ? '… pending' : '✗ FAIL';
    log(`  ${mark} (${(res.ms / 1000).toFixed(1)} s)${res.reason ? `: ${res.reason}` : ''}`);
  }
  return [...results.values()];
}
