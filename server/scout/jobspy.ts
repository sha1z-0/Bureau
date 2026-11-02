import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import type { RawJob } from '../contracts/job.ts';
import { annualise, type SalaryPeriod } from './normalize.ts';
import { employerDomain } from './detect.ts';

/**
 * Client for the JobSpy sidecar (sidecars/jobspy). Spawns the venv's Python,
 * sends one JSON request on stdin, enforces a timeout, and parses the JSON
 * document it prints. When Python or the venv is missing, `jobspyStatus()`
 * says so and the connector reports `unavailable` instead of failing the scan.
 *
 * Override the interpreter with BUREAU_JOBSPY_PYTHON (a path, or "none" to
 * force the unavailable path, which selfcheck uses).
 */

export const SIDECAR_DIR = path.join(ROOT, 'sidecars', 'jobspy');

export interface JobSpyRequest {
  sites: string[];
  search_term: string;
  location?: string;
  results_wanted?: number;
  hours_old?: number;
  is_remote?: boolean;
  country_indeed?: string;
  google_search_term?: string;
  proxies?: string[];
  linkedin_fetch_description?: boolean;
  pause_seconds?: number;
}

export interface JobSpyRow {
  id?: string | null;
  site: string;
  job_url?: string | null;
  job_url_direct?: string | null;
  title?: string | null;
  company?: string | null;
  company_url?: string | null;
  company_url_direct?: string | null;
  location?: string | null;
  date_posted?: string | null;
  job_type?: string | null;
  is_remote?: boolean | null;
  interval?: string | null;
  min_amount?: number | null;
  max_amount?: number | null;
  currency?: string | null;
  description?: string | null;
  emails?: string[] | string | null;
  job_level?: string | null;
  job_function?: string | null;
  company_industry?: string | null;
}

export interface JobSpyResult {
  ok: boolean;
  jobs: JobSpyRow[];
  errors: { site: string; error: string }[];
  counts?: Record<string, number>;
  error?: string;
  unavailable?: boolean;
}

export function jobspyPython(): string | null {
  const env = process.env.BUREAU_JOBSPY_PYTHON;
  if (env) return env === 'none' || !fs.existsSync(env) ? null : env;
  const candidates =
    process.platform === 'win32'
      ? [path.join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')]
      : [path.join(SIDECAR_DIR, '.venv', 'bin', 'python3'), path.join(SIDECAR_DIR, '.venv', 'bin', 'python')];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function runSidecar(args: string[], input: string | null, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const python = jobspyPython();
  if (!python) return Promise.resolve({ code: null, stdout: '', stderr: 'no interpreter', timedOut: false });
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(python, ['-m', 'jobspy_cli', ...args], {
      cwd: SIDECAR_DIR,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      if (stdout.length < 80 * 1024 * 1024) stdout += d;
    });
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-8000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${err.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

let statusCache: { at: number; value: { available: boolean; reason: string | null; python?: string; version?: string } } | null = null;

/** Is the sidecar usable on this machine? Cached for ten minutes. */
export async function jobspyStatus(force = false): Promise<{ available: boolean; reason: string | null; python?: string; version?: string }> {
  if (!force && statusCache && Date.now() - statusCache.at < 600_000) return statusCache.value;
  let value: { available: boolean; reason: string | null; python?: string; version?: string };
  if (!jobspyPython()) {
    value = { available: false, reason: 'Python venv for the JobSpy sidecar not found — run scripts/setup-sidecar.ps1 (Windows) or scripts/setup-sidecar.sh.' };
  } else {
    const r = await runSidecar(['--check'], null, 60_000);
    try {
      const doc = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}') as { ok?: boolean; python?: string; jobspy?: string; error?: string };
      value = doc.ok ? { available: true, reason: null, python: doc.python, version: doc.jobspy } : { available: false, reason: doc.error ?? 'jobspy is not installed in the venv' };
    } catch {
      value = { available: false, reason: r.timedOut ? 'sidecar check timed out' : `sidecar check failed: ${(r.stderr || 'no output').slice(-300)}` };
    }
  }
  statusCache = { at: Date.now(), value };
  return value;
}

export function resetJobspyStatus() {
  statusCache = null;
}

/** Run one search through the sidecar. Never throws for per-site failures; those come back in `errors`. */
export async function runJobSpy(req: JobSpyRequest, timeoutMs = 300_000): Promise<JobSpyResult> {
  if (!jobspyPython()) return { ok: false, unavailable: true, jobs: [], errors: [], error: 'JobSpy sidecar is not installed' };
  const r = await runSidecar(['--json', '-'], JSON.stringify(req), timeoutMs);
  if (r.timedOut) return { ok: false, jobs: [], errors: [], error: `JobSpy sidecar timed out after ${Math.round(timeoutMs / 1000)}s` };
  const line = r.stdout.trim().split('\n').pop() ?? '';
  try {
    const doc = JSON.parse(line) as JobSpyResult;
    return { ok: !!doc.ok, jobs: Array.isArray(doc.jobs) ? doc.jobs : [], errors: doc.errors ?? [], counts: doc.counts, error: doc.error, unavailable: doc.unavailable };
  } catch {
    return { ok: false, jobs: [], errors: [], error: `JobSpy sidecar returned unreadable output (exit ${r.code}): ${r.stderr.slice(-300)}` };
  }
}

const INTERVALS: Record<string, SalaryPeriod> = { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

/** One JobSpy row → RawJob. Guest-search URLs stay as `url`; the employer's own link (job_url_direct) becomes `applyUrl`. */
export function jobspyRowToRaw(row: JobSpyRow): RawJob | null {
  if (!row.title || !row.job_url) return null;
  const period = INTERVALS[(row.interval ?? '').toLowerCase()] ?? 'year';
  const emails = Array.isArray(row.emails) ? row.emails : row.emails ? String(row.emails).split(/[,;\s]+/) : [];
  const desc = (row.description ?? '').replace(/\\([*_#\-[\]()])/g, '$1');
  return {
    source: `jobspy-${row.site}`,
    externalId: row.id ?? row.job_url,
    title: row.title,
    company: row.company || 'Unknown',
    location: row.location ?? '',
    remote: !!row.is_remote || /remote/i.test(row.location ?? ''),
    url: row.job_url,
    descriptionText: desc,
    descriptionHtml: '',
    postedAt: row.date_posted ? new Date(`${row.date_posted.slice(0, 10)}T12:00:00Z`).toISOString() : null,
    salaryMin: annualise(row.min_amount, period),
    salaryMax: annualise(row.max_amount, period),
    salaryCurrency: row.min_amount || row.max_amount ? (row.currency ?? 'USD') : null,
    tags: [row.site, row.job_type, row.job_level, row.job_function, row.company_industry].filter((t): t is string => !!t),
    applyEmail: emails.find((e) => /@/.test(e)) ?? null,
    applyUrl: row.job_url_direct ?? null,
    companyDomain: employerDomain(row.company_url_direct),
  };
}
