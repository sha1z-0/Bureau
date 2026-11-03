import crypto from 'node:crypto';
import { db, get, now, run } from '../db.ts';
import type { CvOut } from './cv.ts';
import type { WriterContext } from './context.ts';

/**
 * Volume mode tailors one CV per role, not per job: the first job of a role
 * pays for it and the rest reuse it. The key carries a hash of the active
 * facts, so a new CV or an edited fact starts over.
 */

db.exec(`CREATE TABLE IF NOT EXISTS role_cvs (
  role_key TEXT NOT NULL,
  facts_hash TEXT NOT NULL,
  cv TEXT NOT NULL,
  first_job_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (role_key, facts_hash)
)`);

/** What a reused CV must not do: speak to one posting. */
export const ROLE_CV_INSTRUCTIONS =
  'This CV is reused for every application to this kind of role, not just this posting. Write the summary and choose the bullets for the role in general: never name this company, its products or this posting.';

const LEVEL = new Set(['senior', 'junior', 'sr', 'jr', 'lead', 'principal', 'staff', 'intern', 'internship', 'trainee', 'entry', 'level', 'associate', 'mid', 'remote', 'hybrid', 'contract', 'time', 'part', 'and', 'the', 'for', 'with']);
const GENERIC = new Set(['engineer', 'engineers', 'developer', 'developers', 'programmer', 'software']);
/** Title words that say what the job is: "AI", "ML", "QA" and "UI" count; seniority and contract words don't. */
const core = (t: string) => [...new Set((t.toLowerCase().match(/[a-z0-9+#.]+/g) ?? []).map((w) => w.replace(/\.+$/, '')).filter((w) => w.length >= 2 && !LEVEL.has(w) && !/^\d+$/.test(w)))];

/** The campaign role a job title belongs to (half its words present), else the title's own core words. */
export function roleKey(title: string, roles: string[]): string {
  const tw = new Set(core(title));
  let best: string[] = [];
  let bestScore = 0;
  for (const r of roles) {
    const rw = core(r);
    // "Engineer" alone doesn't make a Backend Engineer an AI Engineer: a distinctive word has to match.
    if (!rw.some((w) => tw.has(w) && !GENERIC.has(w))) continue;
    const score = rw.length ? rw.filter((w) => tw.has(w)).length / rw.length : 0;
    if (score > bestScore) {
      best = rw;
      bestScore = score;
    }
  }
  if (bestScore >= 0.5) return `role:${[...best].sort().join(' ')}`;
  return `title:${[...tw].sort().join(' ') || title.toLowerCase().trim()}`;
}

function factsHash(ctx: WriterContext): string {
  const facts = ctx.master.facts.map((f) => `${f.id}|${f.text}`).sort();
  const learning = ctx.master.learning.filter((l) => l.status === 'learning').map((l) => l.skill).sort();
  return crypto.createHash('sha256').update(JSON.stringify([facts, learning, ctx.master.name])).digest('hex').slice(0, 24);
}

export function cachedRoleCv(key: string, ctx: WriterContext): CvOut | null {
  const row = get<{ cv: string }>('SELECT cv FROM role_cvs WHERE role_key = ? AND facts_hash = ?', key, factsHash(ctx));
  if (!row) return null;
  try {
    return JSON.parse(row.cv) as CvOut;
  } catch {
    return null;
  }
}

export function saveRoleCv(key: string, ctx: WriterContext, out: CvOut, jobId: string) {
  run(
    'INSERT OR REPLACE INTO role_cvs (role_key, facts_hash, cv, first_job_id, created_at) VALUES (?, ?, ?, ?, ?)',
    key,
    factsHash(ctx),
    JSON.stringify(out),
    jobId,
    now(),
  );
}
