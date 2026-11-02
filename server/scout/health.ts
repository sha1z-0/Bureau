import { getSetting, setSetting } from '../db.ts';
import { CONNECTORS, sourceSettings } from '../sources/index.ts';

/**
 * Per-source health for the UI: ok / slow / failing / unavailable / disabled /
 * idle (never run), with the last error, counts and timing. Persisted under the
 * `scout.health` setting so it survives restarts.
 */

export type HealthStatus = 'ok' | 'slow' | 'failing' | 'unavailable' | 'disabled' | 'idle';

export interface SourceHealth {
  id: string;
  label: string;
  kind: string;
  status: HealthStatus;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  /** Postings the source returned on its last run. */
  found: number;
  /** New jobs inserted from it on its last run. */
  added: number;
  /** Postings that turned out to be duplicates of jobs already known. */
  dupes: number;
  ms: number;
  consecutiveFailures: number;
  /** Per-company boards polled (ATS connectors). */
  boardsOk?: number;
  boardsFailed?: number;
}

export interface HealthRecord {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  found: number;
  added: number;
  dupes: number;
  ms: number;
  consecutiveFailures: number;
  unavailable: boolean;
  boardsOk?: number;
  boardsFailed?: number;
}

const KEY = 'scout.health';
/** A run longer than this counts as slow. */
export const SLOW_MS = 4 * 60_000;

export function healthRecords(): Record<string, HealthRecord> {
  return getSetting<Record<string, HealthRecord>>(KEY, {});
}

export function recordHealth(id: string, patch: Partial<HealthRecord> & { ok: boolean }) {
  const all = healthRecords();
  const prev = all[id] ?? { lastRunAt: null, lastOkAt: null, lastError: null, found: 0, added: 0, dupes: 0, ms: 0, consecutiveFailures: 0, unavailable: false };
  const { ok, ...rest } = patch;
  const ts = new Date().toISOString();
  all[id] = {
    ...prev,
    ...rest,
    lastRunAt: ts,
    lastOkAt: ok ? ts : prev.lastOkAt,
    lastError: ok ? null : (rest.lastError ?? prev.lastError),
    consecutiveFailures: ok ? 0 : prev.consecutiveFailures + 1,
    unavailable: !!rest.unavailable,
  };
  setSetting(KEY, all);
}

/** Add insert/dupe counts once ingestion has attributed them. */
export function addHealthCounts(id: string, added: number, dupes: number) {
  const all = healthRecords();
  if (!all[id]) return;
  all[id].added = added;
  all[id].dupes = dupes;
  setSetting(KEY, all);
}

export function statusOf(rec: HealthRecord | undefined, enabled: boolean): HealthStatus {
  if (!enabled) return 'disabled';
  if (!rec || !rec.lastRunAt) return 'idle';
  if (rec.unavailable) return 'unavailable';
  if (rec.lastError && rec.consecutiveFailures > 0) return 'failing';
  if (rec.ms > SLOW_MS) return 'slow';
  return 'ok';
}

export function sourceHealth(): SourceHealth[] {
  const recs = healthRecords();
  const enabled = sourceSettings().enabled;
  const rows: SourceHealth[] = CONNECTORS.map((c) => {
    const r = recs[c.id];
    return {
      id: c.id,
      label: c.label,
      kind: c.kind,
      status: statusOf(r, enabled[c.id] ?? c.defaultEnabled),
      lastRunAt: r?.lastRunAt ?? null,
      lastOkAt: r?.lastOkAt ?? null,
      lastError: r?.lastError ?? null,
      found: r?.found ?? 0,
      added: r?.added ?? 0,
      dupes: r?.dupes ?? 0,
      ms: r?.ms ?? 0,
      consecutiveFailures: r?.consecutiveFailures ?? 0,
      boardsOk: r?.boardsOk,
      boardsFailed: r?.boardsFailed,
    };
  });
  const deep = recs.deepscan;
  rows.push({
    id: 'deepscan',
    label: 'Claude deep scan',
    kind: 'search',
    status: deep ? statusOf(deep, true) : 'idle',
    lastRunAt: deep?.lastRunAt ?? null,
    lastOkAt: deep?.lastOkAt ?? null,
    lastError: deep?.lastError ?? null,
    found: deep?.found ?? 0,
    added: deep?.added ?? 0,
    dupes: deep?.dupes ?? 0,
    ms: deep?.ms ?? 0,
    consecutiveFailures: deep?.consecutiveFailures ?? 0,
  });
  return rows;
}
