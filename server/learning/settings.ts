import { z } from 'zod/v4';
import { getSetting, setSetting } from '../db.ts';

export const LearningSettingsSchema = z.object({
  /** Owner opt-in: add the week's top 3 gaps to the learning list as `queued`. They reach a CV only once marked `learning`. */
  autoQueueTopGaps: z.boolean(),
  /** Plan length when the interview date is unknown. */
  defaultPlanDays: z.number().int().min(1).max(14),
});
export type LearningSettings = z.infer<typeof LearningSettingsSchema>;

export const DEFAULT_LEARNING: LearningSettings = { autoQueueTopGaps: false, defaultPlanDays: 5 };

export function learningSettings(): LearningSettings {
  const parsed = LearningSettingsSchema.safeParse({ ...DEFAULT_LEARNING, ...getSetting<Partial<LearningSettings>>('learning', {}) });
  return parsed.success ? parsed.data : DEFAULT_LEARNING;
}

export function saveLearningSettings(patch: Partial<LearningSettings>): LearningSettings {
  const next = LearningSettingsSchema.parse({ ...learningSettings(), ...patch });
  setSetting('learning', next);
  return next;
}
