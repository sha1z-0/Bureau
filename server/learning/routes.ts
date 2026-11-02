import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { get } from '../db.ts';
import { AppError } from '../errors.ts';
import { AI_LIMIT, body } from '../routes/util.ts';
import { addLearning, listLearning, updateLearning } from '../profile/learning.ts';
import { buildReport, getGapReport, latestGapReport, listGapReports } from './gaps.ts';
import { buildLearningPlan, learningCommand } from './index.ts';
import { deletePlan, getPlan, listPlans } from './plan.ts';
import { LearningSettingsSchema, learningSettings, saveLearningSettings } from './settings.ts';

/**
 * UI-facing routes for learning plans and gap reports (A09), under /api/learning.
 * The learning list itself belongs to A03 at /api/master/learning; the routes
 * here only change its status from a plan or a gap report.
 *
 *   GET    /api/learning/plans                 plans (?applicationId=&limit=)
 *   GET    /api/learning/plans/:id             one plan
 *   POST   /api/learning/plans                 build ({ applicationId, interviewDate?, force? })
 *   DELETE /api/learning/plans/:id             delete a plan
 *   GET    /api/learning/gaps                  gap reports, newest first (?limit=)
 *   GET    /api/learning/gaps/latest           the newest report (null when none)
 *   GET    /api/learning/gaps/:id              one report
 *   POST   /api/learning/gaps                  build now ({ period? } e.g. "2026-W45")
 *   GET    /api/learning/settings              { autoQueueTopGaps, defaultPlanDays }
 *   PUT    /api/learning/settings              change them (partial)
 *   POST   /api/learning/list/queue            put a gap skill on the learning list as `queued` ({ skill })
 *   POST   /api/learning/list/start            mark a skill `learning`, adding it if needed ({ skill }); same as Telegram /learning
 *   PUT    /api/learning/list/:id/status       set a learning-list item's status ({ status: learning | queued | done })
 */

const id = (req: { params: unknown }) => (req.params as { id: string }).id;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, 'use YYYY-MM-DD');

export async function learningRoutes(app: FastifyInstance) {
  app.get('/api/learning/plans', async (req) => {
    const q = body(z.object({ applicationId: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }), req.query);
    return { items: listPlans(q) };
  });

  app.get('/api/learning/plans/:id', async (req) => {
    const p = getPlan(id(req));
    if (!p) throw new AppError(404, 'NOT_FOUND', 'No such plan');
    return { plan: p };
  });

  app.post('/api/learning/plans', AI_LIMIT, async (req) => {
    const b = body(z.object({ applicationId: z.string().min(1).max(100), interviewDate: DATE.nullable().optional(), force: z.boolean().optional() }), req.body);
    if (!get('SELECT id FROM applications WHERE id = ?', b.applicationId)) throw new AppError(404, 'NOT_FOUND', 'No such application');
    const { id: planId } = await buildLearningPlan(b.applicationId, b.interviewDate ?? null, { force: b.force });
    return { plan: getPlan(planId) };
  });

  app.delete('/api/learning/plans/:id', async (req) => {
    deletePlan(id(req));
    return { ok: true };
  });

  app.get('/api/learning/gaps', async (req) => {
    const q = body(z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }), req.query);
    return { items: listGapReports(q.limit ?? 20) };
  });

  app.get('/api/learning/gaps/latest', async () => ({ report: latestGapReport() }));

  app.get('/api/learning/gaps/:id', async (req) => {
    const r = getGapReport(id(req));
    if (!r) throw new AppError(404, 'NOT_FOUND', 'No such report');
    return { report: r };
  });

  app.post('/api/learning/gaps', AI_LIMIT, async (req) => {
    const b = body(z.object({ period: z.string().max(40).optional() }), req.body);
    const { id: reportId, queued } = await buildReport(b.period);
    return { report: getGapReport(reportId), queued };
  });

  app.get('/api/learning/settings', async () => ({ settings: learningSettings() }));

  app.put('/api/learning/settings', async (req) => ({ settings: saveLearningSettings(body(LearningSettingsSchema.partial(), req.body)) }));

  const Skill = z.object({ skill: z.string().trim().min(1).max(80) });

  app.post('/api/learning/list/queue', async (req) => {
    const { skill } = body(Skill, req.body);
    const existing = listLearning().find((i) => i.skill.toLowerCase() === skill.toLowerCase());
    // Never demote something already being learned.
    if (existing) return { item: existing, added: false };
    return { item: addLearning({ skill, status: 'queued', notes: 'Added from the gap report.' }), added: true };
  });

  app.post('/api/learning/list/start', async (req) => {
    const { skill } = body(Skill, req.body);
    const message = await learningCommand(skill);
    return { message, item: listLearning().find((i) => i.skill.toLowerCase() === skill.toLowerCase()) ?? null };
  });

  app.put('/api/learning/list/:id/status', async (req) => {
    const { status } = body(z.object({ status: z.enum(['learning', 'queued', 'done']) }), req.body);
    return { item: updateLearning(id(req), { status }) };
  });
}
