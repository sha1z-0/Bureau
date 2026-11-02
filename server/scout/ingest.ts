import crypto from 'node:crypto';
import { cosine, embed, fromBlob, toBlob } from '../ai/embed.ts';
import { ensurePipeline } from '../campaign/pipeline.ts';
import type { AtsFamily, RawJob } from '../contracts/job.ts';
import { all, get, now, run, tx } from '../db.ts';
import { emit } from '../services/bus.ts';
import { canonicalUrl, categorize, normalizeForFingerprint, prefilterScore } from '../services/classify.ts';
import { loadProfile, type Profile } from '../services/profileStore.ts';
import type { Category } from '../sources/types.ts';
import { canonicalApplyUrl, detectAts, employerDomain } from './detect.ts';
import { assessLegitimacy, priorityFor } from './legitimacy.ts';
import { normalizeJob, relevantTitle } from './normalize.ts';
import { companiesWithFreshSignals, upsertCompany } from './registry.ts';

/**
 * Insert-or-merge for scouted postings. Layered dedupe:
 *   1. canonical apply URL (or listing URL)
 *   2. fingerprint: normalised company + title (location left out on purpose:
 *      one role posted in five cities is one application)
 *   3. embeddings: same company, cosine ≥ threshold, compatible titles
 * The richest record wins and every source that carried it is linked in
 * `jobs.sources`. New rows go into the pipeline at `found` via ensurePipeline().
 */

export interface SourceRef {
  source: string;
  externalId: string;
  url: string;
  loc: string;
  seenAt: string;
}

export interface DedupeStats {
  received: number;
  invalid: number;
  stale: number;
  irrelevant: number;
  dupBatchUrl: number;
  dupBatchFingerprint: number;
  dupDbUrl: number;
  dupDbFingerprint: number;
  dupEmbedding: number;
  inserted: number;
  merged: number;
  ghost: number;
  scam: number;
  suspect: number;
  fresh: number;
  atsApply: number;
}

export function emptyStats(): DedupeStats {
  return {
    received: 0,
    invalid: 0,
    stale: 0,
    irrelevant: 0,
    dupBatchUrl: 0,
    dupBatchFingerprint: 0,
    dupDbUrl: 0,
    dupDbFingerprint: 0,
    dupEmbedding: 0,
    inserted: 0,
    merged: 0,
    ghost: 0,
    scam: 0,
    suspect: 0,
    fresh: 0,
    atsApply: 0,
  };
}

export function addStats(a: DedupeStats, b: DedupeStats): DedupeStats {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof DedupeStats)[]) out[k] += b[k];
  return out;
}

export interface IngestOptions {
  maxAgeDays: number;
  campaignId?: string | null;
  freshHours?: number;
  /** Run the embedding layer (async path only). */
  embeddings?: boolean;
  embedThreshold?: number;
  /** Skip the category gate (manual captures keep anything). */
  keepNonTech?: boolean;
  now?: number;
}

export interface IngestResult {
  added: string[];
  stats: DedupeStats;
  /** Per RawJob.source: postings received, inserted, merged into existing rows. */
  perSource: Record<string, { received: number; added: number; dupes: number }>;
}

interface Cand {
  job: RawJob;
  category: Category;
  url: string;
  canonical: string;
  ats: AtsFamily | null;
  fingerprint: string;
  softKey: string;
  companyId: string;
  richness: number;
  refs: SourceRef[];
}

export function fingerprintOf(company: string, title: string): string {
  return crypto.createHash('sha256').update(`${normalizeForFingerprint(company)}|${normalizeForFingerprint(title)}`).digest('hex').slice(0, 32);
}

