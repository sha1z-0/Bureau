import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The fixed inputs behind A03's recorded Claude responses. The selfcheck and
 * the recorder (scripts/a03/record-fixtures.ts) both run these exact calls, so
 * the replay hashes match. Change anything here (or a system prompt in
 * server/ai/profile.ts or server/research/index.ts) and re-run the recorder.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = path.join(ROOT, 'fixtures');

/** The selfcheck clock: GitHub's `since=` and the research news window are computed from it. */
export const NOW = new Date('2026-11-01T00:00:00Z');

export const GITHUB_LOGIN = 'ayesha-dev';
export const GITHUB_DIR = path.join(FIXTURES, 'github');

export const PORTFOLIO_URL = 'https://ayesha.example.com/';
export const PORTFOLIO_DIR = path.join(FIXTURES, 'portfolio');

export const LINKEDIN_DIR = path.join(FIXTURES, 'linkedin');

export const RESEARCH_COMPANY = 'Lumen Pay';
export const RESEARCH_DOMAIN = 'lumenpay.example.net';
export const RESEARCH_DIR = path.join(FIXTURES, 'research');
