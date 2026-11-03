/**
 * Preloaded (`--import`) into every child process the e2e spawns (the Bureau
 * server for the external-agent and UI-smoke stages, the autopilot workers):
 * safeFetch answers from the e2e feed set and refuses everything else, so no
 * child can reach a live site. Without it the server child's background work
 * (scouting, weekly discovery) would use the real network.
 */
import { feedResolver, installFetchReplay } from './fetch-replay.ts';

const ok = await installFetchReplay(feedResolver('e2e', { ORIGIN_A: process.env.E2E_ORIGIN_A ?? '', ORIGIN_B: process.env.E2E_ORIGIN_B ?? '' }));
if (!ok) {
  console.error('e2e offline preload: safeFetch has no replay hook; refusing to run a child that could reach the network');
  process.exit(4);
}
