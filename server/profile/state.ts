/**
 * A version counter for everything the master profile is assembled from.
 * Every write in this module bumps it, so `loadMasterProfile()` can serve a
 * cached copy on the hot path (it runs once per job) and still never be stale
 * inside this process.
 */
let version = 0;

export function bump() {
  version++;
}

export function localVersion() {
  return version;
}