const TITLE_SYNONYMS: [RegExp, string][] = [
  [/\bsr\.?\b/g, 'senior'],
  [/\bjr\.?\b/g, 'junior'],
  [/\bswe\b/g, 'software engineer'],
  [/\bsde\b/g, 'software engineer'],
  [/\bdev\b/g, 'developer'],
  [/\bml\b/g, 'machine learning'],
  [/\bfront[- ]?end\b/g, 'frontend'],
  [/\bback[- ]?end\b/g, 'backend'],
  [/\bfull[- ]?stack\b/g, 'fullstack'],
];

export function titleTokens(title: string): Set<string> {
  // Unlike the fingerprint, keep bracketed words: "(Payments)" tells two roles apart.
  let t = normalizeForFingerprint(title.replace(/[()[\]]/g, ' '));
  for (const [re, rep] of TITLE_SYNONYMS) t = t.replace(re, rep);
  return new Set(t.split(' ').filter((w) => w.length > 1 && !['and', 'of', 'the', 'for', 'to', 'with', 'in', 'm', 'f', 'd', 'w', 'x'].includes(w)));
}

export function titleSimilarity(a: string, b: string): number {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** How complete a record is; the richest duplicate is the one kept. */
export function richness(j: RawJob, ats: AtsFamily | null): number {
  const desc = (j.descriptionText ?? '').length;
  return (
    Math.min(desc, 6000) / 100 +
    (j.salaryMin || j.salaryMax ? 15 : 0) +
    (ats ? 25 : 0) +
    (j.postedAt ? 5 : 0) +
    (j.location ? 3 : 0) +
    (j.applyEmail ? 3 : 0) +
    (j.companyDomain ? 2 : 0)
  );
}

/** Placeholder employer names that must never merge postings from different employers. */
export function isGenericCompany(name: string): boolean {
  return /^(unknown|confidential|n\/?a|none|hiring|stealth( startup| mode)?|undisclosed|private|company|employer|indie studio|game studio|hn poster|-)?$/i.test(name.trim());
}

function softKeyOf(companyId: string, title: string) {
  return `${companyId}|${[...titleTokens(title)].sort().join(' ')}`;
}

function webUrl(u: string | null | undefined): boolean {
  return !!u && /^https?:\/\//i.test(u);
}

/** Validate, normalise, classify and identify each posting. */
function prepare(raw: RawJob[], opts: IngestOptions, stats: DedupeStats): Cand[] {
  const out: Cand[] = [];
  const ts = new Date(opts.now ?? Date.now()).toISOString();
  for (const r of raw) {
    stats.received++;
    if (!r || !r.title?.trim() || (!webUrl(r.url) && !(r.source === 'capture' && r.url === '') && !webUrl(r.applyUrl))) {
      stats.invalid++;
      continue;
    }
    const job = normalizeJob(r, opts.now);
    if (job.postedAt && (opts.now ?? Date.now()) - Date.parse(job.postedAt) > opts.maxAgeDays * 86_400_000) {
      stats.stale++;
      continue;
    }
    const classified = categorize(job);
    const category = classified && relevantTitle(job.title, classified) ? classified : opts.keepNonTech ? 'software' : null;
    if (!category) {
      stats.irrelevant++;
      continue;
    }
    // The employer's own route: an ATS link wins over a board's listing page.
    const applyHit = webUrl(job.applyUrl) ? detectAts(job.applyUrl!) : null;
    const urlHit = webUrl(job.url) ? detectAts(job.url) : null;
    const ats = job.ats ?? applyHit?.ats ?? urlHit?.ats ?? null;
    const applyRoute = webUrl(job.applyUrl) && (applyHit || !urlHit) ? job.applyUrl! : webUrl(job.url) ? job.url : job.applyUrl ?? '';
    const canonical = applyRoute ? canonicalApplyUrl(applyRoute) : '';
    const url = webUrl(job.url) ? canonicalUrl(job.url) : canonical;
    const domain = job.companyDomain ?? employerDomain(job.applyUrl ?? undefined);
    const hit = applyHit ?? urlHit;
    // "Unknown"/"Confidential" employers are not one company: key them by their posting instead.
    const anonymous = isGenericCompany(job.company) && !(hit?.token && hit.ats !== 'other');
    const companyId = anonymous
      ? null
      : upsertCompany({
          name: job.company,
          ats: hit?.token && hit.ats !== 'other' ? hit.ats : null,
          token: hit?.token && hit.ats !== 'other' ? hit.token : null,
          domain,
          discoveredVia: `job:${job.source}`,
        }).company.id;
    const identity = companyId ?? `anon:${canonical || url}`;
    out.push({
      job: { ...job, companyDomain: domain },
      category,
      url,
      canonical,
      ats: ats === 'other' ? 'other' : ats,
      fingerprint: anonymous ? fingerprintOf(`${job.company} ${identity}`, job.title) : fingerprintOf(job.company, job.title),
      softKey: softKeyOf(identity, job.title),
      companyId: identity,
      richness: richness(job, ats),
      refs: [{ source: job.source, externalId: String(job.externalId ?? ''), url: job.url, loc: normalizeForFingerprint(job.location ?? ''), seenAt: ts }],
    });
  }
  return out;
}

function absorb(keep: Cand, other: Cand): Cand {
  const [rich, poor] = other.richness > keep.richness ? [other, keep] : [keep, other];
  return {
    ...rich,
    // Keep the employer's ATS route whichever record carried it.
    canonical: rich.ats ? rich.canonical : poor.ats ? poor.canonical : rich.canonical,
    ats: rich.ats ?? poor.ats,
    job: {
      ...rich.job,
      salaryMin: rich.job.salaryMin ?? poor.job.salaryMin,
      salaryMax: rich.job.salaryMax ?? poor.job.salaryMax,
      salaryCurrency: rich.job.salaryCurrency ?? poor.job.salaryCurrency,
      applyEmail: rich.job.applyEmail ?? poor.job.applyEmail,
      postedAt: [rich.job.postedAt, poor.job.postedAt].filter(Boolean).sort()[0] ?? null,
      companyDomain: rich.job.companyDomain ?? poor.job.companyDomain,
    },
    refs: [...rich.refs, ...poor.refs],
  };
}

/** In-batch collapse: canonical URL, then fingerprint, then soft key (company id + title tokens). */
function collapse(cands: Cand[], stats: DedupeStats): Cand[] {
  const byUrl = new Map<string, number>();
  const byFp = new Map<string, number>();
  const bySoft = new Map<string, number>();
  const kept: (Cand | null)[] = [];
  for (const c of cands) {
    const urlKeys = [c.canonical, c.url].filter(Boolean);
    let idx = urlKeys.map((k) => byUrl.get(k)).find((i) => i !== undefined);
    if (idx !== undefined) stats.dupBatchUrl++;
    else {
      idx = byFp.get(c.fingerprint) ?? bySoft.get(c.softKey);
      if (idx !== undefined) stats.dupBatchFingerprint++;
    }
    if (idx !== undefined && kept[idx]) {
      kept[idx] = absorb(kept[idx]!, c);
      const k = kept[idx]!;
      for (const u of [k.canonical, k.url, c.canonical, c.url].filter(Boolean)) byUrl.set(u, idx);
      byFp.set(c.fingerprint, idx);
      bySoft.set(c.softKey, idx);
      continue;
    }
    const i = kept.length;
    kept.push(c);
    for (const u of urlKeys) byUrl.set(u, i);
    byFp.set(c.fingerprint, i);
    bySoft.set(c.softKey, i);
  }
  return kept.filter((c): c is Cand => !!c);
}

interface ExistingRow {
  id: string;
  title: string;
  sources: string;
  description_text: string | null;
  salary_min: number | null;
  salary_max: number | null;
  apply_url_canonical: string | null;
  ats: string | null;
  apply_email: string | null;
  posted_at: string | null;
  legitimacy: string | null;
}

const EXISTING_COLS = 'id, title, sources, description_text, salary_min, salary_max, apply_url_canonical, ats, apply_email, posted_at, legitimacy';

function findExisting(c: Cand, softCache: Map<string, { id: string; title: string }[]>): { row: ExistingRow; by: 'url' | 'fingerprint' } | null {
  const keys = [...new Set([c.canonical, c.url].filter(Boolean))];
  for (const k of keys) {
    const row = get<ExistingRow>(`SELECT ${EXISTING_COLS} FROM jobs WHERE apply_url_canonical = ? OR url = ? LIMIT 1`, k, k);
    if (row) return { row, by: 'url' };
  }
  const fp = get<ExistingRow>(`SELECT ${EXISTING_COLS} FROM jobs WHERE fingerprint = ?`, c.fingerprint);
  if (fp) return { row: fp, by: 'fingerprint' };
  let peers = softCache.get(c.companyId);
  if (!peers) {
    peers = all<{ id: string; title: string }>('SELECT id, title FROM jobs WHERE company_id = ?', c.companyId);
    softCache.set(c.companyId, peers);
  }
  const want = c.softKey.split('|')[1];
  const peer = peers.find((p) => [...titleTokens(p.title)].sort().join(' ') === want);
  if (peer) {
    const row = get<ExistingRow>(`SELECT ${EXISTING_COLS} FROM jobs WHERE id = ?`, peer.id);
    if (row) return { row, by: 'fingerprint' };
  }
  return null;
}

function parseRefs(s: string | null): SourceRef[] {
  try {
    const v = JSON.parse(s ?? '[]') as unknown;
    return Array.isArray(v) ? (v as SourceRef[]) : [];
  } catch {
    return [];
  }
}

/** Distinct postings of the same role by one source in one place: the repost count. */
export function repostCount(refs: SourceRef[]): number {
  const groups = new Map<string, Set<string>>();
  for (const r of refs) {
    const k = `${r.source}|${r.loc}`;
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k)!.add(r.externalId);
  }
  return Math.max(0, ...[...groups.values()].map((s) => s.size));
}

