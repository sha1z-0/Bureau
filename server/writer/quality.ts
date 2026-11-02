import { all, get } from '../db.ts';
import { loadVariants, readNotes, type VariantRecord, type WriterNotes } from './packet.ts';

/** Read models for the quality routes and `npm run writer:report`. */

export interface RunSummary {
  applicationId: string;
  jobId: string;
  title: string;
  company: string;
  campaignId: string | null;
  status: string;
  skipped: string | null;
  strategy: string | null;
  lengthArm: string | null;
  explored: boolean;
  critic: number | null;
  lintPass: boolean | null;
  lintFailing: string[];
  truthPass: boolean | null;
  truthHigh: number;
  subject: string;
  updatedAt: string;
}

interface Row {
  id: string;
  job_id: string;
  title: string;
  company: string;
  campaign_id: string | null;
  status: string;
  subject: string;
  notes: string;
  updated_at: string;
}

function summarize(r: Row, w: WriterNotes): RunSummary {
  const variants = loadVariants(r.id);
  const chosen = variants.find((v) => v.chosen);
  const lint = w.quality?.lint ?? chosen?.lint ?? null;
  return {
    applicationId: r.id,
    jobId: r.job_id,
    title: r.title,
    company: r.company,
    campaignId: r.campaign_id,
    status: w.status,
    skipped: w.skipped,
    strategy: w.strategy,
    lengthArm: w.lengthArm,
    explored: w.explored,
    critic: w.quality?.critic.score ?? chosen?.critic?.score ?? (variants.length ? Math.max(...variants.map((v) => v.critic?.score ?? 0)) : null),
    lintPass: lint ? lint.pass : null,
    lintFailing: lint ? lint.checks.filter((c) => !c.pass).map((c) => c.id) : [],
    truthPass: w.quality?.truth.pass ?? null,
    truthHigh: w.quality?.truth.issues.filter((i) => i.severity === 'high').length ?? 0,
    subject: r.subject,
    updatedAt: r.updated_at,
  };
}

/** The writer's most recent runs (written and skipped), newest first. */
export function recentRuns(limit = 20, filter: { status?: 'written' | 'skipped'; campaignId?: string } = {}): RunSummary[] {
  const rows = all<Row>(
    `SELECT a.id, a.job_id, j.title, j.company, a.campaign_id, a.status, a.subject, a.notes, a.updated_at
       FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE json_extract(a.notes, '$.writer.version') IS NOT NULL
        ${filter.campaignId ? 'AND a.campaign_id = ?' : ''}
      ORDER BY a.updated_at DESC LIMIT ?`,
    ...(filter.campaignId ? [filter.campaignId] : []),
    Math.max(1, Math.min(limit * 3, 600)),
  );
  return rows
    .map((r) => ({ r, w: readNotes(r.notes).writer }))
    .filter((x): x is { r: Row; w: WriterNotes } => !!x.w && (!filter.status || x.w.status === filter.status))
    .slice(0, limit)
    .map(({ r, w }) => summarize(r, w));
}

export interface QualityDetail {
  summary: RunSummary;
  writer: WriterNotes;
  variants: VariantRecord[];
  issues: { claim: string; reason: string; severity: string; origin: string }[];
  coverLetter: string;
  outreach: string;
  cv: unknown;
}

export function applicationQuality(applicationId: string): QualityDetail | null {
  const r = get<Row & { cover_letter: string; message: string; cv: string }>(
    `SELECT a.id, a.job_id, j.title, j.company, a.campaign_id, a.status, a.subject, a.notes, a.updated_at, a.cover_letter, a.message, a.cv
       FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?`,
    applicationId,
  );
  if (!r) return null;
  const notes = readNotes(r.notes);
  if (!notes.writer) return null;
  let cv: unknown = {};
  try {
    cv = JSON.parse(r.cv);
  } catch {
    /* keep {} */
  }
  return { summary: summarize(r, notes.writer), writer: notes.writer, variants: loadVariants(r.id), issues: notes.issues, coverLetter: r.cover_letter, outreach: r.message, cv };
}

/** Gate pass rates over the last N runs, for the report header and the UI. */
export function qualityTotals(runs: RunSummary[]) {
  const written = runs.filter((r) => r.status === 'written');
  const skipped = runs.filter((r) => r.status === 'skipped');
  const reasons = new Map<string, number>();
  for (const s of skipped) {
    const k = (s.skipped ?? 'unknown').split(':')[0];
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  const avg = written.length ? written.reduce((a, r) => a + (r.critic ?? 0), 0) / written.length : null;
  return {
    runs: runs.length,
    written: written.length,
    skipped: skipped.length,
    avgCritic: avg === null ? null : Math.round(avg * 10) / 10,
    skipReasons: [...reasons].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
  };
}
