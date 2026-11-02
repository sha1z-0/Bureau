import type { z } from 'zod/v4';
import { structured, type SystemBlocks, type Task, type UserContent } from '../ai/claude.ts';

/**
 * The writer's Claude calls, behind an injectable seam. Production and the
 * selfcheck (replay mode) use `structured()`; the fixture recorder and the
 * gate tests swap in fakes. `label` names the pipeline step so a fake can
 * answer per step; it is not part of the prompt or the replay hash.
 */
export interface AskOptions<S extends z.ZodType> {
  task: Task;
  label: string;
  system: SystemBlocks;
  content: UserContent;
  schema: S;
  maxTokens?: number;
}

export interface WriterAi {
  ask<S extends z.ZodType>(opts: AskOptions<S>): Promise<z.infer<S>>;
}

export const defaultWriterAi: WriterAi = {
  async ask<S extends z.ZodType>(opts: AskOptions<S>): Promise<z.infer<S>> {
    const { label: _label, ...rest } = opts;
    return structured(rest);
  },
};
