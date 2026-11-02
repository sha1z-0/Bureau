/**
 * Dispatch a dumped replay request to its hand-written answer.
 *
 * The request is identified from the prompt itself (task, company, step),
 * never from its hash, so the answers survive prompt changes that keep the
 * meaning: re-run scripts/e2e/recordings/record.ts and they are saved under
 * the new hashes.
 */
import { agentAnswer } from './agent.ts';
import { learningAnswer } from './learning.ts';
import { matchAnswer } from './match.ts';
import { researchAnswer } from './research.ts';
import { scanAnswer } from './scan.ts';
import { writerAnswer } from './writer.ts';

export interface DumpedRequest {
  task: string;
  hash: string;
  model: string;
  system: string[];
  content: string | unknown[];
  outputFormat: unknown;
}

export type Answer = { label: string; body: { output: unknown } | { text: string; sources: { url: string; title: string }[] } } | { skip: string };

export function contentText(req: DumpedRequest): string {
  if (typeof req.content === 'string') return req.content;
  return req.content.map((b) => (b as { text?: string }).text ?? '').join('\n');
}

export function answerFor(req: DumpedRequest): Answer {
  switch (req.task) {
    case 'scan':
      return scanAnswer(req);
    case 'match':
      return matchAnswer(req);
    case 'research':
      return researchAnswer(req);
    case 'learning_plan':
      return learningAnswer(req);
    case 'agent_step':
      return agentAnswer(req);
    case 'evidence':
    case 'write_cv':
    case 'write_letter':
    case 'critic':
    case 'humanize':
    case 'audit':
    case 'answer_q':
      return writerAnswer(req);
    default:
      return { skip: `no authored answers for task ${req.task}` };
  }
}
