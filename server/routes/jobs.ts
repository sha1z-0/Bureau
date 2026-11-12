import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { captureJob } from '../ai/scout.ts';
import { scoreJobs } from '../ai/score.ts';
import { draftApplication } from '../ai/tailor.ts';
import { all, get, logEvent, now, run } from '../db.ts';
import { AppError } from '../errors.ts';
import { CATEGORIES, type Category } from '../sources/types.ts';
import { emit } from '../services/bus.ts';
import { loadProfile } from '../services/profileStore.ts';
import { ingest } from '../services/scanner.ts';
import { AI_LIMIT, body, json } from './util.ts';

const STAGES = ['found', 'drafted', 'applied', 'interview', 'offer', 'rejected', 'ghosted'] as const;
const STATUSES = ['new', 'shortlisted', 'dismissed'] as const;

const ListQuery = z.object({
  q: z.string().max(200).optional(),
  category: z.enum(CATEGORIES).optional(),
  status: z.enum(STATUSES).optional(),
  stage: z.enum(STAGES).optional(),
  source: z.string().max(40).optional(),
  remote: z.enum(['1', '0']).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  scored: z.enum(['1', '0']).optional(),
  pipeline: z.enum(['1']).optional(),
  sort: z.enum(['score', 'recent', 'posted', 'salary']).default('score'),
  limit: z.coerce.number().min(1).max(500).default(60),
  offset: z.coerce.number().min(0).default(0),
});

interface JobRow {
  id: string;
  source: string;
  url: string;
  title: string;
  company: string;
  location: string;
  remote: number;
  category: Category;
  description_html: string;
  description_text: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  tags: string;
  posted_at: string | null;
  found_at: string;
  prefilter_score: number;
  ai_score: number | null;
  ai_grade: string | null;
  ai_analysis: string | null;
  status: string;
  stage: string;
  apply_email: string | null;
  notes: string | null;
}

function present(r: JobRow, full = false) {
  const analysis = json<Record<string, unknown> | null>(r.ai_analysis, null);
  return {
    id: r.id,
    source: r.source,
    url: r.url,
    title: r.title,
    company: r.company,
    location: r.location,
    remote: !!r.remote,
    category: r.category,
    salary: r.salary_min || r.salary_max ? { min: r.salary_min, max: r.salary_max, currency: r.salary_currency } : null,
    tags: json<string[]>(r.tags, []),
    postedAt: r.posted_at,
    foundAt: r.found_at,
    prefilterScore: r.prefilter_score,
    score: r.ai_score,
    grade: r.ai_grade,
    verdict: (analysis?.verdict as string) ?? null,
    decision: (analysis?.decision as string) ?? null,
    status: r.status,
    stage: r.stage,
    applyEmail: r.apply_email,
    ...(full
      ? { descriptionHtml: r.description_html, descriptionText: r.description_text, analysis, notes: r.notes ?? '' }
      : {}),
  };
}

