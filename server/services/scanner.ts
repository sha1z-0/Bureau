import crypto from 'node:crypto';
import { deepScan } from '../ai/scout.ts';
import { scoreJobs } from '../ai/score.ts';
import { all, get, getSetting, logEvent, now, run, tx } from '../db.ts';
import { AppError, redact } from '../errors.ts';
import { safeFetch } from '../security/safeFetch.ts';
import { htmlToText } from '../security/sanitize.ts';
import { sourceSettings } from '../sources/index.ts';
import { scoutPipeline } from '../scout/index.ts';
import { ingestSync } from '../scout/ingest.ts';
import { mineResearch } from '../scout/discovery.ts';
import type { Category, RawJob } from '../sources/types.ts';
import { apiKey } from '../ai/claude.ts';
import { emit } from './bus.ts';
import { prefilterScore } from './classify.ts';
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

/**
 * Insert new jobs, skipping (and merging into) anything already known by URL or
 * fingerprint. Thin adapter over the v2 scout's synchronous ingest, so manual
 * captures and deep scans get the same new columns (canonical apply URL, ATS,
 * company, legitimacy, sources, priority) and enter the pipeline at `found`.
 */
export function ingest(raw: RawJob[], maxAgeDays: number): { added: string[]; skipped: number } {
  const r = ingestSync(raw, { maxAgeDays });
  return { added: r.added, skipped: raw.length - r.added.length };
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
      if (kind === 'deep') {
        if (!profile) throw new AppError(412, 'NO_PROFILE', 'Upload your CV first — the deep scan hunts for you specifically.');
        const raw = await deepScan(profile, options.focus ?? '', settings.maxAgeDays, log, (r) => mineResearch(r.text, r.sources));
        found = raw.length;
        const { added } = ingest(raw, settings.maxAgeDays);
        addedTotal = added.length;
        log(`Deep scan: ${raw.length} verified roles, ${added.length} new`);
        await enrich(added);
      } else {
        // v2: the scout pipeline does the sources scan (resolve, normalise, dedupe, filter, pipeline entry).
        const result = await scoutPipeline({ sources: options.only, log, recordScan: false });
        found = result.found;
        addedTotal = result.added.length;
        emit({ type: 'jobs-changed' });
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
