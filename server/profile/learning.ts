import crypto from 'node:crypto';
import { z } from 'zod/v4';
import { LearningItemSchema, type LearningItem } from '../contracts/profile.ts';
import { all, get, now, run } from '../db.ts';
import { AppError } from '../errors.ts';
import { bump } from './state.ts';

/**
 * The learning list. The writer may put a skill under "Currently learning" on a
 * CV only while it is here with status `learning`: that is what keeps the
 * section honest.
 */

interface Row {
  id: string;
  skill: string;
  status: LearningItem['status'];
  started_at: string | null;
  notes: string;
}

const toItem = (r: Row): LearningItem => ({ id: r.id, skill: r.skill, status: r.status, startedAt: r.started_at, notes: r.notes });

export function listLearning(): LearningItem[] {
  return all<Row>("SELECT * FROM learning_list ORDER BY CASE status WHEN 'learning' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, lower(skill)").map(toItem);
}

export function learningSkills(): string[] {
  return all<{ skill: string }>("SELECT skill FROM learning_list WHERE status = 'learning' ORDER BY lower(skill)").map((r) => r.skill);
}

export const LearningInput = z.object({
  skill: z.string().trim().min(1).max(80),
  status: LearningItemSchema.shape.status.default('learning'),
  notes: z.string().trim().max(1000).default(''),
});

export function addLearning(input: z.input<typeof LearningInput>): LearningItem {
  const v = LearningInput.parse(input);
  const dup = get<Row>('SELECT * FROM learning_list WHERE lower(skill) = lower(?)', v.skill);
  if (dup) return updateLearning(dup.id, { status: v.status, notes: v.notes || dup.notes });
  const id = crypto.randomUUID();
  run(
    'INSERT INTO learning_list (id, skill, status, started_at, notes) VALUES (?, ?, ?, ?, ?)',
    id,
    v.skill,
    v.status,
    v.status === 'learning' ? now() : null,
    v.notes,
  );
  bump();
  return toItem(get<Row>('SELECT * FROM learning_list WHERE id = ?', id)!);
}

export const LearningPatch = z.object({
  skill: z.string().trim().min(1).max(80).optional(),
  status: LearningItemSchema.shape.status.optional(),
  notes: z.string().trim().max(1000).optional(),
});

export function updateLearning(id: string, patch: z.input<typeof LearningPatch>): LearningItem {
  const p = LearningPatch.parse(patch);
  const cur = get<Row>('SELECT * FROM learning_list WHERE id = ?', id);
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'No such learning item');
  const status = p.status ?? cur.status;
  const startedAt = status === 'learning' && !cur.started_at ? now() : cur.started_at;
  run('UPDATE learning_list SET skill = ?, status = ?, started_at = ?, notes = ? WHERE id = ?', p.skill ?? cur.skill, status, startedAt, p.notes ?? cur.notes, id);
  bump();
  return toItem(get<Row>('SELECT * FROM learning_list WHERE id = ?', id)!);
}

export function deleteLearning(id: string) {
  const res = run('DELETE FROM learning_list WHERE id = ?', id);
  if (!res.changes) throw new AppError(404, 'NOT_FOUND', 'No such learning item');
  bump();
}