function mergeRefs(existing: SourceRef[], incoming: SourceRef[]): SourceRef[] {
  const out = [...existing];
  for (const r of incoming) {
    const same = out.find((e) => e.source === r.source && e.externalId === r.externalId);
    if (same) same.seenAt = r.seenAt;
    else out.push(r);
  }
  return out.slice(-30);
}

/** Merge a duplicate into the stored row: link the source, upgrade fields the new record has and the row lacks. */
function mergeInto(row: ExistingRow, c: Cand, maxAgeDays: number) {
  const refs = mergeRefs(parseRefs(row.sources), c.refs);
  const reposts = repostCount(refs);
  const richer = (c.job.descriptionText ?? '').length > (row.description_text ?? '').length * 1.5 + 200;
  const upgradeApply = !row.ats && c.ats && c.ats !== 'other';
  run(
    `UPDATE jobs SET sources = ?,
       description_text = CASE WHEN ? THEN ? ELSE description_text END,
       description_html = CASE WHEN ? THEN ? ELSE description_html END,
       salary_min = COALESCE(salary_min, ?), salary_max = COALESCE(salary_max, ?), salary_currency = COALESCE(salary_currency, ?),
       apply_url_canonical = CASE WHEN ? OR apply_url_canonical IS NULL THEN ? ELSE apply_url_canonical END,
       ats = CASE WHEN ? OR ats IS NULL THEN ? ELSE ats END,
       apply_email = COALESCE(apply_email, ?),
       legitimacy = CASE WHEN ? >= 3 AND COALESCE(legitimacy, 'ok') IN ('ok', 'suspect') THEN 'ghost' ELSE legitimacy END,
       updated_at = ?
     WHERE id = ?`,
    JSON.stringify(refs),
    richer ? 1 : 0,
    (c.job.descriptionText ?? '').slice(0, 60_000),
    richer ? 1 : 0,
    c.job.descriptionHtml ?? '',
    c.job.salaryMin ?? null,
    c.job.salaryMax ?? null,
    c.job.salaryCurrency ?? null,
    upgradeApply ? 1 : 0,
    c.canonical || null,
    upgradeApply ? 1 : 0,
    c.ats,
    c.job.applyEmail ?? null,
    reposts,
    now(),
    row.id,
  );
  void maxAgeDays;
}

