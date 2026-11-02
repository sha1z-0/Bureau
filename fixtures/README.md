# Fixtures

Everything the offline test suites (`npm run selfcheck`, `npm run e2e`) need, so no
test touches a live site or the Anthropic API. Owned by A11; other agents add files
in their own subfolders.

| Path | What | Format |
| --- | --- | --- |
| `ats/<ats>/*.html` | Local replicas of real ATS application forms (structure, widgets, quirks, multi-step flows, confirmation pages), plus widget torture pages in `ats/_widgets/`. Served by `scripts/fixture-server.ts` on a random port; the server records every submission. | HTML (+ small inline JS) |
| `feeds/<source>.json` | One recorded payload per connector, exactly as the source returns it. Includes the same job across several sources for dedupe tests. | Raw JSON / XML / RSS as text |
| `claude/<task>/<hash>.json` | Recorded Claude responses for replay mode. `<hash>` is `replayHash(task, system, content)` from `server/ai/claude.ts`. | `{ task, hash, model, usage, output }` (structured) or `{ ..., text, sources }` (research) |
| `mail/*.eml` | Raw emails covering every inbox class, including verification codes and tricky wording. | RFC 822 |
| `profile/` | A seeded test candidate (CV, voice bank, answer bank, learning list). Fictional person. | JSON / Markdown |

## Replay mode

- `BUREAU_REPLAY=1` serves `fixtures/claude/**` instead of calling the API. A missing
  recording throws `REPLAY_MISSING` with the task and hash, so it is easy to add.
- `BUREAU_RECORD=1` (with a real key) records live responses into the same layout.
- `npm run selfcheck` always runs in replay mode with `BUREAU_EMBED=hash`.

Recordings must be deterministic inputs: keep timestamps and random ids out of
prompts, or the hash changes every run.
