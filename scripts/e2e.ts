/**
 * End-to-end run of the whole system against local fixtures, offline:
 * temp data dir, Claude replay, hash embeddings, the ATS fixture server, a
 * seeded fictional candidate. Then campaign → scout → match → write → fill →
 * verify → rehearse → live submit → inbox → alert + learning plan → digest,
 * plus crash/resume, kill switch and an external agent over /api/v1 and MCP.
 *
 *   npm run e2e                       every stage; pending stages don't fail the run
 *   npm run e2e -- --strict           pending counts as failure (integration)
 *   npm run e2e -- --only submit,inbox  run a subset (prerequisites still run)
 *   npm run e2e -- --list             list stages
 *   npm run e2e -- --keep             keep the sandbox for inspection
 *   npm run e2e -- --headful          watch the browser
 *   npm run e2e -- --report out.json  write the JSON report somewhere specific
 *
 * Exit code: 0 when nothing failed (and, with --strict, nothing is pending).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { E2E_NOW_DEFAULT, installClock } from './e2e/clock.ts';
import { startFixtureServer } from './fixture-server.ts';

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const strict = flag('--strict') || process.env.BUREAU_STRICT === '1';
const keep = flag('--keep');
const headful = flag('--headful');

// 0. A pinned clock, so date-bearing prompts hash the same every day (scripts/e2e/clock.ts).
if (!process.env.BUREAU_E2E_NOW) process.env.BUREAU_E2E_NOW = E2E_NOW_DEFAULT;
installClock();

// 1. Sandbox and environment, before any app module reads it.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-e2e-'));
const dataDir = path.join(sandbox, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const masterKey = crypto.randomBytes(32).toString('base64');
const fx = await startFixtureServer({ quiet: !process.env.BUREAU_E2E_DEBUG });
const childEnv: Record<string, string> = {
  BUREAU_DATA_DIR: dataDir,
  BUREAU_STARTUP_DIR: path.join(sandbox, 'startup'),
  BUREAU_REPLAY: '1',
  // Offline: the JobSpy sidecar (when installed) would search the live web.
  BUREAU_JOBSPY_PYTHON: 'none',
  BUREAU_EMBED: process.env.BUREAU_EMBED ?? 'hash',
  BUREAU_MASTER_KEY: masterKey,
  BUREAU_REPLAY_DUMP: path.join(sandbox, 'replay-misses'),
  // Test-only allow-list for the guarded browser (honoured only in replay mode; requests/A11.md §2).
  BUREAU_FIXTURE_ORIGINS: `${fx.originA},${fx.originB}`,
  E2E_ORIGIN_A: fx.originA,
  E2E_ORIGIN_B: fx.originB,
  BUREAU_LOG: 'error',
  BUREAU_E2E_NOW: process.env.BUREAU_E2E_NOW ?? '',
  BUREAU_E2E_CLOCK_OFFSET: process.env.BUREAU_E2E_CLOCK_OFFSET ?? '',
};
Object.assign(process.env, childEnv);

const { STAGES } = await import('./e2e/stages.ts');
if (flag('--list')) {
  for (const s of STAGES) console.log(`${s.id.padEnd(16)} ${s.title}${s.needs?.length ? `  (needs ${s.needs.join(', ')})` : ''}`);
  await fx.close();
  process.exit(0);
}

const { runStages } = await import('./e2e/runner.ts');
// Offline from the first stage: until the scout stage installs the e2e feed set, every safeFetch is refused.
// (startCampaign() scouts in the background during the campaign stage; without this it reached the live job boards.)
{
  const { installFetchReplay } = await import('./e2e/fetch-replay.ts');
  await installFetchReplay(() => null);
}
const { campaignConfig } = await import('./e2e/seed.ts');
const { replayMisses } = await import('../server/ai/claude.ts');
type Ctx = import('./e2e/stages.ts').E2EContext;

// --only keeps prerequisites so a subset still has its inputs.
let only: string[] | undefined;
const sel = opt('--only');
if (sel) {
  const want = new Set(sel.split(',').map((s) => s.trim()));
  const add = (id: string) => {
    want.add(id);
    for (const d of STAGES.find((s) => s.id === id)?.needs ?? []) add(d);
  };
  for (const id of [...want]) add(id);
  for (const base of ['seed', 'jobs']) want.add(base);
  only = [...want];
}

const ctx: Ctx = {
  fx,
  sandbox,
  dataDir,
  strict,
  headful,
  childEnv,
  campaignId: '',
  cfg: campaignConfig(),
  jobs: new Map(),
  blockerJobId: null,
  packets: new Map(),
  rehearsals: new Map(),
  submits: new Map(),
  events: [],
  fetchReplay: false,
  feedMisses: [],
  scouted: new Set(),
  mailBridge: { available: false, delivered: 0, errors: [] },
};

// Harness self-test: stand-in modules prove the stage assertions themselves (never for acceptance).
let fakes: { close: () => Promise<void> } | null = null;
if (flag('--fakes')) {
  const { FAKES } = await import('./e2e/stages.ts');
  const { makeFakes } = await import('./e2e/fakes.ts');
  const { chromium } = await import('playwright-core');
  const made = makeFakes(fx, () =>
    process.env.BUREAU_CHROME_PATH
      ? chromium.launch({ executablePath: process.env.BUREAU_CHROME_PATH, headless: !headful })
      : chromium.launch({ channel: 'chrome', headless: !headful }).catch(() => chromium.launch({ channel: 'msedge', headless: !headful })),
  );
  for (const [file, mod] of Object.entries(made.modules)) FAKES[file] = { ...((await import(`../${file}`)) as Record<string, unknown>), ...mod };
  fakes = made;
  console.log('\n!! --fakes: harness self-test with stand-in modules for', Object.keys(made.modules).join(', '));
}

// 2. Mail bridge: mail the fixture server "sends" (Workday verification codes) goes to the inbox ingester.
const { FAKES: fakeMods } = await import('./e2e/stages.ts');
const inboxMod = fakeMods['server/inbox/index.ts'] ?? ((await import('../server/inbox/index.ts')) as Record<string, unknown>);
const ingestRaw = typeof inboxMod.ingestRaw === 'function' ? (inboxMod.ingestRaw as (raw: string) => Promise<unknown>) : null;
ctx.mailBridge.available = !!ingestRaw;
let bridged = 0;
const bridge = setInterval(() => {
  const mail = fx.mail();
  while (ingestRaw && bridged < mail.length) {
    const m = mail[bridged++];
    ingestRaw(m.eml).then(
      () => ctx.mailBridge.delivered++,
      (err: Error) => ctx.mailBridge.errors.push(`${m.subject}: ${err.message}`),
    );
  }
}, 250);

console.log(`\nBureau e2e  ·  sandbox ${sandbox}\nfixtures A ${fx.originA}  B ${fx.originB}  ·  ${fx.manifest.forms.length} forms  ·  ${strict ? 'STRICT' : 'pending allowed'}`);
const t0 = Date.now();
let results: Awaited<ReturnType<typeof runStages<Ctx>>> = [];
try {
  results = await runStages(STAGES, ctx, { only });
} finally {
  clearInterval(bridge);
  await fakes?.close();
}

// 3. Report.
const misses = replayMisses();
const counts = { pass: 0, fail: 0, pending: 0, blocked: 0, skipped: 0 } as Record<string, number>;
for (const r of results) counts[r.status]++;
console.log('\n──────────────── e2e summary');
for (const r of results) {
  const mark = { pass: '✓', fail: '✗', pending: '…', blocked: '⊘', skipped: '–' }[r.status];
  console.log(`${mark} ${r.id.padEnd(15)} ${r.status.padEnd(8)} ${r.reason ? r.reason.slice(0, 150) : ''}`);
}
if (misses.length) {
  const uniq = [...new Map(misses.map((m) => [m.file, m])).values()];
  console.log(`\nMissing Claude recordings (${uniq.length}); request dumps in ${childEnv.BUREAU_REPLAY_DUMP}:`);
  for (const m of uniq.slice(0, 20)) console.log(`  ${m.task.padEnd(14)} ${m.file}`);
  if (uniq.length > 20) console.log(`  … and ${uniq.length - 20} more`);
}
const report = {
  startedAt: new Date(t0).toISOString(),
  seconds: Math.round((Date.now() - t0) / 1000),
  strict,
  counts,
  stages: results,
  replayMisses: misses,
  feedMisses: ctx.feedMisses,
  submissions: fx.submissions().map((s) => ({ seq: s.seq, formId: s.formId, step: s.step, final: s.final, valid: s.valid, errors: s.errors, flags: s.flags })),
  mail: fx.mail().map((m) => ({ to: m.to, subject: m.subject })),
};
const reportPath = path.resolve(opt('--report') ?? path.join(sandbox, 'e2e-report.json'));
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const failed = counts.fail + counts.blocked > 0 || (strict && counts.pending > 0);
console.log(
  `\n${failed ? 'E2E FAILED' : 'E2E OK'}: ${counts.pass} passed, ${counts.pending} pending, ${counts.fail} failed, ${counts.blocked} blocked${counts.skipped ? `, ${counts.skipped} not selected` : ''} in ${report.seconds} s\nreport: ${reportPath}\n`,
);

// 4. Clean up (release the DB first: Windows locks open files).
await fx.close();
const { db } = await import('../server/db.ts');
db.close();
if (!keep && !opt('--report')?.startsWith(sandbox)) {
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    /* a leftover temp folder is harmless */
  }
} else console.log(`sandbox kept: ${sandbox}`);
process.exit(failed ? 1 : 0);
