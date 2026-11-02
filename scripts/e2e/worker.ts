/**
 * The autopilot in a separate process, so the e2e can SIGKILL it mid-fill and
 * restart it (crash/resume), or drop a STOP file on it (kill switch).
 *
 *   worker.ts seed <campaignName> <formId> <url> [<formId> <url> ...]
 *   worker.ts run            first start: startCampaign(E2E_CAMPAIGN_ID), then tick() forever
 *   worker.ts resume         a restart: startAutopilot() only (what server boot does), then tick()
 *
 * Environment comes from the parent (BUREAU_DATA_DIR, BUREAU_REPLAY, …).
 * Status goes to stdout as `E2E {json}` lines. Exit code 3 = a module is not
 * built yet (NotImplemented) → the parent reports the scenario as pending.
 */
const say = (o: Record<string, unknown>) => console.log(`E2E ${JSON.stringify(o)}`);

const [mode, ...args] = process.argv.slice(2);

function notBuilt(err: unknown): boolean {
  return (err as Error)?.name === 'NotImplemented';
}

async function installReplay() {
  const { feedResolver, installFetchReplay } = await import('./fetch-replay.ts');
  const ok = await installFetchReplay(feedResolver('e2e', { ORIGIN_A: process.env.E2E_ORIGIN_A ?? '', ORIGIN_B: process.env.E2E_ORIGIN_B ?? '' }));
  say({ fetchReplay: ok });
}

try {
  if (mode === 'seed') {
    const { seedProfile, campaignConfig, insertCampaign, insertJob, advanceTo } = await import('./seed.ts');
    const { CONNECTORS } = await import('../../server/sources/index.ts');
    seedProfile();
    // No scouting in these scenarios: every connector off, jobs pre-selected.
    const cfg = campaignConfig({ sources: Object.fromEntries(CONNECTORS.map((c) => [c.id, false])) });
    const campaignId = insertCampaign(args[0] ?? 'e2e worker', cfg);
    const jobs: Record<string, string> = {};
    for (let i = 1; i + 1 < args.length; i += 2) {
      const [formId, url] = [args[i], args[i + 1]];
      const id = insertJob({ fingerprint: `e2e-worker:${formId}`, title: `Worker scenario ${formId}`, company: `Worker Co ${formId}`, url, ats: formId.split('-')[0], campaignId });
      advanceTo(id, 'selected', 'e2e: worker seed');
      jobs[formId] = id;
    }
    say({ seeded: true, campaignId, jobs });
    process.exit(0);
  }

  if (mode === 'run' || mode === 'resume') {
    await installReplay();
    const campaign = await import('../../server/campaign/index.ts');
    if (mode === 'run') {
      await campaign.startCampaign(process.env.E2E_CAMPAIGN_ID ?? '');
      say({ started: true });
    } else {
      campaign.startAutopilot();
      say({ resumed: true });
    }
    let ticks = 0;
    for (;;) {
      await campaign.tick();
      ticks++;
      if (ticks % 10 === 0) say({ ticks });
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.error(`unknown mode ${mode}`);
  process.exit(2);
} catch (err) {
  if (notBuilt(err)) {
    say({ notImplemented: (err as Error).message });
    process.exit(3);
  }
  say({ error: (err as Error).message, code: (err as { code?: string }).code ?? null });
  process.exit(1);
}
