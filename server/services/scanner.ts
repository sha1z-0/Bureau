import crypto from 'node:crypto';
import { deepScan } from '../ai/scout.ts';
import { scoreJobs } from '../ai/score.ts';
import { all, get, getSetting, logEvent, now, run, tx } from '../db.ts';
import { AppError, redact } from '../errors.ts';
import { safeFetch } from '../security/safeFetch.ts';
import { htmlToText } from '../security/sanitize.ts';
import { CONNECTORS, sourceSettings } from '../sources/index.ts';
import type { Category, RawJob } from '../sources/types.ts';
import { withinDays } from '../sources/util.ts';
import { apiKey } from '../ai/claude.ts';
import { emit } from './bus.ts';
import { canonicalUrl, categorize, normalizeForFingerprint, prefilterScore } from './classify.ts';
import { loadProfile } from './profileStore.ts';

export interface ScanSettings {
  intervalHours: number;
  scoreLimit: number;
  scoreThreshold: number;
}

export function scanSettings(): ScanSettings {
  return { intervalHours: 6, scoreLimit: 36, scoreThreshold: 45, ...getSetting<Partial<ScanSettings>>('scan', {}) };
}

let running: string | null = null;
let runningPromise: Promise<void> | null = null;
export const currentScan = () => running;

function fingerprint(j: RawJob) {
  return crypto
    .createHash('sha256')
    // Location is left out on purpose: one role posted in five cities is one application.
    .update(`${normalizeForFingerprint(j.company)}|${normalizeForFingerprint(j.title)}`)
    .digest('hex')
    .slice(0, 32);
}

