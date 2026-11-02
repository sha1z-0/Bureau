import type { MasterProfile } from '../contracts/profile.ts';
import { get } from '../db.ts';
import { loadProfile, profileVersion } from '../services/profileStore.ts';
import { listAnswers } from './answers.ts';
import { activeFacts } from './facts.ts';
import { storedGithub } from './github.ts';
import { listLearning } from './learning.ts';
import { getLinks } from './links.ts';
import { localVersion } from './state.ts';
import { listVoice, storedStyle } from './voice.ts';

/**
 * The master profile: the CV extraction plus every active sourced fact, the
 * voice bank, the answer bank, the learning list, links and the GitHub
 * summary. It runs once per job on the campaign's hot path, so it is cached and
 * rebuilt only when something it is made of changed (or after 30 s, for writes
 * from another process such as the MCP server).
 */

const TTL_MS = 30_000;
let cache: { key: string; at: number; value: MasterProfile } | null = null;

function cacheKey(): string | null {
  const row = get<{ updated_at: string }>('SELECT updated_at FROM profile WHERE id = 1');
  return row ? `${row.updated_at}|${profileVersion()}|${localVersion()}` : null;
}

export function loadMasterProfile(): MasterProfile | null {
  const key = cacheKey();
  if (!key) return null;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return structuredClone(cache.value);
  const profile = loadProfile();
  if (!profile) return null;
  const answerBank = listAnswers().map(({ intent: _i, placeholder: _p, ...e }) => e);
  const value: MasterProfile = {
    ...profile,
    facts: activeFacts(),
    voiceBank: listVoice(),
    answerBank,
    learning: listLearning(),
    links: getLinks(profile),
    github: storedGithub(),
    style: storedStyle(),
  };
  // Seeding inside listAnswers() may have bumped the version: key the cache on the state we actually read.
  cache = { key: cacheKey() ?? key, at: Date.now(), value };
  return structuredClone(value);
}

/** Drop the cache (tests, or after a bulk import from outside this module). */
export function invalidateMasterProfile() {
  cache = null;
}
