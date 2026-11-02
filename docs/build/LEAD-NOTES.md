# Lead notes for every agent (read after your brief)

These are the Phase 0 decisions that sit on top of `02-CONTRACTS.md`. They exist so
eleven agents can work at once without touching the same files.

## Your workspace

- You work in your own git worktree on your own branch (the kickoff names both).
  Use absolute paths inside that worktree only. Never edit the main checkout at
  `C:\Users\hp\Desktop\JobHunt` and never switch branches.
- `node_modules` in your worktree is a junction to the main one. **Never run
  `npm install`, `npm ci`, `npm update` or `npx <pkg>` that installs anything** —
  it would rewrite the shared folder. Already installed for you, beyond v1:
  `imapflow`, `mailparser` (+ types), `@modelcontextprotocol/sdk`,
  `@huggingface/transformers`, `unpdf` (PDF → text), `fflate` (zip). If you truly
  need another package, write it in `docs/build/requests/AXX.md` and code a small
  local alternative meanwhile.
- Don't edit `package.json` or `package-lock.json`. The scripts you need exist:
  `typecheck`, `selfcheck`, `e2e`, `ui-smoke`, `fixtures`, `mcp`, `writer:report`
  (the last five point at placeholder files the owning agent replaces).
- Disk is tight (~8 GB free). Don't download large models or datasets. Python
  venvs (A01) live in `sidecars/jobspy/.venv` (gitignored). Keep screenshots small.
- Never fill or submit a form on a real employer site, never create accounts on
  real sites, never send email to real addresses. Reading public job APIs/feeds to
  verify an endpoint is fine (A01). Everything else runs against `fixtures/`.
- Run the server, if you must, with `BUREAU_PORT=<random high port>` and
  `BUREAU_DATA_DIR=<temp dir>` so you never collide with other agents.

## Shared services already built (use them, don't duplicate them)

| Need | Use |
| --- | --- |
| Claude calls | `structured()` / `research()` in `server/ai/claude.ts`. Every call names a task from `TASKS`. Replay mode: `BUREAU_REPLAY=1` reads `fixtures/claude/<task>/<hash>.json`; `replayHash(task, system, content)` gives the hash. To make a recording for a test, write the JSON file yourself (`{ task, hash, model, usage, output }`) with realistic output. |
| Cost | `taskCost(task)` in `server/ai/cost.ts`; budget is enforced inside `structured()`. |
| Embeddings | `embed()`, `cosine()`, `toBlob()`, `fromBlob()` in `server/ai/embed.ts` (local MiniLM; deterministic hash fallback offline and in tests). |
| Pipeline state | `transition()`, `ensurePipeline()`, `pipelineState()` in `server/campaign/pipeline.ts`. Never write the `pipeline` table directly. |
| Claims | `claimJob()`, `releaseClaim()`, `activeClaim()` in `server/campaign/claims.ts`. |
| Events | `emit()` in `server/services/bus.ts`; v2 event shapes in `server/contracts/events.ts`. |
| Untrusted text | `fence()` in `server/ai/prompts.ts`, `htmlToText()`/sanitisers in `server/security/sanitize.ts`, `safeFetch()` for every outbound HTTP request. |
| Secrets | `setSecret()` / `getSecret()` in `server/security/vault.ts`. |
| Stubs | Every cross-module function in 02-CONTRACTS §4 exists as a stub that throws `NotImplemented` (see `server/<module>/index.ts`). Replace your own; call others' freely. In tests, when you depend on a stub that isn't built yet, inject a fake rather than editing someone else's module. |

## Routes

- Each module owns a Fastify plugin in `server/<module>/routes.ts`, already
  registered in `server/index.ts`. Put your UI-facing routes there, under `/api/…`,
  with paths that don't collide with the v1 routes in `server/routes/**` (A10 owns
  those). Document every route you add in your report.
- `/api/v1/*` and `/mcp` bypass the UI session guard and go to
  `server/api/auth.ts` (A07), which fails closed until A07 lands.

## Tests

- Add checks as `scripts/checks/<NN>-<area>.ts` with a default export
  `async ({ check, section, sandbox, sharedBrowser }) => {}` (see
  `scripts/lib/harness.ts`). Use your agent number: `a01-scout.ts`,
  `a05-forms.ts`, … Run only yours with `npm run selfcheck -- a05`.
- Selfcheck runs offline with `BUREAU_REPLAY=1` and `BUREAU_EMBED=hash`, in a
  temporary data dir. No network, no API key, no live sites.
- e2e scenarios go in `scripts/e2e/` (A11 builds the runner and decides the shape).
- `npm run typecheck` covers `server/`, `scripts/` and `web/`. Keep it clean.

## Done means

- `npm run typecheck` and `npm run selfcheck` pass in your worktree.
- Your work is committed on your branch (commit often; the lead merges).
- `docs/build/reports/AXX.md` says what you built, how to run and test it, the
  routes you added, known limits and follow-ups, and ticks your brief's
  acceptance list honestly (✅ / ❌ with the reason).
- Contract changes you need are in `docs/build/requests/AXX.md`, not in
  `server/contracts/` — except where your brief explicitly says you own a file.