export async function jobRoutes(app: FastifyInstance) {
  app.get('/api/jobs', async (req) => {
    const q = body(ListQuery, req.query);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.q) {
      where.push('(title LIKE ? OR company LIKE ? OR description_text LIKE ?)');
      const like = `%${q.q.replace(/[%_]/g, '')}%`;
      params.push(like, like, like);
    }
    if (q.category) where.push('category = ?'), params.push(q.category);
    if (q.status) where.push('status = ?'), params.push(q.status);
    else where.push("status != 'dismissed'");
    if (q.stage) where.push('stage = ?'), params.push(q.stage);
    if (q.source) where.push('source = ?'), params.push(q.source);
    if (q.remote === '1') where.push('remote = 1');
    if (q.minScore !== undefined) where.push('COALESCE(ai_score, 0) >= ?'), params.push(q.minScore);
    if (q.scored === '1') where.push('ai_score IS NOT NULL');
    if (q.pipeline) where.push("(stage != 'found' OR status = 'shortlisted')");
    const order = {
      score: 'COALESCE(ai_score, -1) DESC, prefilter_score DESC, found_at DESC',
      recent: 'found_at DESC',
      posted: 'COALESCE(posted_at, found_at) DESC',
      salary: 'COALESCE(salary_max, salary_min, 0) DESC',
    }[q.sort];
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs ${clause}`, ...params)?.n ?? 0;
    const rows = all<JobRow>(`SELECT * FROM jobs ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, q.limit, q.offset);
    return { total, jobs: rows.map((r) => present(r)) };
  });

  app.get('/api/jobs/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    const application = get<{ id: string; status: string }>('SELECT id, status FROM applications WHERE job_id = ? ORDER BY created_at DESC LIMIT 1', id);
    return { ...present(row, true), application: application ?? null };
  });

  const Patch = z.object({
    status: z.enum(STATUSES).optional(),
    stage: z.enum(STAGES).optional(),
    notes: z.string().max(20_000).optional(),
    applyEmail: z.string().max(254).optional(),
  });

  app.patch('/api/jobs/:id', async (req) => {
    const { id } = req.params as { id: string };
    const patch = body(Patch, req.body);
    const job = get<{ title: string; company: string; stage: string }>('SELECT title, company, stage FROM jobs WHERE id = ?', id);
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (patch.status) run('UPDATE jobs SET status = ? WHERE id = ?', patch.status, id);
    if (patch.stage) {
      run('UPDATE jobs SET stage = ? WHERE id = ?', patch.stage, id);
      if (patch.stage !== job.stage) logEvent('stage', `${job.title} at ${job.company} → ${patch.stage}`, id);
    }
    if (patch.notes !== undefined) run('UPDATE jobs SET notes = ? WHERE id = ?', patch.notes, id);
    if (patch.applyEmail !== undefined) run('UPDATE jobs SET apply_email = ? WHERE id = ?', patch.applyEmail || null, id);
    run('UPDATE jobs SET updated_at = ? WHERE id = ?', now(), id);
    emit({ type: 'jobs-changed' });
    return { ok: true };
  });

  app.post('/api/jobs/score', AI_LIMIT, async (req) => {
    const { ids } = body(z.object({ ids: z.array(z.string().max(64)).min(1).max(60) }), req.body);
    const profile = loadProfile();
    if (!profile) throw new AppError(412, 'NO_PROFILE', 'Upload your CV in Profile first.');
    const scored = await scoreJobs(ids, profile, undefined, { skipFilters: true });
    emit({ type: 'jobs-changed' });
    return { scored };
  });

  app.post('/api/jobs/:id/draft', AI_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { instructions } = body(z.object({ instructions: z.string().max(2000).optional() }), req.body);
    const applicationId = await draftApplication(id, instructions ?? '');
    emit({ type: 'jobs-changed' });
    return { applicationId };
  });

  app.post('/api/jobs/capture', AI_LIMIT, async (req) => {
    const input = body(
      z.object({ url: z.string().url().max(2000).optional(), text: z.string().max(60_000).optional() }).refine((v) => v.url || v.text, 'Provide a URL or the post text'),
      req.body,
    );
    const raw = await captureJob(input);
    const { added } = ingest([raw], 3650);
    if (!added.length) {
      const existing = get<{ id: string }>('SELECT id FROM jobs WHERE url = ?', raw.url);
      if (existing) return { id: existing.id, duplicate: true };
      throw new AppError(422, 'NOT_TECH', 'That does not look like a tech role, so Bureau skipped it.');
    }
    const profile = loadProfile();
    if (profile) await scoreJobs(added, profile, undefined, { skipFilters: true }).catch(() => 0);
    logEvent('capture', `Captured ${raw.title} at ${raw.company}`, added[0]);
    emit({ type: 'jobs-changed' });
    return { id: added[0], duplicate: false };
  });
}
