import crypto from 'node:crypto';
import { apiKey } from '../ai/claude.ts';
import { deepScan } from '../ai/scout.ts';
import { CampaignConfigSchema } from '../contracts/campaign.ts';
import type { AtsFamily, RawJob } from '../contracts/job.ts';
import { get, getSetting, now, run, setSetting } from '../db.ts';
import { redact } from '../errors.ts';
import { emit } from '../services/bus.ts';
import { loadProfile } from '../services/profileStore.ts';
import { CONNECTORS, sourceSettings } from '../sources/index.ts';
import { RobotsDisallowed } from '../sources/http.ts';
import type { Category, Connector, SourceContext } from '../sources/types.ts';
import { SourceUnavailable } from '../sources/util.ts';
import { mineResearch, weeklyDiscovery } from './discovery.ts';
import { addHealthCounts, recordHealth, sourceHealth, type SourceHealth } from './health.ts';
import { addStats, emptyStats, ingestJobs, isKnownUrl, sweepStale, type DedupeStats, type IngestResult } from './ingest.ts';
import { discoverUrls, recordBoard, seedRegistry, targetsForAts } from './registry.ts';
import { resolveApplyUrls, type ResolveStats } from './resolve.ts';
import { scoutSettings } from './settings.ts';

/**
 * A01 — finds the jobs. `runScout()` is the scan path: every enabled source
 * runs concurrently (per-host politeness lives in sources/http.ts), aggregator
 * links are resolved to employer ATS URLs, postings are normalised, deduped
 * (URL → fingerprint → embeddings), filtered for ghosts and scams, prioritised
 * for freshness, inserted, and entered into the pipeline at `found`.
 */

export { sourceHealth };
export type { SourceHealth };

export interface ScoutOptions {
  campaignId?: string;
  /** Run only these connector ids (plus 'deepscan' for Claude's web search). Ignores enable switches. */
  sources?: string[];
  /** Line logger (the v1 scanner passes its own). */
  log?: (message: string) => void;
  /** Write a row in `scans` (kind 'scout'). Default true; the v1 scanner keeps its own row. */
  recordScan?: boolean;
}

export interface ConnectorOutcome {
  found: number;
  added: number;
  dupes: number;
  ms: number;
  error: string | null;
  unavailable: boolean;
  boardsOk: number;
  boardsFailed: number;
}

export interface ScoutRunResult {
  id: string;
  startedAt: string;
  finishedAt: string;
  ms: number;
  found: number;
  added: string[];
  stats: DedupeStats;
  connectors: Record<string, ConnectorOutcome>;
  resolve: ResolveStats;
  registry: { seeded: number; discovered: number; signals: number; boardsPolled: number };
  staleMarked: number;
  /** Jobs first found in the last 24 hours (all runs): the "unique postings per day" figure. */
  uniqueLast24h: number;
}

let current: Promise<ScoutRunResult> | null = null;

export function scoutRunning(): boolean {
  return current !== null;
}

/** Pull from every enabled source, resolve, normalise, dedupe, filter and insert. Emits pipeline.state → found per new job. */
export async function runScout(opts: { campaignId?: string; sources?: string[] } = {}): Promise<{ found: number; added: string[] }> {
  const r = await scoutPipeline(opts);
  return { found: r.found, added: r.added };
}

/** The full run with its report. A call while a run is in flight joins that run. */
export function scoutPipeline(opts: ScoutOptions = {}): Promise<ScoutRunResult> {
  if (current) return current;
  current = doRun(opts).finally(() => {
    current = null;
  });
  return current;
}

export function lastScoutRun(): ScoutRunResult | null {
  return getSetting<ScoutRunResult | null>('scout.lastRun', null);
}

interface RunConfig {
  categories: Category[];
  roles: string[];
  locations: string[];
  remoteOnly: boolean;
  maxAgeDays: number;
  overrides: Record<string, boolean>;
}

