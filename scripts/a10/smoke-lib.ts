import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';

/** Helpers for A10's UI smoke steps (scripts/ui-smoke/a10-*.ts). */

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** GET a UI route with the page's own session. */
export async function apiGet<T>(page: Page, p: string): Promise<T> {
  return page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    return r.json();
  }, p) as Promise<T>;
}

/** POST/PUT/DELETE a UI route with the page's session and CSRF token. */
export async function apiSend<T>(page: Page, method: string, p: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const s = (await (await fetch('/api/session', { credentials: 'same-origin' })).json()) as { csrf: string };
      const r = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-bureau-csrf': s.csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${method} ${url} answered ${r.status}: ${(j as { message?: string }).message ?? ''}`);
      return j;
    },
    { method, url: p, body },
  ) as Promise<T>;
}

export async function waitFor(fn: () => Promise<boolean>, ms = 10_000, every = 250): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, every));
  }
  return false;
}

/**
 * The running server's data dir. The A11 runner keeps it in a fresh
 * `bureau-ui-*` folder under the OS temp dir; `t.dataDir` wins when the runner
 * provides it (requested in docs/build/requests/A10.md).
 */
export function findDataDir(hint?: string): string | null {
  if (hint && fs.existsSync(path.join(hint, 'bureau.db'))) return hint;
  if (process.env.BUREAU_UI_DATA_DIR && fs.existsSync(path.join(process.env.BUREAU_UI_DATA_DIR, 'bureau.db'))) return process.env.BUREAU_UI_DATA_DIR;
  const tmp = os.tmpdir();
  const dirs = fs
    .readdirSync(tmp)
    .filter((d) => d.startsWith('bureau-ui-'))
    .map((d) => path.join(tmp, d, 'data'))
    .filter((d) => fs.existsSync(path.join(d, 'bureau.db')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] ?? null;
}

/**
 * Plant one fictional job that a form skipped over an unknown question, the
 * way the form engine leaves it, so the Questions flow has something to answer.
 * Writes straight to SQLite (WAL) beside the running server.
 */
export async function plantUnknownQuestion(dataDir: string, question: string, options: string[] = []): Promise<{ jobId: string; questionId: string }> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dataDir, 'bureau.db'));
  try {
    const jobId = `smoke-${crypto.randomUUID().slice(0, 8)}`;
    const qid = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO jobs (id, fingerprint, source, url, title, company, location, remote, category, tags, found_at, updated_at)
       VALUES (?, ?, 'fixture', ?, 'Backend Engineer', 'Smoke Test Ltd', 'Remote', 1, 'software', '[]', ?, ?)`,
    ).run(jobId, `fp-${jobId}`, `https://jobs.smoke.example.net/${jobId}`, now, now);
    db.prepare("INSERT INTO pipeline (job_id, campaign_id, state, attempts, updated_at) VALUES (?, NULL, 'skipped', 0, ?)").run(jobId, now);
    db.prepare("INSERT INTO pipeline_log (job_id, ts, from_state, to_state, reason) VALUES (?, ?, 'scored', 'skipped', 'unknown_question')").run(jobId, now);
    const norm = question.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    db.prepare("INSERT INTO unknown_questions (id, question_raw, question_norm, job_id, field_kind, options, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)").run(
      qid,
      question,
      norm,
      jobId,
      options.length ? 'radio' : 'text',
      JSON.stringify(options),
      now,
    );
    return { jobId, questionId: qid };
  } finally {
    db.close();
  }
}
