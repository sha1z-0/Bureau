import type { GapReport, LearningPlan } from '../contracts/learning.ts';
import { get } from '../db.ts';
import { buildReport } from './gaps.ts';
import { buildPlan } from './plan.ts';

/** A09 — crash learning plans and the weekly skill-gap report. */

/**
 * Build (or reuse a recent) crash plan for an application's interview or
 * assessment. `opts.startAt` is when the plan starts (the email's date when the
 * inbox triggers it), `opts.force` rebuilds even if a recent plan exists.
 */
export async function buildLearningPlan(
  applicationId: string,
  interviewDate?: string | null,
  opts: { startAt?: string; force?: boolean } = {},
): Promise<{ id: string; plan: LearningPlan }> {
  return buildPlan(applicationId, interviewDate ?? null, opts);
}

/** Build and store the gap report for a period ("2026-W45", "2026-11-01..2026-11-07", default the last 7 days). */
export async function buildGapReport(period?: string): Promise<{ id: string; report: GapReport }> {
  const { id, report } = await buildReport(period);
  return { id, report };
}

/**
 * Telegram `/learning [skill]` (wired by A08's command router; see
 * docs/build/requests/A09.md). With a skill: mark it `learning` (adding it if
 * needed), which lets the writer list it under "Currently learning". Without:
 * list what is being learned and what is queued.
 */
export async function learningCommand(args: string): Promise<string> {
  const { addLearning, listLearning, updateLearning } = await import('../profile/learning.ts');
  const skill = args.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!skill) {
    const items = listLearning();
    const learning = items.filter((i) => i.status === 'learning').map((i) => i.skill);
    const queued = items.filter((i) => i.status === 'queued').map((i) => i.skill);
    return [
      `Learning: ${learning.length ? learning.join(', ') : 'nothing yet'}`,
      `Queued: ${queued.length ? queued.join(', ') : 'nothing'}`,
      'Send /learning <skill> to start one.',
    ].join('\n');
  }
  const existing = get<{ id: string; status: string }>('SELECT id, status FROM learning_list WHERE lower(skill) = lower(?)', skill);
  if (existing?.status === 'learning') return `Already learning ${skill}.`;
  if (existing) updateLearning(existing.id, { status: 'learning' });
  else addLearning({ skill, status: 'learning', notes: 'Started from Telegram.' });
  return `Marked ${skill} as learning. It can now appear under "Currently learning" on your CV.`;
}

export { getPlan, listPlans, deletePlan } from './plan.ts';
export { listGapReports, getGapReport, latestGapReport } from './gaps.ts';
export { learningSettings, saveLearningSettings } from './settings.ts';
