/**
 * A05 dev tool: print what the extractor and mapper see on a fixture replica.
 *   npx tsx scripts/a05/dump-fields.ts <formId> [--click "<selector>"]...
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-a05d-'));
process.env.BUREAU_DATA_DIR = path.join(sandbox, 'data');
process.env.BUREAU_REPLAY = '1';
process.env.BUREAU_EMBED ??= 'hash';
const args = process.argv.slice(2);
const id = args[0];
const clicks: string[] = [];
for (let i = 1; i < args.length; i++) if (args[i] === '--click') clicks.push(args[++i]);

const { startFixtureServer } = await import('../fixture-server.ts');
const fx = await startFixtureServer({ quiet: true });
process.env.BUREAU_FIXTURE_ORIGINS = `${fx.originA},${fx.originB}`;
const { seedProfile, insertJob, fallbackPacket, formJob } = await import('../e2e/seed.ts');
const { launchBrowser, guardedContext } = await import('../../server/forms/browser.ts');
const { extractStep } = await import('../../server/forms/extract.ts');
const { mapFieldsWith } = await import('../../server/forms/map.ts');
seedProfile();
const f = fx.form(id);
const meta = formJob(f);
const jobId = insertJob({ fingerprint: `d:${id}`, title: meta.title, company: meta.company, url: fx.url(id), ats: f.ats, campaignId: null });
const packet = fallbackPacket(jobId, 'c', sandbox);
const browser = await launchBrowser(true);
const ctx = await guardedContext(browser);
const page = await ctx.newPage();
await page.goto(fx.url(id));
await page.waitForTimeout(1500);
for (const c of clicks) {
  await page.locator(c).first().click();
  await page.waitForTimeout(800);
}
const ex = await extractStep(page, 0);
const vals = await mapFieldsWith(ex.fields, packet, { writer: false });
for (const fl of ex.fields) {
  const v = vals.find((x) => x.fieldId === fl.id);
  console.log(`${fl.id.padEnd(7)} ${fl.kind.padEnd(9)} ${fl.required ? '*' : ' '} ${JSON.stringify(fl.label).slice(0, 70).padEnd(70)} sec=${JSON.stringify(fl.section ?? '').slice(0, 30)} grp=${fl.meta?.group ? fl.meta.group.name + fl.meta.group.index : '-'} opts=${fl.options?.length ?? '-'} ${JSON.stringify(fl.meta?.cc ?? fl.meta?.trigger ?? fl.meta?.format ?? '')} sel=${fl.selectors[0] ?? ''}`);
  console.log(`         -> ${v ? `${v.unknown ? 'UNKNOWN ' + v.reason : `${v.source}:${v.key} = ${JSON.stringify(v.value).slice(0, 80)} (${v.confidence})`}` : '(none)'}${fl.options ? '  options: ' + fl.options.slice(0, 8).join(' | ') : ''}`);
}
console.log('navs', ex.navs.map((n) => `${n.kind}:${n.text}`).join(', '), '| adders', ex.adders.map((a) => `${a.group}:${a.text}`).join(', '), '| applies', ex.applies.map((a) => a.text).join(', '), '| frames', ex.frames.map((x) => `${x.key}:${x.url.slice(0, 60)}${x.skipped ? ' skipped ' + x.skipped : ''}`).join(', '));
await browser.close();
await fx.close();
const { db } = await import('../../server/db.ts');
db.close();
fs.rmSync(sandbox, { recursive: true, force: true });
process.exit(0);
