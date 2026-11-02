/**
 * The writer's quality report: the last N applications with their critic,
 * lint and truth-lock results (written and skipped, with reasons).
 *
 *   npm run writer:report                         last 20 runs
 *   npm run writer:report -- --limit 50           last 50
 *   npm run writer:report -- --skipped            only skipped runs
 *   npm run writer:report -- --campaign <id>      one campaign
 *   npm run writer:report -- --detail <appId>     one application: steps, evidence map, variants, every lint check, issues, letter
 *   npm run writer:report -- --json               machine-readable
 *
 * Reads the database in BUREAU_DATA_DIR (default ./data). Read-only; no AI calls.
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const { recentRuns, applicationQuality, qualityTotals } = await import('../server/writer/quality.ts');
const { formatRuns, formatDetail } = await import('../server/writer/report.ts');

const detail = value('detail');
if (detail) {
  const q = applicationQuality(detail);
  if (!q) {
    console.error(`No writer run for application ${detail}.`);
    process.exit(1);
  }
  console.log(flag('json') ? JSON.stringify(q, null, 2) : formatDetail(q));
  process.exit(0);
}

const limit = Math.max(1, Math.min(Number(value('limit') ?? 20) || 20, 500));
const runs = recentRuns(limit, { status: flag('skipped') ? 'skipped' : flag('written') ? 'written' : undefined, campaignId: value('campaign') });
console.log(flag('json') ? JSON.stringify({ totals: qualityTotals(runs), runs }, null, 2) : formatRuns(runs));
