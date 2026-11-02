import { NotImplemented } from '../contracts/stub.ts';

/** A01 — finds the jobs. */

export interface SourceHealth {
  id: string;
  label: string;
  status: 'ok' | 'slow' | 'failing' | 'unavailable' | 'disabled';
  lastRunAt: string | null;
  lastError: string | null;
  found: number;
  added: number;
  ms: number;
}

/** Pull from every enabled source, resolve, normalise, dedupe, filter and insert. Emits pipeline.state → found per new job. */
export async function runScout(opts: { campaignId?: string; sources?: string[] } = {}): Promise<{ found: number; added: string[] }> {
  void opts;
  throw new NotImplemented('A01', 'runScout');
}

export function sourceHealth(): SourceHealth[] {
  return [];
}
