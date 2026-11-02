import { structured } from '../ai/claude.ts';
import { fence } from '../ai/prompts.ts';

/**
 * The Claude calls A09 makes (inbox_classify, learning_plan, gap_report),
 * behind one injectable seam. Production and selfcheck (replay mode) use the
 * real helper; scripts/a09/record-fixtures.ts swaps in a recorder.
 */
export interface A09Ai {
  structured: typeof structured;
}

const real: A09Ai = { structured };
let current: A09Ai = real;

export function a09Ai(): A09Ai {
  return current;
}

/** Swap the client (tests, the fixture recorder). Returns a restore function. */
export function setA09Ai(fake: A09Ai | null): () => void {
  const prev = current;
  current = fake ?? real;
  return () => {
    current = prev;
  };
}

/**
 * Untrusted email text, safe to put between <email_message> tags: the shared
 * fence() neutralises our other data tags, and this also neutralises any
 * attempt to close or forge the email tag itself.
 */
export function fenceMail(text: string): string {
  return fence(text).replace(/<\s*\/?\s*email_message\b/gi, (m) => m.replace('<', '‹'));
}

/** Errors that mean "the model is unavailable right now", as opposed to bugs. */
export function aiUnavailable(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    typeof code === 'string' &&
    ['NO_API_KEY', 'BUDGET', 'AI_AUTH', 'AI_PERMISSION', 'AI_RATE', 'AI_OFFLINE', 'AI_ERROR', 'AI_REFUSAL', 'AI_TRUNCATED', 'AI_PARSE', 'AI_BAD_REQUEST', 'REPLAY_MISSING'].includes(code)
  );
}
