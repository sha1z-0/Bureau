import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, now, run, tx } from '../db.ts';
import type { AtsFamily } from '../contracts/job.ts';
import { normalizeForFingerprint } from '../services/classify.ts';
import { DEFAULT_BOARDS } from '../sources/boards.ts';
import { getText } from '../sources/http.ts';
import type { BoardReport, CompanyTarget } from '../sources/types.ts';
import { prettyCompany } from '../sources/util.ts';
import { boardUrlFor, detectAts, detectAtsInHtml, employerDomain, type AtsHit } from './detect.ts';

/**
 * The company registry: every employer Bureau knows, and for those on a
 * supported ATS, the board token it polls. It grows by itself: any apply URL
 * seen anywhere (aggregators, HN, deep scan, SimplifyJobs) that points at an
 * ATS adds that company's whole board.
 *
 * Status: active (polled) · employer (known, no supported ATS yet) ·
 * unsupported (ATS recognised but not polled, e.g. iCIMS/Taleo) · dead (board
 * 404s) · paused (owner switched it off).
 */

/** ATS families with a polling connector. */
export const POLLED_ATS: AtsFamily[] = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'workday',
  'workable',
  'recruitee',
  'personio',
  'teamtailor',
  'bamboohr',
  'breezy',
  'jazzhr',
  'rippling',
  'pinpoint',
];

export type CompanyStatus = 'active' | 'employer' | 'unsupported' | 'dead' | 'paused';

export interface Signal {
  type: 'roles_jump' | 'funding' | 'manual';
  at: string;
  detail: string;
  from?: number;
  to?: number;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  ats: AtsFamily | null;
  atsToken: string | null;
  careersUrl: string | null;
  discoveredVia: string | null;
  status: CompanyStatus;
  lastCheckedAt: string | null;
  openRoles: number | null;
  prevOpenRoles: number | null;
  signals: Signal[];
}

interface Row {
  id: string;
  name: string;
  domain: string | null;
  ats: string | null;
  ats_token: string | null;
  careers_url: string | null;
  discovered_via: string | null;
  status: string;
  last_checked_at: string | null;
  open_roles: number | null;
  prev_open_roles: number | null;
  signals: string;
}

export function toCompany(r: Row): Company {
  let signals: Signal[] = [];
  try {
    signals = JSON.parse(r.signals || '[]') as Signal[];
  } catch {
    /* corrupt json: treat as none */
  }
  return {
    id: r.id,
    name: r.name,
    domain: r.domain,
    ats: (r.ats as AtsFamily | null) ?? null,
    atsToken: r.ats_token,
    careersUrl: r.careers_url,
    discoveredVia: r.discovered_via,
    status: r.status as CompanyStatus,
    lastCheckedAt: r.last_checked_at,
    openRoles: r.open_roles,
    prevOpenRoles: r.prev_open_roles,
    signals,
  };
}

/** Company identity for matching names across sources: "Hugging Face, Inc." and "huggingface" are one key. */
export function companyKey(name: string): string {
  return normalizeForFingerprint(name).replace(/\s+/g, '');
}

// Name → id index for employers, built lazily and kept in step by this module's writes.
let nameIndex: Map<string, string> | null = null;
function index(): Map<string, string> {
  if (!nameIndex) {
    nameIndex = new Map();
    // Prefer rows with a polled ATS when several share a name.
    for (const r of all<{ id: string; name: string; ats: string | null }>("SELECT id, name, ats FROM companies ORDER BY (status = 'active') ASC, (ats IS NULL) DESC")) {
      const k = companyKey(r.name);
      if (k) nameIndex.set(k, r.id);
    }
  }
  return nameIndex;
}
export function resetRegistryCache() {
  nameIndex = null;
}

export function getCompany(id: string): Company | null {
  const r = get<Row>('SELECT * FROM companies WHERE id = ?', id);
  return r ? toCompany(r) : null;
}

export function findByAts(ats: AtsFamily, token: string): Company | null {
  const r = get<Row>('SELECT * FROM companies WHERE ats = ? AND lower(ats_token) = lower(?)', ats, token);
  return r ? toCompany(r) : null;
}

export function findByName(name: string): Company | null {
  const id = index().get(companyKey(name));
  return id ? getCompany(id) : null;
}

export interface UpsertInput {
  name?: string | null;
  ats?: AtsFamily | null;
  token?: string | null;
  careersUrl?: string | null;
  domain?: string | null;
  discoveredVia: string;
  status?: CompanyStatus;
}