function embedText(j: RawJob): string {
  return `${j.title}\n${j.location}\n${(j.descriptionText ?? '').slice(0, 1200)}`;
}

/**
 * The embedding layer: among new postings that survived URL and fingerprint
 * dedupe, drop those whose vector is ≥ threshold to an existing posting of the
 * same company (and whose titles are compatible). Vectors are only compared
 * within one model.
 */
async function embeddingDedupe(
  fresh: Cand[],
  threshold: number,
  stats: DedupeStats,
): Promise<{ keep: Cand[]; vectors: Map<Cand, Float32Array>; model: string; dupes: { cand: Cand; jobId: string }[] }> {
  const vectors = new Map<Cand, Float32Array>();
  if (!fresh.length) return { keep: [], vectors, model: '', dupes: [] };
  const { model, vectors: vs } = await embed(fresh.map((c) => embedText(c.job)));
  fresh.forEach((c, i) => vectors.set(c, vs[i]));
  const byCompany = new Map<string, { id: string | null; title: string; vec: Float32Array; cand?: Cand }[]>();
  const peersOf = (companyId: string) => {
    let list = byCompany.get(companyId);
    if (!list) {
      list = all<{ job_id: string; vector: Uint8Array; title: string }>(
        'SELECT e.job_id, e.vector, j.title FROM job_embeddings e JOIN jobs j ON j.id = e.job_id WHERE j.company_id = ? AND e.model = ?',
        companyId,
        model,
      ).map((r) => ({ id: r.job_id, title: r.title, vec: fromBlob(r.vector) }));
      byCompany.set(companyId, list);
    }
    return list;
  };
  const keep: Cand[] = [];
  const dupes: { cand: Cand; jobId: string }[] = [];
  for (const c of fresh) {
    const v = vectors.get(c)!;
    const peers = peersOf(c.companyId);
    const match = peers.find((p) => cosine(v, p.vec) >= threshold && titleSimilarity(p.title, c.job.title) >= 0.5);
    if (match) {
      stats.dupEmbedding++;
      if (match.id) dupes.push({ cand: c, jobId: match.id });
      else if (match.cand) Object.assign(match.cand, absorb(match.cand, c));
      continue;
    }
    peers.push({ id: null, title: c.job.title, vec: v, cand: c });
    keep.push(c);
  }
  return { keep, vectors, model, dupes };
}