/** Insert new jobs, skipping anything we have seen by URL or by fingerprint. Returns ids of the new rows. */
export function ingest(raw: RawJob[], maxAgeDays: number): { added: string[]; skipped: number } {
  const profile = loadProfile();
  const added: string[] = [];
  let skipped = 0;
  tx(() => {
    for (const j of raw) {
      const webUrl = /^https?:\/\//i.test(j.url);
      // Feeds sometimes carry javascript: or relative links; only real web URLs are kept (captures may have none).
      if (!j.title || (!webUrl && !(j.source === 'capture' && j.url === '')) || !withinDays(j.postedAt, maxAgeDays)) {
        skipped++;
        continue;
      }
      const category = categorize(j);
      if (!category) {
        skipped++;
        continue;
      }
      const url = webUrl ? canonicalUrl(j.url) : '';
      const fp = fingerprint(j);
      if (get("SELECT 1 FROM jobs WHERE fingerprint = ? OR (url = ? AND url != '')", fp, url)) {
        skipped++;
        continue;
      }
      const id = crypto.randomUUID();
      run(
        `INSERT INTO jobs (id, fingerprint, source, external_id, url, title, company, location, remote, category,
           description_html, description_text, salary_min, salary_max, salary_currency, tags, posted_at, found_at,
           prefilter_score, apply_email, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        fp,
        j.source,
        j.externalId,
        url,
        j.title.slice(0, 300),
        j.company.slice(0, 200),
        (j.location ?? '').slice(0, 300),
        j.remote ? 1 : 0,
        category,
        j.descriptionHtml ?? '',
        (j.descriptionText ?? '').slice(0, 60_000),
        j.salaryMin ?? null,
        j.salaryMax ?? null,
        j.salaryCurrency ?? null,
        JSON.stringify((j.tags ?? []).slice(0, 20)),
        j.postedAt ?? null,
        now(),
        prefilterScore(j, category, profile),
        j.applyEmail ?? null,
        now(),
      );
      added.push(id);
    }
  });
  return { added, skipped };
}

/** Deep-scan and captured jobs arrive with a summary only; read the real page so scoring has the full posting. */
async function enrich(ids: string[]) {
  const rows = all<{ id: string; url: string; description_text: string }>(
    `SELECT id, url, description_text FROM jobs WHERE id IN (${ids.map(() => '?').join(',') || "''"})`,
    ...ids,
  );
  await Promise.all(
    rows
      .filter((r) => r.description_text.length < 1500 && /^https?:/.test(r.url))
      .slice(0, 20)
      .map(async (r) => {
        try {
          const res = await safeFetch(r.url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000, accept: 'text/html' });
          if (!res.ok) return;
          const text = htmlToText(res.text());
          if (text.length > r.description_text.length * 2) {
            run('UPDATE jobs SET description_text = ? WHERE id = ?', `${r.description_text}\n\n---\n${text.slice(0, 30_000)}`, r.id);
          }
        } catch {
          /* the summary will do */
        }
      }),
  );
}

export async function runScan(kind: 'sources' | 'deep', options: { only?: string[]; focus?: string; scoreLimit?: number } = {}): Promise<string> {
  if (running) throw new AppError(409, 'SCAN_RUNNING', 'A scan is already running.');
  const scanId = crypto.randomUUID();
  running = scanId;
  const lines: string[] = [];
  const log = (m: string) => {
    const line = `${new Date().toLocaleTimeString('en-GB')}  ${redact(m)}`;
    lines.push(line);
    run('UPDATE scans SET log = ? WHERE id = ?', JSON.stringify(lines.slice(-400)), scanId);
    emit({ type: 'scan', scanId, status: 'running', message: line });
  };
  run('INSERT INTO scans (id, kind, status, started_at) VALUES (?, ?, ?, ?)', scanId, kind, 'running', now());

  // Fire and forget — the UI follows along over the event stream.
  runningPromise = (async () => {
    let found = 0;
    let addedTotal = 0;
    let scored = 0;
    try {
      const settings = sourceSettings();
      const profile = loadProfile();
      const categories: Category[] = profile
        ? profile.preferences.categories.length
          ? profile.preferences.categories
          : profile.categories
        : ['web', 'security', 'mobile', 'game'];
      const ctx = {
        keywords: [...(profile?.preferences.targetRoles ?? []), ...settings.extraKeywords],
        categories,
        boards: settings.boards,
        maxAgeDays: settings.maxAgeDays,
        log,
      };

      if (kind === 'deep') {
        if (!profile) throw new AppError(412, 'NO_PROFILE', 'Upload your CV first — the deep scan hunts for you specifically.');
        const raw = await deepScan(profile, options.focus ?? '', settings.maxAgeDays, log);
        found = raw.length;
        const { added } = ingest(raw, settings.maxAgeDays);
        addedTotal = added.length;
        log(`Deep scan: ${raw.length} verified roles, ${added.length} new`);
        await enrich(added);
      } else {
        const active = CONNECTORS.filter((c) => settings.enabled[c.id] && (!options.only || options.only.includes(c.id)));
        log(`Scanning ${active.length} sources across ${categories.join(', ')}`);
        await Promise.all(
          active.map(async (c) => {
            const started = Date.now();
            try {
              const raw = await c.run(ctx);
              found += raw.length;
              const { added } = ingest(raw, settings.maxAgeDays);
              addedTotal += added.length;
              log(`${c.label}: ${raw.length} listings, ${added.length} new tech roles (${((Date.now() - started) / 1000).toFixed(1)}s)`);
              emit({ type: 'jobs-changed' });
            } catch (err) {
              log(`${c.label}: failed — ${(err as Error).message}`);
            }
          }),
        );
      }
      run('UPDATE scans SET found = ?, added = ? WHERE id = ?', found, addedTotal, scanId);

      // Score the most promising unscored jobs with Claude.
      if (profile && apiKey()) {
        const { scoreThreshold } = scanSettings();
        const scoreLimit = options.scoreLimit ?? scanSettings().scoreLimit;
        const candidates = all<{ id: string }>(
          `SELECT id FROM jobs WHERE ai_score IS NULL AND status != 'dismissed' AND prefilter_score >= ?
           ORDER BY prefilter_score DESC, found_at DESC LIMIT ?`,
          kind === 'deep' ? 0 : scoreThreshold,
          scoreLimit,
        ).map((r) => r.id);
        if (candidates.length) {
          log(`Claude is assessing the top ${candidates.length} candidates…`);
          scored = await scoreJobs(candidates, profile, (n) => {
            run('UPDATE scans SET scored = ? WHERE id = ?', n, scanId);
            emit({ type: 'scan', scanId, status: 'running', scored: n });
            emit({ type: 'jobs-changed' });
          });
          log(`Scored ${scored} roles`);
        }
      } else if (!profile) {
        log('Skipped AI scoring — upload your CV in Profile to unlock fit scores.');
      } else {
        log('Skipped AI scoring — add your Anthropic API key in Settings.');
      }

      run("UPDATE scans SET status = 'done', finished_at = ?, found = ?, added = ?, scored = ? WHERE id = ?", now(), found, addedTotal, scored, scanId);
      logEvent('scan', `${kind === 'deep' ? 'Deep scan' : 'Scan'} finished — ${addedTotal} new roles, ${scored} scored`);
      emit({ type: 'scan', scanId, status: 'done', found, added: addedTotal, scored });
    } catch (err) {
      const message = redact((err as Error).message);
      log(`Scan stopped: ${message}`);
      run("UPDATE scans SET status = 'failed', finished_at = ?, error = ?, found = ?, added = ?, scored = ? WHERE id = ?", now(), message, found, addedTotal, scored, scanId);
      emit({ type: 'scan', scanId, status: 'failed', message });
    } finally {
      running = null;
      emit({ type: 'jobs-changed' });
    }
  })();

  return scanId;
}

/** Start a scan and wait for it to finish (used by the hunt). */
export async function scanAndWait(kind: 'sources' | 'deep', options: { only?: string[]; focus?: string; scoreLimit?: number } = {}) {
  const id = await runScan(kind, options);
  await runningPromise;
  return id;
}

/** Re-runs a source scan when the configured interval has passed. Checks every five minutes while Bureau is open. */
/** Plain re-scans when the hunt is off. When it's on, the hunt's own timer drives scanning. */
export function startScheduler(huntEnabled: () => boolean) {
  const tick = () => {
    const { intervalHours } = scanSettings();
    if (huntEnabled() || !intervalHours || running) return;
    const last = get<{ started_at: string }>("SELECT started_at FROM scans WHERE kind = 'sources' ORDER BY started_at DESC LIMIT 1");
    if (last && Date.now() - new Date(last.started_at).getTime() < intervalHours * 3_600_000) return;
    runScan('sources').catch(() => {});
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 5 * 60_000).unref();
}

export function rescoreFromProfile() {
  const profile = loadProfile();
  if (!profile) return;
  const rows = all<{ id: string; title: string; company: string; location: string; remote: number; url: string; category: Category; description_text: string; tags: string; posted_at: string | null }>(
    'SELECT id, title, company, location, remote, url, category, description_text, tags, posted_at FROM jobs',
  );
  tx(() => {
    for (const r of rows) {
      const raw: RawJob = {
        source: '',
        externalId: '',
        title: r.title,
        company: r.company,
        location: r.location,
        url: r.url,
        remote: !!r.remote,
        descriptionText: r.description_text,
        tags: JSON.parse(r.tags) as string[],
        postedAt: r.posted_at,
      };
      run('UPDATE jobs SET prefilter_score = ? WHERE id = ?', prefilterScore(raw, r.category, profile), r.id);
    }
  });
}
