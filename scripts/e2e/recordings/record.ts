/**
 * Writes the e2e's recorded Claude responses (scan, match, research and the
 * writer's tasks) into fixtures/claude/<task>/<hash>.json, from the
 * hand-written answers in scripts/e2e/recordings/authored/.
 *
 *   npx tsx scripts/e2e/recordings/record.ts             record until nothing new can be answered
 *   npx tsx scripts/e2e/recordings/record.ts --clean     delete every e2e recording first, then record
 *   npx tsx scripts/e2e/recordings/record.ts --rounds 3  stop after three rounds
 *   npx tsx scripts/e2e/recordings/record.ts --keep-dumps <dir>  copy the requests nobody answered to <dir>
 *   npx tsx scripts/e2e/recordings/record.ts --keep-sandbox      keep the last round's e2e sandbox (for bench.ts)
 *
 * How: each round runs the real e2e (scout, match and write stages) in replay
 * mode, so every prompt is exactly the one the e2e sends. Replay writes each
 * request it has no recording for to the miss dump (BUREAU_REPLAY_DUMP); this
 * script matches each dumped request to its authored answer (by task, company
 * and step, read from the prompt itself), validates it against the request's
 * output schema shape and saves it under the request's replay hash. The next
 * round gets one step further in each pipeline (research → evidence → CV →
 * letters → critic → answers → audit). Rounds stop when a round answers
 * nothing new. No network, no API key: the e2e never leaves the machine.
 *
 * Every recording written here carries `scenario: "e2e"`, so `--clean` can
 * remove exactly these (other suites' recordings share the folders).
 * Re-run after changing a prompt, the e2e scenario or an authored answer.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { answerFor, type DumpedRequest } from './authored/index.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const FIXTURES = path.join(ROOT, 'fixtures', 'claude');
const argv = process.argv.slice(2);
const opt = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const maxRounds = Number(opt('--rounds') ?? 14);
const keepDumps = opt('--keep-dumps');
const stages = opt('--stages') ?? 'scout,match,write';
const keepSandbox = argv.includes('--keep-sandbox');

/** Typical token counts per task, so the replayed cost meter shows realistic numbers. */
const USAGE: Record<string, { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }> = {
  scan: { input_tokens: 21800, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  match: { input_tokens: 4100, output_tokens: 5200, cache_read_input_tokens: 2600, cache_creation_input_tokens: 0 },
  research: { input_tokens: 18400, output_tokens: 1700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  evidence: { input_tokens: 2600, output_tokens: 1900, cache_read_input_tokens: 0, cache_creation_input_tokens: 3700 },
  write_cv: { input_tokens: 3100, output_tokens: 2300, cache_read_input_tokens: 3700, cache_creation_input_tokens: 0 },
  write_letter: { input_tokens: 3500, output_tokens: 2700, cache_read_input_tokens: 3700, cache_creation_input_tokens: 0 },
  critic: { input_tokens: 4300, output_tokens: 700, cache_read_input_tokens: 3700, cache_creation_input_tokens: 0 },
  humanize: { input_tokens: 2100, output_tokens: 180, cache_read_input_tokens: 3700, cache_creation_input_tokens: 0 },
  audit: { input_tokens: 4900, output_tokens: 170, cache_read_input_tokens: 3700, cache_creation_input_tokens: 0 },
  answer_q: { input_tokens: 2700, output_tokens: 560, cache_read_input_tokens: 3700, cache_creation_input_tokens: 0 },
};

function e2eRecordings(): string[] {
  const out: string[] = [];
  if (!fs.existsSync(FIXTURES)) return out;
  for (const task of fs.readdirSync(FIXTURES)) {
    const dir = path.join(FIXTURES, task);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        if ((JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { scenario?: string }).scenario === 'e2e') out.push(path.join(dir, f));
      } catch {
        /* not ours */
      }
    }
  }
  return out;
}

if (argv.includes('--clean')) {
  const old = e2eRecordings();
  for (const f of old) fs.rmSync(f);
  console.log(`removed ${old.length} e2e recording(s)`);
}

function runE2e(): { sandbox: string | null; summary: string } {
  const report = path.join(os.tmpdir(), `bureau-rec-report-${process.pid}.json`);
  const res = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts', 'e2e.ts'), '--only', stages, '--keep', '--report', report], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const text = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const sandbox = text.match(/sandbox kept: (.+)/)?.[1]?.trim() ?? null;
  const summary = text
    .split(/\r?\n/)
    .filter((l) => /^[✓…✗⊘] (scout|match|write)\b/.test(l) || /^E2E (OK|FAILED)/.test(l))
    .join('\n');
  try {
    fs.rmSync(report, { force: true });
  } catch {
    /* fine */
  }
  return { sandbox, summary };
}

function listDumps(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.request.json')).map((f) => path.join(dir, f));
}

let total = 0;
for (let round = 1; round <= maxRounds; round++) {
  const t0 = Date.now();
  const { sandbox, summary } = runE2e();
  if (!sandbox) {
    console.error('the e2e run did not keep a sandbox; output summary:\n' + summary);
    process.exit(1);
  }
  const dumps = listDumps(path.join(sandbox, 'replay-misses'));
  let wrote = 0;
  const unanswered: { task: string; hash: string; why: string; file: string }[] = [];
  for (const file of dumps) {
    const req = JSON.parse(fs.readFileSync(file, 'utf8')) as DumpedRequest;
    let ans: ReturnType<typeof answerFor>;
    try {
      ans = answerFor(req);
    } catch (err) {
      ans = { skip: `authoring error: ${(err as Error).message}` };
    }
    if ('skip' in ans) {
      unanswered.push({ task: req.task, hash: req.hash, why: ans.skip, file });
      continue;
    }
    const target = path.join(FIXTURES, req.task, `${req.hash}.json`);
    const body = { task: req.task, hash: req.hash, scenario: 'e2e', label: ans.label, model: req.model, usage: USAGE[req.task] ?? USAGE.match, ...ans.body };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`);
    wrote++;
  }
  total += wrote;
  console.log(`\n── round ${round} (${Math.round((Date.now() - t0) / 1000)} s): ${dumps.length} miss(es), ${wrote} recorded\n${summary}`);
  for (const u of unanswered) console.log(`   unanswered ${u.task.padEnd(13)} ${u.hash}  ${u.why}`);
  if (keepDumps && unanswered.length) {
    fs.mkdirSync(keepDumps, { recursive: true });
    for (const u of unanswered) {
      const to = path.join(keepDumps, u.task);
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(u.file, path.join(to, path.basename(u.file)));
    }
    console.log(`   unanswered requests copied to ${keepDumps}`);
  }
  const last = !wrote || round === maxRounds;
  if (last && keepSandbox) console.log(`   sandbox kept: ${sandbox}`);
  else {
    try {
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {
      /* a leftover temp folder is harmless */
    }
  }
  if (!wrote) break;
}
console.log(`\n${total} recording(s) written.`);
