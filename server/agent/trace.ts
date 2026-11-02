import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { DATA_DIR } from '../config.ts';
import { type Trace, TraceSchema, type TraceStep } from '../contracts/agent.ts';
import { all, get, now, run } from '../db.ts';
import './schema.ts';

/**
 * Traces: every agent action with the field signature, label, widget, selector
 * candidates, value source/key, step, URL and before/after screenshots, stored
 * in `agent_traces` with their origin (`internal`, or `external:<keyId>` from
 * A07). Screenshots live in DATA_DIR/agent/traces/<traceId>/ (small JPEGs).
 */

export const TRACE_DIR = path.join(DATA_DIR, 'agent', 'traces');
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;
const SHOTS = process.env.BUREAU_AGENT_SHOTS !== '0';

export class TraceRecorder {
  readonly id = crypto.randomUUID();
  readonly startedAt = now();
  readonly steps: TraceStep[] = [];
  private lastShot: string | undefined;
  private shotN = 0;

  constructor(
    readonly page: Page,
    readonly meta: { jobId: string | null; applicationId: string | null; origin: string; ats: Trace['ats'] },
  ) {}

  /** A small viewport JPEG; the path is relative to DATA_DIR. Best effort. */
  async shot(): Promise<string | undefined> {
    if (!SHOTS) return undefined;
    try {
      const dir = path.join(TRACE_DIR, this.id);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `${String(++this.shotN).padStart(3, '0')}.jpg`);
      await this.page.screenshot({ path: file, type: 'jpeg', quality: 40, timeout: 5_000 });
      this.lastShot = path.relative(DATA_DIR, file).split(path.sep).join('/');
      return this.lastShot;
    } catch {
      return undefined;
    }
  }

  async begin() {
    await this.shot();
  }

  async add(step: Omit<TraceStep, 'i' | 'beforeShot' | 'afterShot' | 'url'> & { url?: string }, opts: { shoot?: boolean } = {}) {
    const before = this.lastShot;
    const after = opts.shoot === false ? undefined : await this.shot();
    const s: TraceStep = { ...step, i: this.steps.length, url: step.url ?? this.page.url(), beforeShot: before, afterShot: after ?? before } as TraceStep;
    this.steps.push(s);
    return s;
  }

  toTrace(url: string, outcome: Trace['outcome']): Trace {
    return TraceSchema.parse({
      id: this.id,
      jobId: this.meta.jobId,
      applicationId: this.meta.applicationId,
      origin: this.meta.origin,
      url,
      ats: this.meta.ats,
      steps: this.steps.slice(0, 500),
      outcome,
      startedAt: this.startedAt,
      finishedAt: now(),
    });
  }
}

/** Store a trace (internal or external). Returns its id. */
export function saveTrace(t: Trace): string {
  const id = t.id && SAFE_ID.test(t.id) && !get('SELECT 1 FROM agent_traces WHERE id = ?', t.id) ? t.id : crypto.randomUUID();
  const body: Trace = { ...t, id };
  run(
    'INSERT INTO agent_traces (id, job_id, application_id, origin, url, ats, trace, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    t.jobId,
    t.applicationId,
    t.origin,
    t.url,
    t.ats,
    JSON.stringify(body),
    t.outcome,
    now(),
  );
  return id;
}

interface TraceRow {
  id: string;
  job_id: string | null;
  application_id: string | null;
  origin: string;
  url: string;
  ats: string | null;
  trace: string;
  outcome: string;
  created_at: string;
}

/** A stored trace, re-validated (rows written by others are untrusted input). Null when missing or malformed. */
export function loadTrace(id: string): (Trace & { id: string; createdAt: string }) | null {
  const row = get<TraceRow>('SELECT * FROM agent_traces WHERE id = ?', id);
  if (!row) return null;
  let body: unknown;
  try {
    body = JSON.parse(row.trace);
  } catch {
    return null;
  }
  const parsed = TraceSchema.safeParse({ ...(body as object), id: row.id, origin: row.origin, jobId: row.job_id, applicationId: row.application_id, url: row.url, ats: row.ats, outcome: row.outcome });
  if (!parsed.success) return null;
  return { ...parsed.data, id: row.id, createdAt: row.created_at };
}

export interface TraceSummary {
  id: string;
  jobId: string | null;
  applicationId: string | null;
  origin: string;
  url: string;
  ats: string | null;
  outcome: string;
  steps: number;
  createdAt: string;
  /** Learning queue status (queued / compiled / duplicate / skipped / failed), and the recipe it fed. */
  learning: string | null;
  recipeId: string | null;
}

export function listTraces(opts: { limit?: number; origin?: 'internal' | 'external'; jobId?: string } = {}): TraceSummary[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.origin === 'internal') where.push("t.origin = 'internal'");
  if (opts.origin === 'external') where.push("t.origin LIKE 'external:%'");
  if (opts.jobId) {
    where.push('t.job_id = ?');
    params.push(opts.jobId);
  }
  const rows = all<TraceRow & { status: string | null; recipe_id: string | null }>(
    `SELECT t.*, l.status, l.recipe_id FROM agent_traces t LEFT JOIN agent_learning l ON l.trace_id = t.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.created_at DESC LIMIT ?`,
    ...params,
    Math.max(1, Math.min(500, opts.limit ?? 50)),
  );
  return rows.map((r) => {
    let steps = 0;
    try {
      steps = ((JSON.parse(r.trace) as { steps?: unknown[] }).steps ?? []).length;
    } catch {
      steps = 0;
    }
    return { id: r.id, jobId: r.job_id, applicationId: r.application_id, origin: r.origin, url: r.url, ats: r.ats, outcome: r.outcome, steps, createdAt: r.created_at, learning: r.status, recipeId: r.recipe_id };
  });
}

/**
 * Screenshots are served by URL only: `/api/agent/shots/<traceId>-<nnn>.jpg`.
 * A stored path (relative to DATA_DIR) becomes that URL; anything else (external
 * traces never carry screenshots) becomes undefined.
 */
export function shotUrl(rel: string | undefined): string | undefined {
  if (!rel) return undefined;
  const m = rel.match(/^agent\/traces\/([0-9a-f-]{36})\/(\d{3})\.jpg$/);
  return m ? `/api/agent/shots/${m[1]}-${m[2]}.jpg` : undefined;
}

/** The file behind a screenshot name, matched against a strict pattern (no traversal). */
export function shotFile(name: string): string | null {
  const m = name.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{3})\.jpg$/);
  if (!m) return null;
  const p = path.join(TRACE_DIR, m[1], `${m[2]}.jpg`);
  return fs.existsSync(p) ? p : null;
}