function insertRow(c: Cand, opts: IngestOptions, profile: Profile | null, signalCompanies: Set<string>, stats: DedupeStats): string {
  const id = crypto.randomUUID();
  const reposts = repostCount(c.refs);
  const hasApplyRoute = !!c.ats || !!c.job.applyEmail || webUrl(c.canonical);
  const verdict = assessLegitimacy({ job: c.job, repostCount: reposts, maxAgeDays: opts.maxAgeDays, hasApplyRoute, fromAts: !!c.ats && c.ats !== 'other', now: opts.now });
  const priority = priorityFor(c.job.postedAt, signalCompanies.has(c.companyId), opts.freshHours ?? 48, opts.now);
  if (verdict.legitimacy === 'ghost') stats.ghost++;
  if (verdict.legitimacy === 'scam') stats.scam++;
  if (verdict.legitimacy === 'suspect') stats.suspect++;
  if (priority >= 2) stats.fresh++;
  if (c.ats && c.ats !== 'other') stats.atsApply++;
  const ts = now();
  run(
    `INSERT INTO jobs (id, fingerprint, source, external_id, url, title, company, location, remote, category,
       description_html, description_text, salary_min, salary_max, salary_currency, tags, posted_at, found_at,
       prefilter_score, apply_email, updated_at, apply_url_canonical, ats, company_id, legitimacy, sources, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    c.fingerprint,
    c.job.source,
    String(c.job.externalId ?? ''),
    c.url,
    c.job.title.slice(0, 300),
    c.job.company.slice(0, 200),
    (c.job.location ?? '').slice(0, 300),
    c.job.remote ? 1 : 0,
    c.category,
    c.job.descriptionHtml ?? '',
    (c.job.descriptionText ?? '').slice(0, 60_000),
    c.job.salaryMin ?? null,
    c.job.salaryMax ?? null,
    c.job.salaryCurrency ?? null,
    JSON.stringify((c.job.tags ?? []).slice(0, 20)),
    c.job.postedAt ?? null,
    ts,
    prefilterScore(c.job, c.category, profile),
    c.job.applyEmail ?? null,
    ts,
    c.canonical || null,
    c.ats,
    c.companyId.startsWith('anon:') ? null : c.companyId,
    verdict.legitimacy,
    JSON.stringify(c.refs),
    priority,
  );
  return id;
}

function bump(perSource: IngestResult['perSource'], source: string, field: 'received' | 'added' | 'dupes') {
  perSource[source] ??= { received: 0, added: 0, dupes: 0 };
  perSource[source][field]++;
}

function finish(added: string[], opts: IngestOptions) {
  for (const id of added) {
    try {
      ensurePipeline(id, opts.campaignId ?? null);
    } catch (err) {
      console.error(`scout: could not enter ${id} into the pipeline: ${(err as Error).message}`);
    }
  }
  if (added.length) emit({ type: 'jobs-changed' });
}

/**
 * The full async path used by the scout: URL + fingerprint + embedding dedupe,
 * legitimacy, priority, insert, embeddings stored, pipeline entry.
 */
export async function ingestJobs(raw: RawJob[], opts: IngestOptions): Promise<IngestResult> {
  const stats = emptyStats();
  const perSource: IngestResult['perSource'] = {};
  for (const r of raw) if (r?.source) bump(perSource, r.source, 'received');
  const profile = loadProfile();
  const signalCompanies = companiesWithFreshSignals();
  // One transaction for the company upserts prepare() makes (thousands of rows on a big run).
  const cands = tx(() => collapse(prepare(raw, opts, stats), stats));
  const softCache = new Map<string, { id: string; title: string }[]>();

  const fresh: Cand[] = [];
  const dbDupes: { cand: Cand; row: ExistingRow }[] = [];
  for (const c of cands) {
    const hit = findExisting(c, softCache);
    if (!hit) fresh.push(c);
    else {
      if (hit.by === 'url') stats.dupDbUrl++;
      else stats.dupDbFingerprint++;
      dbDupes.push({ cand: c, row: hit.row });
    }
  }

  let keep = fresh;
  let vectors = new Map<Cand, Float32Array>();
  let model = '';
  let embedDupes: { cand: Cand; jobId: string }[] = [];
  if (opts.embeddings !== false) {
    const r = await embeddingDedupe(fresh, opts.embedThreshold ?? 0.92, stats);
    keep = r.keep;
    vectors = r.vectors;
    model = r.model;
    embedDupes = r.dupes;
  }

  const added: string[] = [];
  tx(() => {
    for (const d of dbDupes) {
      mergeInto(d.row, d.cand, opts.maxAgeDays);
      stats.merged++;
      for (const ref of d.cand.refs) bump(perSource, ref.source, 'dupes');
    }
    for (const d of embedDupes) {
      const row = get<ExistingRow>(`SELECT ${EXISTING_COLS} FROM jobs WHERE id = ?`, d.jobId);
      if (row) mergeInto(row, d.cand, opts.maxAgeDays);
      stats.merged++;
      for (const ref of d.cand.refs) bump(perSource, ref.source, 'dupes');
    }
    for (const c of keep) {
      const id = insertRow(c, opts, profile, signalCompanies, stats);
      added.push(id);
      stats.inserted++;
      bump(perSource, c.job.source, 'added');
      for (const ref of c.refs.slice(1)) bump(perSource, ref.source, 'dupes');
      const v = vectors.get(c);
      if (v && model) run('INSERT OR REPLACE INTO job_embeddings (job_id, model, vector) VALUES (?, ?, ?)', id, model, toBlob(v));
    }
  });
  finish(added, opts);
  return { added, stats, perSource };
}

/**
 * The synchronous path for v1 callers (manual capture, deep scan): URL and
 * fingerprint dedupe only. Embeddings for the new rows are filled in the
 * background so later scouts can compare against them.
 */
export function ingestSync(raw: RawJob[], opts: IngestOptions): IngestResult {
  const stats = emptyStats();
  const perSource: IngestResult['perSource'] = {};
  const profile = loadProfile();
  const signalCompanies = companiesWithFreshSignals();
  // One transaction for the company upserts prepare() makes (thousands of rows on a big run).
  const cands = tx(() => collapse(prepare(raw, opts, stats), stats));
  const softCache = new Map<string, { id: string; title: string }[]>();
  const added: string[] = [];
  tx(() => {
    for (const c of cands) {
      const hit = findExisting(c, softCache);
      if (hit) {
        if (hit.by === 'url') stats.dupDbUrl++;
        else stats.dupDbFingerprint++;
        mergeInto(hit.row, c, opts.maxAgeDays);
        stats.merged++;
        bump(perSource, c.job.source, 'dupes');
        continue;
      }
      added.push(insertRow(c, opts, profile, signalCompanies, stats));
      stats.inserted++;
      bump(perSource, c.job.source, 'added');
    }
  });
  finish(added, opts);
  if (added.length) void storeEmbeddings(added).catch(() => {});
  return { added, stats, perSource };
}

/** Compute and store embeddings for jobs that don't have one yet. */
export async function storeEmbeddings(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = all<{ id: string; title: string; location: string; description_text: string }>(
    `SELECT id, title, location, description_text FROM jobs WHERE id IN (${ids.map(() => '?').join(',')}) AND id NOT IN (SELECT job_id FROM job_embeddings)`,
    ...ids,
  );
  if (!rows.length) return 0;
  const { model, vectors } = await embed(rows.map((r) => embedText({ title: r.title, location: r.location ?? '', descriptionText: r.description_text ?? '' } as RawJob)));
  tx(() => rows.forEach((r, i) => run('INSERT OR REPLACE INTO job_embeddings (job_id, model, vector) VALUES (?, ?, ?)', r.id, model, toBlob(vectors[i]))));
  return rows.length;
}

/** Is this posting URL already stored (by listing URL or canonical apply URL)? */
export function isKnownUrl(url: string): boolean {
  if (!url) return false;
  const canon = canonicalApplyUrl(url);
  const plain = canonicalUrl(url);
  return !!get('SELECT 1 FROM jobs WHERE apply_url_canonical = ? OR url = ? OR url = ? LIMIT 1', canon, plain, canon);
}

/** Jobs past the max age that still look live get marked ghost (never deleted). */
export function sweepStale(maxAgeDays: number, nowMs = Date.now()): number {
  const cutoff = new Date(nowMs - maxAgeDays * 86_400_000).toISOString();
  return Number(
    run("UPDATE jobs SET legitimacy = 'ghost', updated_at = ? WHERE posted_at IS NOT NULL AND posted_at < ? AND COALESCE(legitimacy, 'ok') IN ('ok', 'suspect')", now(), cutoff).changes,
  );
}