function runConfig(campaignId?: string): RunConfig {
  const s = sourceSettings();
  if (campaignId) {
    const row = get<{ config: string }>('SELECT config FROM campaigns WHERE id = ?', campaignId);
    let raw: unknown = null;
    try {
      raw = row ? JSON.parse(row.config) : null;
    } catch {
      raw = null;
    }
    const parsed = raw ? CampaignConfigSchema.safeParse(raw) : null;
    if (parsed?.success) {
      const c = parsed.data;
      return {
        categories: c.categories.length ? c.categories : ['software'],
        roles: c.roles,
        locations: c.locations,
        remoteOnly: c.remoteOnly,
        maxAgeDays: c.maxAgeDays,
        overrides: c.sources,
      };
    }
  }
  const profile = loadProfile();
  const prefs = profile?.preferences;
  const categories: Category[] = prefs?.categories.length ? prefs.categories : profile?.categories.length ? profile.categories : ['web', 'security', 'mobile', 'game'];
  return {
    categories,
    roles: [...(prefs?.targetRoles.length ? prefs.targetRoles : (profile?.targetRoles ?? [])), ...s.extraKeywords],
    locations: prefs?.locations ?? [],
    remoteOnly: !!prefs?.remoteOnly,
    maxAgeDays: s.maxAgeDays,
    overrides: {},
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function doRun(opts: ScoutOptions): Promise<ScoutRunResult> {
  const id = crypto.randomUUID();
  const startedAt = now();
  const t0 = Date.now();
  const recordScan = opts.recordScan !== false;
  const lines: string[] = [];
  const log = (m: string) => {
    if (opts.log) return opts.log(m);
    const line = `${new Date().toLocaleTimeString('en-GB')}  ${redact(m)}`;
    lines.push(line);
    if (recordScan) run('UPDATE scans SET log = ? WHERE id = ?', JSON.stringify(lines.slice(-400)), id);
    emit({ type: 'scan', scanId: id, status: 'running', message: line });
  };
  if (recordScan) run('INSERT INTO scans (id, kind, status, started_at) VALUES (?, ?, ?, ?)', id, 'scout', 'running', startedAt);

  try {
    const result = await pipeline(id, startedAt, t0, opts, log);
    if (recordScan) {
      run("UPDATE scans SET status = 'done', finished_at = ?, found = ?, added = ? WHERE id = ?", now(), result.found, result.added.length, id);
      emit({ type: 'scan', scanId: id, status: 'done', found: result.found, added: result.added.length });
    }
    return result;
  } catch (err) {
    const message = redact((err as Error).message);
    log(`Scout stopped: ${message}`);
    if (recordScan) {
      run("UPDATE scans SET status = 'failed', finished_at = ?, error = ? WHERE id = ?", now(), message, id);
      emit({ type: 'scan', scanId: id, status: 'failed', message });
    }
    throw err;
  }
}

async function pipeline(id: string, startedAt: string, t0: number, opts: ScoutOptions, log: (m: string) => void): Promise<ScoutRunResult> {
  const settings = scoutSettings();
  const cfg = runConfig(opts.campaignId);
  const seeded = seedRegistry().added;
  if (seeded) log(`Registry seeded with ${seeded} companies`);

  const enabled = { ...sourceSettings().enabled, ...cfg.overrides };
  const wanted = opts.sources?.length ? new Set(opts.sources) : null;
  const active: Connector[] = CONNECTORS.filter((c) => (wanted ? wanted.has(c.id) : enabled[c.id]));
  const runDeep = wanted ? wanted.has('deepscan') : cfg.overrides.deepscan === true;
  log(`Scout: ${active.length} sources${runDeep ? ' + deep scan' : ''} · ${cfg.categories.join(', ')} · last ${cfg.maxAgeDays} days`);

  let stats = emptyStats();
  const added: string[] = [];
  const outcomes: Record<string, ConnectorOutcome> = {};
  const resolveStats: ResolveStats = { tried: 0, resolved: 0, skippedKnown: 0, failed: 0 };
  const resolveBudget = { left: settings.resolvePerRun };
  const resolveDeadline = Date.now() + 8 * 60_000;
  let discovered = 0;
  let signals = 0;
  let boardsPolled = 0;
  const pendingDiscovery: { urls: string[]; via: string }[] = [];
  const flushDiscovery = () => {
    while (pendingDiscovery.length) {
      const d = pendingDiscovery.shift()!;
      try {
        discovered += discoverUrls(d.urls, d.via);
      } catch (err) {
        log(`Discovery failed: ${(err as Error).message}`);
      }
    }
  };
  const ingestOpts = { maxAgeDays: cfg.maxAgeDays, campaignId: opts.campaignId ?? null, freshHours: settings.freshHours, embedThreshold: settings.embedThreshold, embeddings: true };
  // SQLite transactions can't interleave: ingest batches one at a time.
  let chain: Promise<unknown> = Promise.resolve();
  const ingestSerial = (raw: RawJob[]): Promise<IngestResult> => {
    const p = chain.then(() => {
      flushDiscovery();
      return ingestJobs(raw, ingestOpts);
    });
    chain = p.catch(() => {});
    return p;
  };

  const runOne = async (c: Connector) => {
    const started = Date.now();
    const out: ConnectorOutcome = { found: 0, added: 0, dupes: 0, ms: 0, error: null, unavailable: false, boardsOk: 0, boardsFailed: 0 };
    outcomes[c.id] = out;
    const ctx: SourceContext = {
      keywords: cfg.roles,
      categories: cfg.categories,
      boards: sourceSettings().boards,
      maxAgeDays: cfg.maxAgeDays,
      log,
      roles: cfg.roles,
      locations: cfg.locations,
      remoteOnly: cfg.remoteOnly,
      detailBudget: settings.detailBudget,
      detailTotal: { left: settings.detailPerRun },
      workdayPages: settings.workdayPages,
      targets: (ats: AtsFamily) => targetsForAts(ats, settings.boardsPerRun[ats] ?? settings.defaultBoardsPerRun),
      reportBoard: (ats, token, report) => {
        boardsPolled++;
        if (report.ok) out.boardsOk++;
        else out.boardsFailed++;
        try {
          if (recordBoard(ats, token, report)) signals++;
        } catch {
          /* bookkeeping only */
        }
      },
      discover: (urls, via) => pendingDiscovery.push({ urls, via }),
      isKnown: isKnownUrl,
    };
    try {
      const raw = await withTimeout(c.run(ctx), c.timeoutMs ?? 10 * 60_000, c.label);
      out.found = raw.length;
      const r = await resolveApplyUrls(raw, {
        budget: resolveBudget,
        deadline: resolveDeadline,
        isKnown: isKnownUrl,
        discover: (u, v) => pendingDiscovery.push({ urls: u, via: v }),
      });
      for (const k of Object.keys(resolveStats) as (keyof ResolveStats)[]) resolveStats[k] += r[k];
      const res = await ingestSerial(raw);
      stats = addStats(stats, res.stats);
      added.push(...res.added);
      out.added = res.stats.inserted;
      out.dupes = res.stats.merged + res.stats.dupBatchUrl + res.stats.dupBatchFingerprint + res.stats.dupEmbedding;
      out.ms = Date.now() - started;
      recordHealth(c.id, { ok: true, found: out.found, added: out.added, dupes: out.dupes, ms: out.ms, boardsOk: out.boardsOk, boardsFailed: out.boardsFailed });
      log(
        `${c.label}: ${out.found} postings → ${out.added} new, ${out.dupes} duplicates` +
          (out.boardsOk + out.boardsFailed ? ` (${out.boardsOk} boards ok, ${out.boardsFailed} failed)` : '') +
          ` · ${(out.ms / 1000).toFixed(1)}s` +
          (r.resolved ? ` · ${r.resolved} resolved to employer ATS` : ''),
      );
    } catch (err) {
      out.ms = Date.now() - started;
      out.unavailable = err instanceof SourceUnavailable || err instanceof RobotsDisallowed;
      out.error = redact((err as Error).message).slice(0, 400);
      recordHealth(c.id, { ok: false, found: out.found, ms: out.ms, lastError: out.error, unavailable: out.unavailable, boardsOk: out.boardsOk, boardsFailed: out.boardsFailed });
      log(`${c.label}: ${out.unavailable ? 'unavailable' : 'failed'} — ${out.error}`);
    }
    emit({ type: 'jobs-changed' });
  };

  // Connector-level concurrency (per-host limits apply underneath).
  const queue = [...active];
  await Promise.all(
    Array.from({ length: Math.min(settings.concurrency, queue.length) }, async () => {
      while (queue.length) await runOne(queue.shift()!);
    }),
  );

  if (runDeep) {
    const started = Date.now();
    const profile = loadProfile();
    try {
      if (!profile) throw new SourceUnavailable('Deep scan needs a profile (upload a CV).');
      if (!apiKey() && process.env.BUREAU_REPLAY !== '1') throw new SourceUnavailable('Deep scan needs an Anthropic API key.');
      const raw = await deepScan(profile, cfg.roles.join(', '), cfg.maxAgeDays, log, (found) => {
        const m = mineResearch(found.text, found.sources);
        discovered += m.boards;
        signals += m.funding;
      });
      pendingDiscovery.push({ urls: raw.map((j) => j.url), via: 'deepscan' });
      const res = await ingestSerial(raw);
      stats = addStats(stats, res.stats);
      added.push(...res.added);
      outcomes.deepscan = { found: raw.length, added: res.stats.inserted, dupes: res.stats.merged, ms: Date.now() - started, error: null, unavailable: false, boardsOk: 0, boardsFailed: 0 };
      recordHealth('deepscan', { ok: true, found: raw.length, added: res.stats.inserted, dupes: res.stats.merged, ms: Date.now() - started });
    } catch (err) {
      const unavailable = err instanceof SourceUnavailable;
      const msg = redact((err as Error).message).slice(0, 400);
      outcomes.deepscan = { found: 0, added: 0, dupes: 0, ms: Date.now() - started, error: msg, unavailable, boardsOk: 0, boardsFailed: 0 };
      recordHealth('deepscan', { ok: false, ms: Date.now() - started, lastError: msg, unavailable });
      log(`Deep scan: ${unavailable ? 'unavailable' : 'failed'} — ${msg}`);
    }
  }

  await chain;
  flushDiscovery();
  const staleMarked = sweepStale(cfg.maxAgeDays);
  for (const [cid, o] of Object.entries(outcomes)) if (!o.error) addHealthCounts(cid, o.added, o.dupes);

  try {
    const d = await weeklyDiscovery({ categories: cfg.categories, roles: cfg.roles, log });
    discovered += d.added;
  } catch (err) {
    log(`Weekly discovery skipped: ${redact((err as Error).message).slice(0, 200)}`);
  }

  const uniqueLast24h = get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs WHERE found_at >= ?', new Date(Date.now() - 86_400_000).toISOString())?.n ?? 0;
  const found = Object.values(outcomes).reduce((n, o) => n + o.found, 0);
  const result: ScoutRunResult = {
    id,
    startedAt,
    finishedAt: now(),
    ms: Date.now() - t0,
    found,
    added,
    stats,
    connectors: outcomes,
    resolve: resolveStats,
    registry: { seeded, discovered, signals, boardsPolled },
    staleMarked,
    uniqueLast24h,
  };
  const s = stats;
  log(
    `Dedupe: ${s.received} received · ${s.invalid} invalid · ${s.stale} stale · ${s.irrelevant} not tech · ` +
      `${s.dupBatchUrl + s.dupBatchFingerprint} in-run duplicates (url ${s.dupBatchUrl}, fingerprint ${s.dupBatchFingerprint}) · ` +
      `${s.dupDbUrl + s.dupDbFingerprint} already known (url ${s.dupDbUrl}, fingerprint ${s.dupDbFingerprint}) · ${s.dupEmbedding} embedding duplicates · ` +
      `${s.inserted} new unique (${s.fresh} under ${settings.freshHours}h, ${s.atsApply} with employer ATS link; ghost ${s.ghost}, scam ${s.scam}, suspect ${s.suspect})`,
  );
  log(
    `Registry: ${boardsPolled} boards polled, ${discovered} new boards discovered, ${signals} hiring signals · ` +
      `resolver ${resolveStats.resolved}/${resolveStats.tried} · ${uniqueLast24h} unique postings found in the last 24h · ${(result.ms / 1000).toFixed(0)}s`,
  );
  setSetting('scout.lastRun', { ...result, added: result.added.slice(0, 2000) });
  emit({ type: 'activity', message: `Scout found ${added.length} new roles (${found} postings from ${active.length} sources)` });
  emit({ type: 'jobs-changed' });
  return result;
}
