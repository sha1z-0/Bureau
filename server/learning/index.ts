import type { GapReport, LearningPlan } from '../contracts/learning.ts';
import { NotImplemented } from '../contracts/stub.ts';

/** A09 — crash learning plans and the weekly skill-gap report. */

export async function buildLearningPlan(applicationId: string, interviewDate?: string | null): Promise<{ id: string; plan: LearningPlan }> {
  void applicationId;
  void interviewDate;
  throw new NotImplemented('A09', 'buildLearningPlan');
}

export async function buildGapReport(period?: string): Promise<{ id: string; report: GapReport }> {
  void period;
  throw new NotImplemented('A09', 'buildGapReport');
}
