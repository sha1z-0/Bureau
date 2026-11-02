/**
 * Canonical replay recordings used by selfcheck to prove replay mode end to end
 * (served, schema-checked, metered, and rejected when malformed). They also
 * document the recording format for other agents.
 *
 *   npx tsx scripts/e2e/replay-fixtures.ts     (re)write them under fixtures/claude/
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FIXTURES } from './manifest.ts';

export const REPLAY_SYSTEM = [{ type: 'text' as const, text: 'Bureau replay selfcheck (A11). You are a skeptical senior hiring manager scoring one cover letter.' }];
export const REPLAY_OK_CONTENT = 'Score this letter: "Your ledger API turns payment events into a general ledger, and I have spent two years on the other side of that problem."';
export const REPLAY_BAD_CONTENT = 'Score this letter (malformed recording fixture).';
export const RESEARCH_PROMPT = 'Research Lumen Ledger (lumenledger.example.com) for a cover-letter hook. Replay selfcheck fixture.';

export const CRITIC_OUTPUT = {
  score: 8.4,
  scores: { specificity: 9, evidence: 8.5, voice: 8, clarity: 9, ask: 7.5, aiTells: 8.5 },
  demands: ['Name the reconciliation result in the first paragraph, not the third.', 'Cut "I would be glad to talk" to a concrete ask.'],
};

/** Hashes are computed with the same function replay mode uses. */
export async function writeReplayFixtures() {
  const { replayHash } = await import('../../server/ai/claude.ts');
  const out: string[] = [];
  const write = (task: string, hash: string, body: object) => {
    const file = path.join(FIXTURES, 'claude', task, `${hash}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ task, hash, ...body }, null, 2) + '\n');
    out.push(path.relative(FIXTURES, file));
  };
  const usage = { input_tokens: 412, output_tokens: 96, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  write('critic', replayHash('critic', REPLAY_SYSTEM, REPLAY_OK_CONTENT), { model: 'claude-opus-5-5', usage, output: CRITIC_OUTPUT });
  write('critic', replayHash('critic', REPLAY_SYSTEM, REPLAY_BAD_CONTENT), { model: 'claude-opus-5-5', usage, output: { score: 'high', note: 'deliberately not a CriticResult' } });
  write('research', replayHash('research', REPLAY_SYSTEM, RESEARCH_PROMPT), {
    model: 'claude-sonnet-5-5',
    usage: { input_tokens: 2100, output_tokens: 380, server_tool_use: { web_search_requests: 2 } },
    text: 'Lumen Ledger sells a double-entry ledger API for small online businesses. Its October changelog announced multi-currency journals.',
    sources: [{ url: 'https://lumenledger.example.com/changelog', title: 'Lumen Ledger changelog' }],
  });
  return out;
}

const direct = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (direct) {
  process.env.BUREAU_DATA_DIR ??= path.join((await import('node:os')).tmpdir(), 'bureau-replay-fixtures');
  console.log((await writeReplayFixtures()).join('\n'));
  process.exit(0);
}
