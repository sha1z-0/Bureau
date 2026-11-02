import type { MasterProfile } from '../contracts/profile.ts';

/**
 * Where plans and gap reports read the candidate from: A03's master profile in
 * production, a fixed profile in tests and the fixture recorder (so replay
 * hashes do not depend on whatever else is in the database).
 */
type Source = () => Promise<MasterProfile | null>;

const real: Source = async () => (await import('../profile/index.ts')).loadMasterProfile();
let current: Source = real;

export function learningProfile(): Promise<MasterProfile | null> {
  return current();
}

export function setLearningProfileSource(fn: Source | null): () => void {
  const prev = current;
  current = fn ?? real;
  return () => {
    current = prev;
  };
}
