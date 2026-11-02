import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { extractProfile } from '../ai/profile.ts';
import { UPLOAD_DIR } from '../config.ts';
import { get, getSetting, logEvent, now, setSetting } from '../db.ts';
import { emit } from '../services/bus.ts';
import { loadProfile } from '../services/profileStore.ts';
import { defaultAi, type AiClient } from './ai.ts';
import { ensureSeeded } from './answers.ts';
import { currentCvRef, syncCvFacts } from './cv.ts';
import { defaultFetcher, type Fetcher } from './fetch.ts';
import { syncGithub } from './github.ts';
import { getLinks, githubLogin } from './links.ts';
import { syncPortfolio } from './portfolio.ts';
import { emptyReport, type PartReport } from './types.ts';
import { refreshStyle } from './voice.ts';

/**
 * The daily profile sync (A08's scheduler calls it at 06:00 local time; the UI
 * calls it on demand). Each part runs independently: one failing source never
 * blocks the others, and a failed source keeps yesterday's facts.
 */

export const SYNC_PARTS = ['cv', 'github', 'portfolio'] as const;
export type SyncPart = (typeof SYNC_PARTS)[number];

export interface SyncOptions {
  parts?: SyncPart[];
  fetcher?: Fetcher;
  ai?: AiClient;
  now?: Date;
  /** Re-extract a CV uploaded since the profile was last built (needs Claude). Default true. */
  reextract?: boolean;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  added: number;
  reactivated: number;
  deactivated: number;
  parts: Partial<Record<SyncPart, PartReport>>;
}

const REPORT_KEY = 'profile.sync.last';

export function lastSync(): SyncReport | null {
  return getSetting<SyncReport | null>(REPORT_KEY, null);
}

/** A CV uploaded after the profile was last built (its extraction failed or never ran). */
function pendingCv(): { stored_as: string; mime: string; filename: string } | null {
  const doc = get<{ stored_as: string; mime: string; filename: string; created_at: string }>(
    "SELECT stored_as, mime, filename, created_at FROM documents WHERE kind = 'cv' ORDER BY created_at DESC LIMIT 1",
  );
  const prof = get<{ updated_at: string }>('SELECT updated_at FROM profile WHERE id = 1');
  if (!doc || (prof && prof.updated_at >= doc.created_at)) return null;
  return doc;
}

async function syncCv(opts: SyncOptions): Promise<PartReport> {
  const pending = opts.reextract === false ? null : pendingCv();
  if (pending) {
    const file = path.join(UPLOAD_DIR, path.basename(pending.stored_as));
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      if (pending.mime === 'pdf') await extractProfile({ pdf: buf });
      else if (pending.mime === 'docx') await extractProfile({ text: (await mammoth.extractRawText({ buffer: buf })).value });
      else await extractProfile({ text: buf.toString('utf8') });
    }
  }
  const profile = loadProfile();
  if (!profile) return emptyReport('skipped', 'No CV uploaded yet.');
  const r = syncCvFacts(profile, currentCvRef());
  return { status: 'ok', ...r, message: `${pending ? `Re-read ${pending.filename}; ` : ''}${r.added} new, ${r.deactivated} no longer on the CV` };
}

async function runPart(part: SyncPart, opts: Required<Pick<SyncOptions, 'fetcher' | 'ai'>> & SyncOptions): Promise<PartReport> {
  try {
    if (part === 'cv') return await syncCv(opts);
    const links = getLinks(loadProfile());
    if (part === 'github') {
      const login = githubLogin(links.github);
      if (!login) return emptyReport('skipped', links.github ? `Can't read a GitHub username from ${links.github}.` : 'No GitHub link set.');
      return await syncGithub({ login, fetcher: opts.fetcher, ai: opts.ai, now: opts.now });
    }
    if (!links.portfolio) return emptyReport('skipped', 'No portfolio link set.');
    return await syncPortfolio({ url: links.portfolio, fetcher: opts.fetcher, ai: opts.ai });
  } catch (err) {
    return emptyReport('error', (err as Error).message);
  }
}

let inflight: Promise<SyncReport> | null = null;

/** Refresh from CV, GitHub and portfolio. Concurrent calls share one run. */
export function syncProfile(opts: SyncOptions = {}): Promise<SyncReport> {
  inflight ??= run(opts).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run(opts: SyncOptions): Promise<SyncReport> {
  const startedAt = now();
  const parts = opts.parts?.length ? opts.parts : [...SYNC_PARTS];
  const full = { ...opts, fetcher: opts.fetcher ?? defaultFetcher, ai: opts.ai ?? defaultAi };
  const report: SyncReport = { startedAt, finishedAt: startedAt, added: 0, reactivated: 0, deactivated: 0, parts: {} };
  for (const part of parts) {
    const r = await runPart(part, full);
    report.parts[part] = r;
    report.added += r.added;
    report.reactivated += r.reactivated;
    report.deactivated += r.deactivated;
  }
  ensureSeeded();
  refreshStyle();
  report.finishedAt = now();
  setSetting(REPORT_KEY, report);
  const errors = Object.entries(report.parts).filter(([, r]) => r.status === 'error');
  const summary = `Profile sync: ${report.added} new fact(s), ${report.deactivated} retired${errors.length ? `; ${errors.map(([p, r]) => `${p} failed (${r.message})`).join('; ')}` : ''}`;
  logEvent('profile', summary);
  emit({ type: 'activity', message: summary, level: errors.length ? 'warn' : 'info' });
  return report;
}