function statusFor(ats: AtsFamily | null | undefined, token: string | null | undefined): CompanyStatus {
  if (!ats || !token) return 'employer';
  return POLLED_ATS.includes(ats) ? 'active' : 'unsupported';
}

/**
 * Insert or enrich a company. With an (ats, token) it is keyed on those; an
 * employer-only row (no ATS) is keyed on its normalised name, and gets
 * upgraded in place when its ATS turns up later.
 */
export function upsertCompany(input: UpsertInput): { company: Company; created: boolean } {
  const ats = input.ats ?? null;
  const token = input.token?.trim() || null;
  const name = (input.name?.trim() || (token ? prettyCompany(token.split(/[:/@]/)[0]) : '')).slice(0, 200) || 'Unknown';
  const careersUrl = input.careersUrl ?? (ats && token ? boardUrlFor(ats, token) : null);
  const domain = input.domain ?? employerDomain(input.careersUrl);

  if (ats && token) {
    const existing = findByAts(ats, token);
    if (existing) {
      // Fill gaps only; never let a token-derived placeholder overwrite a real name.
      const betterName = input.name && (existing.name === prettyCompany(token.split(/[:/@]/)[0]) || existing.name === 'Unknown') ? input.name.trim() : null;
      if (betterName || (!existing.domain && domain) || (!existing.careersUrl && careersUrl)) {
        run(
          'UPDATE companies SET name = COALESCE(?, name), domain = COALESCE(domain, ?), careers_url = COALESCE(careers_url, ?) WHERE id = ?',
          betterName,
          domain,
          careersUrl,
          existing.id,
        );
        if (betterName) index().set(companyKey(betterName), existing.id);
      }
      return { company: getCompany(existing.id)!, created: false };
    }
    // An employer row with the same name gets its ATS attached instead of a duplicate row.
    const byName = input.name ? findByName(input.name) : null;
    if (byName && !byName.ats) {
      run(
        'UPDATE companies SET ats = ?, ats_token = ?, careers_url = COALESCE(?, careers_url), domain = COALESCE(domain, ?), status = ?, discovered_via = COALESCE(discovered_via, ?) WHERE id = ?',
        ats,
        token,
        careersUrl,
        domain,
        input.status ?? statusFor(ats, token),
        input.discoveredVia,
        byName.id,
      );
      return { company: getCompany(byName.id)!, created: false };
    }
  } else {
    const byName = findByName(name);
    if (byName) {
      if ((!byName.domain && domain) || (!byName.careersUrl && careersUrl)) {
        run('UPDATE companies SET domain = COALESCE(domain, ?), careers_url = COALESCE(careers_url, ?) WHERE id = ?', domain, careersUrl, byName.id);
      }
      return { company: getCompany(byName.id)!, created: false };
    }
  }

  const id = crypto.randomUUID();
  run(
    `INSERT INTO companies (id, name, domain, ats, ats_token, careers_url, discovered_via, status, signals)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]')`,
    id,
    name,
    domain,
    ats,
    token,
    careersUrl,
    input.discoveredVia,
    input.status ?? statusFor(ats, token),
  );
  const k = companyKey(name);
  if (k && (!index().has(k) || (ats && POLLED_ATS.includes(ats)))) index().set(k, id);
  return { company: getCompany(id)!, created: true };
}

