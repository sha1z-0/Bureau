import type { z } from 'zod/v4';
import { AppError } from '../errors.ts';

export function body<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError(400, 'INVALID', `${first.path.join('.') || 'body'}: ${first.message}`);
  }
  return parsed.data;
}

export const AI_LIMIT = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

export function json<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
