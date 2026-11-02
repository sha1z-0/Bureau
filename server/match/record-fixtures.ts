/**
 * Writes the matcher's replay recordings from server/match/fixtures.ts:
 *   fixtures/claude/match/<hash>.json   one per fixture job (batch of one)
 *   fixtures/claude/score/<hash>.json   the strong match through the v1 scoreJobs path
 * Re-run after changing the rubric, the profile rendering or the job rendering:
 *   npx tsx server/match/record-fixtures.ts
 * The selfcheck (scripts/checks/a02-match.ts) fails with a pointer here when a recording is stale.
 * Each fixture is a batch of one, so its posting key (and result id) is "1".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Never touch the real database: replayHash lives in a module that opens it.
process.env.BUREAU_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-a02-fixtures-'));

const { replayHash, FIXTURES_DIR } = await import('../ai/claude.ts');
const { buildSystemBlocks, renderBatchContent } = await import('./assessment.ts');
const { FIXTURE_ASSESSMENTS, FIXTURE_JOBS, FIXTURE_USAGE, TEST_PROFILE, TEST_V1_PROFILE } = await import('./fixtures.ts');
const { toMatchProfile } = await import('./profile.ts');

const MODEL = 'claude-haiku-5-5';

function fixtureFiles() {
  const out: { task: 'match' | 'score'; hash: string; file: string; body: unknown }[] = [];
  const matchSystem = buildSystemBlocks(TEST_PROFILE);
  for (const key of Object.keys(FIXTURE_JOBS) as (keyof typeof FIXTURE_JOBS)[]) {
    const content = renderBatchContent([FIXTURE_JOBS[key]]);
    const hash = replayHash('match', matchSystem, content);
    out.push({
      task: 'match',
      hash,
      file: path.join(FIXTURES_DIR, 'claude', 'match', `${hash}.json`),
      body: { task: 'match', hash, model: MODEL, case: key, usage: FIXTURE_USAGE[key], output: { results: [{ ...FIXTURE_ASSESSMENTS[key], id: '1' }] } },
    });
  }
  const scoreSystem = buildSystemBlocks(toMatchProfile(TEST_V1_PROFILE));
  const content = renderBatchContent([FIXTURE_JOBS.strong]);
  const hash = replayHash('score', scoreSystem, content);
  out.push({
    task: 'score',
    hash,
    file: path.join(FIXTURES_DIR, 'claude', 'score', `${hash}.json`),
    body: { task: 'score', hash, model: MODEL, case: 'strong (v1 scoreJobs)', usage: FIXTURE_USAGE.inflated, output: { results: [{ ...FIXTURE_ASSESSMENTS.strong, id: '1' }] } },
  });
  return out;
}

const files = fixtureFiles();
for (const dir of ['match', 'score']) {
  const d = path.join(FIXTURES_DIR, 'claude', dir);
  fs.mkdirSync(d, { recursive: true });
  // Remove stale matcher recordings (only ours: they carry a `case` field).
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8')) as { case?: string };
      if (j.case && !files.some((x) => x.file === p)) fs.rmSync(p);
    } catch {
      /* not ours */
    }
  }
}
for (const f of files) {
  fs.writeFileSync(f.file, JSON.stringify(f.body, null, 2) + '\n');
  console.log(`${f.task}/${path.basename(f.file)}  ${(f.body as { case: string }).case}`);
}
