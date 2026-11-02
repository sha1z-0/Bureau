import type { Page } from 'playwright-core';
import type { AgentRunResult, Trace } from '../contracts/agent.ts';
import type { FormField, Recipe } from '../contracts/forms.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { NotImplemented } from '../contracts/stub.ts';

/** A06 — Claude-driven browser agent for unknown forms, and the recipe learning loop. */

/** Fill the form within guardrails. Never presses the final submit: it stops at `done` for A05 to verify. */
export async function agentFill(ctx: { page: Page; fields: FormField[]; packet: ApplicationPacket; jobId: string; signal?: AbortSignal }): Promise<AgentRunResult> {
  void ctx;
  throw new NotImplemented('A06', 'agentFill');
}

export async function compileTrace(traceId: string): Promise<Recipe | null> {
  void traceId;
  throw new NotImplemented('A06', 'compileTrace');
}

/** Store a trace from an external agent; queued for compile and internal shadow verification. Returns the trace id. */
export function submitExternalTrace(trace: Trace, keyId: string): string {
  void trace;
  void keyId;
  throw new NotImplemented('A06', 'submitExternalTrace');
}

/** Recipe coverage by ATS, agent vs recipe runs over time, cost per agent run. */
export function learningMetrics(): Record<string, unknown> {
  throw new NotImplemented('A06', 'learningMetrics');
}
