/**
 * A05 dev/test driver: run the form engine against A11's fixture replicas.
 *   npx tsx scripts/a05/run-fixtures.ts [formId ...] [--submit] [--headful] [--verbose]
 * A temp data dir, replay mode, the seeded candidate, fallback packets; prints
 * per form: outcome, verified-field ratio, failing fields, and (with --submit)
 * the manifest expectations against what the fixture server received.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-a05-'));
process.env.BUREAU_DATA_DIR = path.join(sandbox, 'data');
process.env.BUREAU_REPLAY = '1';
process.env.BUREAU_EMBED ??= 'hash';
process.env.BUREAU_MASTER_KEY ??= Buffer.alloc(32, 7).toString('base64');

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const ids = args.filter((a) => !a.startsWith('--'));

const { startFixtureServer } = await import('../fixture-server.ts');
const fx = await startFixtureServer({ quiet: true });
process.env.BUREAU_FIXTURE_ORIGINS = `${fx.originA},${fx.originB}`;
const { seedProfile, insertJob, fallbackPacket, formJob, insertCampaign, campaignConfig } = await import('../e2e/seed.ts');
const { checkExpectations } = await import('../e2e/expect.ts');
const { loadExpected } = await import('../e2e/manifest.ts');
const { runFill } = await import('../../server/forms/engine.ts');
const { launchBrowser } = await import('../../server/forms/browser.ts');

seedProfile();
const campaignId = insertCampaign('a05', campaignConfig());
const data = loadExpected();
const browser = await launchBrowser(!flag('--headful'));
const forms = fx.manifest.forms.filter((f) => !ids.length || ids.some((i) => f.id.includes(i)));
let pass = 0;
const waitForCode = async (_domain: string, timeoutMs: number) => {
  const until = Date.now() + Math.min(timeoutMs, 20_000);
  const seen = fx.mail().length;
  while (Date.now() < until) {
    const m = fx.mail().slice(Math.max(0, seen - 1)).reverse().find((x) => /\b\d{6}\b/.test(x.text));
    if (m) {
      const code = m.text.match(/\b(\d{6})\b/)![1];
      if (flag('--verbose')) console.log(`    [mail] ${m.subject} → code ${code}`);
      return code;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
};
for (const f of forms) {
  const meta = formJob(f);
  const jobId = insertJob({ fingerprint: `a05:${f.id}`, title: meta.title, company: meta.company, url: fx.url(f.id), ats: f.ats, campaignId });
  const packet = fallbackPacket(jobId, campaignId, sandbox);
  const t0 = Date.now();
  const before = fx.submissions({ formId: f.id }).at(-1)?.seq ?? 0;
  try {
    const out = await runFill(packet, { submit: flag('--submit'), campaignId, onUnknown: 'skip' }, { browser: async () => ({ browser, release: () => {} }), waitForCode, recordUnknown: () => 'x' });
    const ok = out.fieldLog.filter((e) => e.ok).length;
    const ratio = out.fieldLog.length ? ok / out.fieldLog.length : 0;
    const want = f.expectedOutcome ?? 'submitted';
    const good = want === 'submitted' ? (flag('--submit') ? out.status === 'submitted' : out.status === 'rehearsed') && ratio >= 0.95 : want === 'needs_you' ? out.status === 'needs_you' : !out.verified;
    if (good) pass++;
    console.log(`${good ? '✓' : '✗'} ${f.id.padEnd(30)} ${out.status.padEnd(9)} via ${out.via} ats ${out.ats} ${ok}/${out.fieldLog.length} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (!good || flag('--verbose')) {
      console.log(`    reason: ${out.reason.slice(0, 600)}`);
      for (const e of out.fieldLog.filter((x) => !x.ok || flag('--verbose'))) console.log(`    ${e.ok ? '·' : '✗'} [${e.kind}] ${e.label.slice(0, 60)} :: want ${JSON.stringify(e.intended)?.slice(0, 60)} got ${JSON.stringify(e.readBack)?.slice(0, 60)} ${e.note ?? ''}`);
      if (out.unknownQuestions.length) console.log(`    unknown: ${out.unknownQuestions.map((u) => u.label).join(' | ')}`);
    }
    if (flag('--submit') && want === 'submitted') {
      const got = fx.submissions({ formId: f.id, final: true }).filter((x) => x.seq > before);
      if (!got.length) console.log('    no final submission recorded');
      for (const sub of got) {
        const exp = checkExpectations(f, sub, data);
        const bad = exp.filter((e) => !e.ok);
        console.log(`    submission valid=${sub.valid} ${sub.errors.join('; ')} flags=${sub.flags.join(',')} expectations ${exp.length - bad.length}/${exp.length}`);
        for (const b of bad) console.log(`      ✗ ${b.key} = ${JSON.stringify(b.got)} (${b.rule})`);
      }
    }
  } catch (err) {
    console.log(`✗ ${f.id.padEnd(30)} THREW ${(err as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
  }
}
console.log(`\n${pass}/${forms.length} forms as expected`);
await browser.close();
await fx.close();
const { db } = await import('../../server/db.ts');
db.close();
fs.rmSync(sandbox, { recursive: true, force: true });
process.exit(0);
