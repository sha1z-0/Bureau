import type { Page } from 'playwright-core';
import type { FixtureServer } from '../../fixture-server.ts';
import type { ExpectedData } from '../manifest.ts';

/**
 * A golden fill is a hand-written Playwright script that completes one fixture
 * form the way a careful human would. It proves the replica is completable and
 * that a correct submission satisfies the manifest's `expect` rules; it is not
 * the form engine (that is A05's job, exercised by the e2e).
 */
export interface GoldenCtx {
  fx: FixtureServer;
  data: ExpectedData;
  /** Absolute paths to the seeded candidate's PDFs (fixtures/profile/*.pdf). */
  files: { cv: string; letter: string };
  /** Long-form answers a writer would produce. */
  text: { coverLetter: string; whyUs: string; project: string };
}

export type GoldenFill = (page: Page, ctx: GoldenCtx) => Promise<void>;