/** Feed any URLs to discovery. Returns how many new boards joined the registry. */
export function discoverUrls(urls: string[], via: string): number {
  let added = 0;
  const seen = new Set<string>();
  tx(() => {
    for (const u of urls) {
      if (!u) continue;
      const h = detectAts(u);
      if (!h?.token) continue;
      const key = `${h.ats}|${h.token.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (findByAts(h.ats, h.token)) continue;
      upsertCompany({ ats: h.ats, token: h.token, careersUrl: h.boardUrl, discoveredVia: `discovery:${via}` });
      added++;
    }
  });
  return added;
}

/** Add a company by any careers URL or domain: ATS auto-detection from the URL, then from the page's DOM. */
export async function addCareersUrl(input: { url: string; name?: string | null; fetchPage?: boolean }): Promise<{ company: Company; created: boolean; detected: AtsHit | null; via: 'url' | 'dom' | 'none' }> {
  let url = input.url.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const fromUrl = detectAts(url);
  if (fromUrl?.token) {
    const r = upsertCompany({ name: input.name, ats: fromUrl.ats, token: fromUrl.token, careersUrl: fromUrl.boardUrl, discoveredVia: 'manual' });
    return { ...r, detected: fromUrl, via: 'url' };
  }
  let fromDom: AtsHit | null = null;
  if (input.fetchPage !== false) {
    try {
      const html = await getText(url, { robots: true, accept: 'text/html', maxBytes: 3 * 1024 * 1024, timeoutMs: 30_000 });
      fromDom = detectAtsInHtml(html, url).find((h) => !!h.token) ?? null;
    } catch {
      /* unreachable or disallowed: keep it as an employer with a careers URL */
    }
  }
  if (fromDom?.token) {
    const r = upsertCompany({ name: input.name, ats: fromDom.ats, token: fromDom.token, careersUrl: fromDom.boardUrl, domain: employerDomain(url), discoveredVia: 'manual' });
    return { ...r, detected: fromDom, via: 'dom' };
  }
  const r = upsertCompany({ name: input.name || employerDomain(url) || url, careersUrl: url, domain: employerDomain(url), discoveredVia: 'manual' });
  return { ...r, detected: fromUrl, via: 'none' };
}

export interface ListQuery {
  q?: string;
  ats?: string;
  status?: string;
  signals?: boolean;
  limit?: number;
  offset?: number;
}

export function listCompanies(qry: ListQuery = {}): { companies: Company[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (qry.q) {
    where.push('(name LIKE ? OR ats_token LIKE ? OR domain LIKE ?)');
    const like = `%${qry.q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like);
  }
  if (qry.ats) {
    where.push('ats = ?');
    params.push(qry.ats);
  }
  if (qry.status) {
    where.push('status = ?');
    params.push(qry.status);
  }
  if (qry.signals) where.push("signals != '[]'");
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM companies ${w}`, ...params)?.n ?? 0;
  const rows = all<Row>(
    `SELECT * FROM companies ${w} ORDER BY (status = 'active') DESC, COALESCE(open_roles, -1) DESC, name LIMIT ? OFFSET ?`,
    ...params,
    Math.min(qry.limit ?? 100, 500),
    qry.offset ?? 0,
  );
  return { companies: rows.map(toCompany), total };
}

export function registryStats(): { total: number; byStatus: Record<string, number>; byAts: Record<string, number>; withSignals: number } {
  const byStatus = Object.fromEntries(all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM companies GROUP BY status').map((r) => [r.status, r.n]));
  const byAts = Object.fromEntries(all<{ ats: string; n: number }>("SELECT ats, COUNT(*) AS n FROM companies WHERE ats IS NOT NULL AND status = 'active' GROUP BY ats").map((r) => [r.ats, r.n]));
  const total = get<{ n: number }>('SELECT COUNT(*) AS n FROM companies')?.n ?? 0;
  const withSignals = get<{ n: number }>("SELECT COUNT(*) AS n FROM companies WHERE signals != '[]'")?.n ?? 0;
  return { total, byStatus, byAts, withSignals };
}

export function setCompanyStatus(id: string, status: CompanyStatus): Company | null {
  run('UPDATE companies SET status = ? WHERE id = ?', status, id);
  return getCompany(id);
}

// ── Polling bookkeeping ─────────────────────────────────────────────────────

const SIGNAL_FRESH_DAYS = 14;

export function hasFreshSignal(c: Pick<Company, 'signals'>): boolean {
  return c.signals.some((s) => Date.now() - Date.parse(s.at) < SIGNAL_FRESH_DAYS * 86_400_000);
}

/**
 * The boards to poll this run for one ATS: companies with fresh hiring signals
 * first (every cycle), then never-checked boards, then the least recently
 * checked, up to `limit`.
 */
export function targetsForAts(ats: AtsFamily, limit: number): CompanyTarget[] {
  const rows = all<Row>(
    `SELECT * FROM companies WHERE ats = ? AND status = 'active' AND ats_token IS NOT NULL
     ORDER BY (signals != '[]') DESC, (last_checked_at IS NULL) DESC, last_checked_at ASC LIMIT ?`,
    ats,
    Math.max(0, limit) * 2,
  ).map(toCompany);
  const withSignal = rows.filter(hasFreshSignal);
  const rest = rows.filter((c) => !hasFreshSignal(c));
  return [...withSignal, ...rest.slice(0, Math.max(0, limit - withSignal.length))].map((c) => ({
    companyId: c.id,
    name: /^[A-Z]/.test(c.name) && c.name !== prettyCompany(c.atsToken ?? '') ? c.name : null,
    token: c.atsToken!,
    careersUrl: c.careersUrl,
    domain: c.domain,
  }));
}

/** Record one board poll: open-role count history, dead boards, and the roles-jump hiring signal. */
export function recordBoard(ats: AtsFamily, token: string, report: BoardReport): Signal | null {
  let c = findByAts(ats, token);
  if (!c) c = upsertCompany({ ats, token, name: report.name ?? null, discoveredVia: 'settings' }).company;
  const ts = now();
  if (!report.ok) {
    const dead = report.status === 404 || report.status === 410;
    run('UPDATE companies SET last_checked_at = ?, status = CASE WHEN ? THEN \'dead\' ELSE status END WHERE id = ?', ts, dead ? 1 : 0, c.id);
    return null;
  }
  let signal: Signal | null = null;
  const prev = c.openRoles;
  if (prev !== null && prev >= 3 && report.count >= Math.ceil(prev * 1.3) && report.count - prev >= 2) {
    signal = { type: 'roles_jump', at: ts, detail: `Open roles rose from ${prev} to ${report.count}`, from: prev, to: report.count };
  }
  const signals = signal ? [...c.signals, signal].slice(-10) : c.signals;
  const betterName = report.name && (c.name === prettyCompany(token.split(/[:/@]/)[0]) || c.name === 'Unknown') ? report.name : null;
  run(
    'UPDATE companies SET last_checked_at = ?, prev_open_roles = open_roles, open_roles = ?, signals = ?, name = COALESCE(?, name) WHERE id = ?',
    ts,
    report.count,
    JSON.stringify(signals),
    betterName,
    c.id,
  );
  if (betterName) index().set(companyKey(betterName), c.id);
  return signal;
}

/** Attach a funding (or manual) signal to a company by name, creating the employer row if needed. */
export function addSignal(name: string, signal: Omit<Signal, 'at'>): Company {
  const c = findByName(name) ?? upsertCompany({ name, discoveredVia: 'signal' }).company;
  const fresh = getCompany(c.id)!;
  if (fresh.signals.some((s) => s.type === signal.type && s.detail === signal.detail)) return fresh;
  run('UPDATE companies SET signals = ? WHERE id = ?', JSON.stringify([...fresh.signals, { ...signal, at: now() }].slice(-10)), c.id);
  return getCompany(c.id)!;
}

/** Company ids with a signal in the last two weeks (their roles get the priority flag). */
export function companiesWithFreshSignals(): Set<string> {
  return new Set(
    all<Row>("SELECT * FROM companies WHERE signals != '[]'")
      .map(toCompany)
      .filter(hasFreshSignal)
      .map((c) => c.id),
  );
}

// ── Seeding ─────────────────────────────────────────────────────────────────

interface SeedEntry {
  name?: string;
  ats: AtsFamily;
  token: string;
  via?: string;
}

const SEED_VERSION = 2;
const SEED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-companies.json');

function loadSeed(): SeedEntry[] {
  try {
    return JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) as SeedEntry[];
  } catch {
    return [];
  }
}

/**
 * Seed the registry once (idempotent, versioned): the curated v1 boards, every
 * token confirmed in docs/SOURCES.md, and companies extracted from the
 * SimplifyJobs and Y Combinator lists (server/scout/seed-companies.json).
 */
export function seedRegistry(force = false): { added: number; total: number } {
  const done = get<{ value: string }>("SELECT value FROM settings WHERE key = 'scout.seedVersion'");
  if (!force && done && Number(JSON.parse(done.value)) >= SEED_VERSION) {
    return { added: 0, total: get<{ n: number }>('SELECT COUNT(*) AS n FROM companies')?.n ?? 0 };
  }
  let added = 0;
  tx(() => {
    for (const ats of ['greenhouse', 'lever', 'ashby'] as const) {
      for (const token of DEFAULT_BOARDS[ats]) {
        if (upsertCompany({ ats, token, discoveredVia: 'seed:boards' }).created) added++;
      }
    }
    for (const e of loadSeed()) {
      if (upsertCompany({ ats: e.ats, token: e.token, name: e.name ?? null, discoveredVia: `seed:${e.via ?? 'sources-md'}` }).created) added++;
    }
    run("INSERT INTO settings (key, value) VALUES ('scout.seedVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(SEED_VERSION));
  });
  return { added, total: get<{ n: number }>('SELECT COUNT(*) AS n FROM companies')?.n ?? 0 };
}
