/**
 * Dry-run the writer on the authored answers, offline and in seconds, before
 * recording anything: every gate the e2e enforces (critic ≥ 8 after the code
 * caps, the stylometric lint, the code truth lock, ≥ 3 variants, PDFs) runs
 * for real through writeApplicationRun on a copy of an e2e sandbox, with a
 * fake Claude that answers each step from scripts/e2e/recordings/authored/.
 *
 *   npx tsx scripts/e2e/recordings/record.ts --rounds 1 --keep-sandbox   (once, to get a sandbox)
 *   npx tsx scripts/e2e/recordings/bench.ts <sandbox> [company ...] [--letters]
 *
 * --letters prints every variant's lint checks, not just the chosen one's.
 * Nothing is written to fixtures/; the sandbox itself is left untouched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { z } from 'zod/v4';
import { E2E_NOW_DEFAULT, installClock } from '../clock.ts';

const argv = process.argv.slice(2);
const sandbox = argv.find((a) => !a.startsWith('--'));
if (!sandbox || !fs.existsSync(path.join(sandbox, 'data', 'bureau.db'))) {
  console.error('usage: bench.ts <e2e sandbox dir (with data/bureau.db)> [company ...]');
  process.exit(2);
}
const only = argv.filter((a) => !a.startsWith('--') && a !== sandbox);
const showAll = argv.includes('--letters');

if (!process.env.BUREAU_E2E_NOW) process.env.BUREAU_E2E_NOW = E2E_NOW_DEFAULT;
installClock();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-bench-'));
fs.cpSync(path.join(sandbox, 'data'), path.join(work, 'data'), { recursive: true });
process.env.BUREAU_DATA_DIR = path.join(work, 'data');
process.env.BUREAU_REPLAY = '1';
process.env.BUREAU_EMBED = 'hash';
process.env.BUREAU_LOG = 'error';
delete process.env.BUREAU_REPLAY_DUMP;

const { all, get } = await import('../../../server/db.ts');
const { loadManifest } = await import('../manifest.ts');
const { writeApplicationRun } = await import('../../../server/writer/pipeline.ts');
const { applicationQuality } = await import('../../../server/writer/quality.ts');
const { APPLICATIONS } = await import('./authored/letters/index.ts');
const { stepOutput } = await import('./authored/writer.ts');
type WriterAi = import('../../../server/writer/ai.ts').WriterAi;
type AskOptions<S extends z.ZodType> = import('../../../server/writer/ai.ts').AskOptions<S>;

const forms = loadManifest().forms.filter((f) => f.ats !== 'widget');
const campaignId = get<{ id: string }>("SELECT id FROM campaigns WHERE name = 'E2E campaign'")?.id ?? null;
let failed = 0;

for (const f of forms) {
  const job = get<{ id: string; company: string; title: string }>('SELECT id, company, title FROM jobs WHERE apply_url_canonical LIKE ? ORDER BY found_at LIMIT 1', `%${f.route}%`);
  if (!job) {
    console.log(`?? ${f.id}: no job in the sandbox`);
    continue;
  }
  if (only.length && !only.some((o) => job.company.toLowerCase().includes(o.toLowerCase()) || f.id.includes(o))) continue;
  const a = APPLICATIONS[job.company];
  if (!a) {
    console.log(`-- ${f.id} (${job.company}): nothing authored`);
    continue;
  }
  const calls: string[] = [];
  const ai: WriterAi = {
    async ask<S extends z.ZodType>(opts: AskOptions<S>): Promise<z.infer<S>> {
      calls.push(opts.label);
      const out = stepOutput(a, opts.label, typeof opts.content === 'string' ? opts.content : '');
      if (typeof out === 'string') {
        const c = typeof opts.content === 'string' ? opts.content : JSON.stringify(opts.content);
        const tail = c.includes('Flagged claims:') ? c.slice(c.indexOf('Flagged claims:')) : c.slice(c.lastIndexOf('</job_posting>') > 0 ? c.indexOf('</research>') + 11 : 0);
        throw new Error(`no answer for step ${opts.label}: ${out}
${tail.slice(0, 2500)}`);
      }
      return opts.schema.parse(out) as z.infer<S>;
    },
  };
  try {
    const run = await writeApplicationRun(job.id, campaignId, { ai });
    const q = run.applicationId ? applicationQuality(run.applicationId) : null;
    const res = run.result;
    const ok = !('skipped' in res);
    if (!ok) failed++;
    console.log(`\n${ok ? '✓' : '✗'} ${f.id} — ${job.company}: ${ok ? `critic ${res.quality.critic?.score ?? 'none'}, lint pass, truth clean` : `SKIPPED: ${res.skipped}`}`);
    console.log(`   calls: ${calls.join(' → ')}`);
    for (const s of q?.writer.steps ?? []) console.log(`   · ${s.step}: ${s.detail}`);
    if (q?.writer.evidenceAdjustments.length) console.log(`   evidence adjustments: ${q.writer.evidenceAdjustments.join(' | ')}`);
    if (q?.writer.cvChanges.length) console.log(`   cv changes: ${q.writer.cvChanges.join(' | ')}`);
    for (const v of q?.variants ?? []) {
      if (!showAll && !v.chosen && ok) continue;
      const bad = v.lint?.checks.filter((c) => !c.pass) ?? [];
      const info = v.lint?.checks.filter((c) => ['length', 'burstiness', 'lexical_diversity', 'contractions', 'nominalizations', 'voice_adaptation'].includes(c.id)).map((c) => `${c.id}=${c.value}`).join(' ');
      console.log(`   ${v.chosen ? '*' : ' '} ${v.strategy.padEnd(5)} critic ${v.critic?.score ?? '–'} | ${bad.length ? `LINT FAIL ${bad.map((c) => `${c.id}=${c.value} (${c.target})`).join('; ')}` : 'lint ok'} | ${info} | passages ${v.passagesUsed.join(',')}`);
    }
    const issues = (q?.issues ?? []).filter((i) => i.claim !== 'Quality gate');
    for (const i of issues) console.log(`   truth ${i.severity}: ${i.claim} — ${i.reason}`);
    const answers = q?.writer.shortAnswers ?? {};
    console.log(`   answers: ${Object.keys(answers).join(', ') || 'none'} | outreach ${q?.writer.outreach ? 'kept' : 'DROPPED'} | follow-up ${q?.writer.followUp ? 'kept' : 'DROPPED'} | subject: ${q?.writer.subjects[q.writer.subjectIndex] ?? ''}`);
  } catch (err) {
    failed++;
    console.log(`\n✗ ${f.id} — ${job.company}: ERROR ${(err as Error).message}`);
    console.log(`   calls: ${calls.join(' → ')}`);
    const st = all<{ state: string; last_error: string | null }>('SELECT state, last_error FROM pipeline WHERE job_id = ?', job.id);
    if (st[0]) console.log(`   pipeline: ${st[0].state}`);
  }
}

const { db } = await import('../../../server/db.ts');
db.close();
fs.rmSync(work, { recursive: true, force: true });
console.log(`\n${failed ? `${failed} application(s) failed` : 'all authored applications pass every gate'}`);
process.exit(failed ? 1 : 0);
