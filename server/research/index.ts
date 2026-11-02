import type { ResearchBrief } from '../contracts/research.ts';
import { NotImplemented } from '../contracts/stub.ts';

/** A03 — public business research on a target company, cached for 14 days. */
export async function researchCompany(company: string, domain?: string): Promise<ResearchBrief> {
  void company;
  void domain;
  throw new NotImplemented('A03', 'researchCompany');
}
