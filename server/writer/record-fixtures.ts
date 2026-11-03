/**
 * Writes A04's recorded Claude responses into fixtures/claude/<task>/<hash>.json.
 *
 *   npx tsx server/writer/record-fixtures.ts            write the recordings
 *   npx tsx server/writer/record-fixtures.ts --preview  print each call's label, task and hash; write nothing
 *
 * It seeds the fixture scenario (server/writer/fixtures.ts) in a throwaway
 * database and runs the real pipeline with a fake Claude client that, instead
 * of calling the API, computes the replay hash of each call and saves the
 * hand-written response from server/writer/recorded.ts. No network, no key.
 * Re-run it after changing a writer prompt, the prompt blocks, the scenario or
 * a canned response; the selfcheck names the missing hash otherwise.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { z } from 'zod/v4';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-a04-rec-'));
process.env.BUREAU_DATA_DIR = path.join(sandbox, 'data');
process.env.BUREAU_EMBED = 'hash';
delete process.env.BUREAU_REPLAY;
const preview = process.argv.includes('--preview');

const F = await import('./fixtures.ts');
const R = await import('./recorded.ts');
const { replayHash, FIXTURES_DIR, modelFor } = await import('../ai/claude.ts');
const { writeApplicationRun } = await import('./pipeline.ts');
const { answerQuestionTraced } = await import('./answers.ts');
const { seededRng } = await import('./text.ts');
type WriterAi = import('./ai.ts').WriterAi;
type AskOptions<S extends z.ZodType> = import('./ai.ts').AskOptions<S>;

export const WRITER_TASKS = ['evidence', 'write_cv', 'write_letter', 'critic', 'humanize', 'audit', 'answer_q'] as const;

/** Typical token counts per task, so the replayed cost meter shows realistic numbers. */
const USAGE: Record<string, { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }> = {
  evidence: { input_tokens: 2400, output_tokens: 1900, cache_read_input_tokens: 0, cache_creation_input_tokens: 3600 },
  write_cv: { input_tokens: 3100, output_tokens: 2300, cache_read_input_tokens: 3600, cache_creation_input_tokens: 0 },
  write_letter: { input_tokens: 3400, output_tokens: 2600, cache_read_input_tokens: 3600, cache_creation_input_tokens: 0 },
  critic: { input_tokens: 4200, output_tokens: 700, cache_read_input_tokens: 3600, cache_creation_input_tokens: 0 },
  humanize: { input_tokens: 2100, output_tokens: 180, cache_read_input_tokens: 3600, cache_creation_input_tokens: 0 },
  audit: { input_tokens: 4800, output_tokens: 160, cache_read_input_tokens: 3600, cache_creation_input_tokens: 0 },
  answer_q: { input_tokens: 2600, output_tokens: 520, cache_read_input_tokens: 3600, cache_creation_input_tokens: 0 },
};

F.seedScenario();
const canned: Record<string, unknown> = {
  ...R.cannedResponses(F.factIdOf),
  answer: {
    answer:
      "The worst one was a memory leak in a Rust worker: memory climbed all day and nothing in our code looked wrong. I spent two evenings reading tracing-subscriber's source before I saw that spans dropped across await points were never freed. I wrote the fix, took it through a week of upstream review, and span memory went from 1.2 GB to 140 MB over a day of traffic.",
    option: null,
  },
};

// Remove only this scenario's stale recordings (they carry `scenario: "a04"`); the same
// folders hold other suites' recordings (A11's canonical ones, the e2e's).
if (!preview) {
  for (const t of WRITER_TASKS) {
    const dir = path.join(FIXTURES_DIR, 'claude', t);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        if ((JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { scenario?: string }).scenario === 'a04') fs.rmSync(path.join(dir, f));
      } catch {
        /* not ours */
      }
    }
  }
}

const written: string[] = [];
const ai: WriterAi = {
  async ask<S extends z.ZodType>(opts: AskOptions<S>): Promise<z.infer<S>> {
    const output = canned[opts.label];
    if (output === undefined) throw new Error(`No canned response for step "${opts.label}" (task ${opts.task})`);
    const parsed = opts.schema.parse(output) as z.infer<S>;
    const hash = replayHash(opts.task, opts.system, opts.content);
    written.push(`${opts.label.padEnd(16)} ${opts.task.padEnd(13)} ${hash}`);
    if (!preview) {
      const file = path.join(FIXTURES_DIR, 'claude', opts.task, `${hash}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify({ task: opts.task, hash, scenario: 'a04', model: modelFor(opts.task), usage: USAGE[opts.task], output }, null, 2)}\n`);
    }
    return parsed;
  },
};

const run = await writeApplicationRun(F.JOB_ID, F.CAMPAIGN_ID, { ai, rng: seededRng(F.SEED) });
if ('skipped' in run.result) {
  console.error(`The fixture job was skipped: ${run.result.skipped}`);
  process.exit(1);
}
const answer = await answerQuestionTraced(F.JOB_ID, 'Describe a time you debugged a hard production issue.', { ai });
if (!answer.answered) {
  console.error(`The free-form answer failed its gates: ${JSON.stringify({ lint: answer.lint, truth: answer.truth })}`);
  process.exit(1);
}

console.log(written.join('\n'));
if (process.argv.includes('--verbose')) {
  const { applicationQuality } = await import('./quality.ts');
  const q = applicationQuality(run.applicationId!);
  console.log(
    JSON.stringify(
      {
        steps: q?.writer.steps.map((s) => `${s.step}: ${s.detail}`),
        adjustments: q?.writer.evidenceAdjustments,
        cvChanges: q?.writer.cvChanges,
        cvPages: q?.writer.cvPages,
        subject: q?.writer.subjects[q.writer.subjectIndex],
        answers: Object.keys(q?.writer.shortAnswers ?? {}),
        skills: (q?.cv as { skills: unknown }).skills,
        issues: q?.issues,
        passages: q?.variants.map((v) => `${v.strategy}${v.chosen ? '*' : ''}: ${v.passagesUsed.join(', ')} | ${v.styleTags.join(' ')}`),
      },
      null,
      1,
    ),
  );
}
console.log(`\n${preview ? 'Previewed' : 'Wrote'} ${written.length} recording(s). Critic ${run.result.quality.critic?.score ?? "none"}, lint ${run.result.quality.lint.pass ? 'pass' : 'fail'}, truth ${run.result.quality.truth.pass ? 'clean' : 'not clean'}.`);
const { db } = await import('../db.ts');
db.close();
fs.rmSync(sandbox, { recursive: true, force: true });
