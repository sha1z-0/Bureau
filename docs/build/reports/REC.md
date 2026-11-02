# REC report: the e2e's Claude recordings

Branch `v2-rec-fixtures` (cut from `v2` without A05 and A06). `npm run typecheck`
is clean, `npm run selfcheck` passes (484 checks, 1 skipped), and every
Claude-dependent stage of `npm run e2e` now runs offline from recordings: no
replay misses are left in the main run.

## e2e before and after

| Stage | Before | After |
| --- | --- | --- |
| seed, profile, campaign, scout, jobs | pass | pass |
| match | pending (10 recordings missing) | **fail on one assertion** (§1 of requests/REC.md); every other check in the stage passes |
| write | pending (13 jobs, every step missing) | **pass**: 13/13 packets, critic 8.2–8.8, lint pass, truth lock clean, 3 variants with 1 chosen, PDFs |
| rehearse, submit | pending (A05) | pending (A05) |
| mail-bridge, inbox, alert, digest | pass | pass (the alert's learning plan is now a recording, not A09's fallback) |
| crash-resume | fail ("never started filling") | pending (reason: the worker's own jobs have no recordings; see requests/REC.md §7) |
| kill-switch | pass | pass |
| external-agent | fail (harness sends an empty JSON body) | fail, same cause (requests/REC.md §6) |
| ui-smoke | pending (UI not built) | pending |
| **Summary** | 10 passed, 5 pending, 2 failed; 37 recordings missing | 11 passed, 4 pending, 2 failed; 0 missing |

## What I had to fix before any recording could match

The brief assumed the e2e's prompts were deterministic. They weren't, so a
recording could never be hit twice. Two consecutive runs gave different
hashes for every match, research and evidence request:

- **Random job ids in prompts.** The match prompt keyed each posting by its
  database UUID, and the writer's job block printed it as well.
  - `server/match/assessment.ts` now keys postings by their position in the
    batch ("1", "2", …) and maps the results back to job ids.
  - `server/match/engine.ts` breaks ties on company, title and URL instead of
    the UUID.
  - `server/writer/context.ts` leaves the id out of the job block.
- **The fixture server's random port** appeared in every posting URL.
  `replayHash()` in `server/ai/claude.ts` now replaces loopback ports with
  `<port>` before hashing. Real hosts are never loopback, so production keys
  don't change.
- **Today's date.** The e2e feeds are shifted to "now", and research asks for
  news "2026-05 onward". `scripts/e2e/clock.ts` pins `Date` at
  `BUREAU_E2E_NOW` (default 2026-11-02T09:00Z), then lets it run at real
  speed. The e2e installs it first. `spawnTs` passes it to every child
  (worker, server) with the same offset.
- **The bandit's `Math.random`.** The length band and strategy pick change
  the letter prompts. `server/writer/pipeline.ts` seeds the bandit with
  `REPLAY_SEED` when replaying and no rng is given.
- **The e2e went online.** `startCampaign()` scouts in the background, and
  the campaign stage ran before the scout stage installed the fetch replay.
  Every full run fetched the live job boards, which also made the job set
  vary.
  - `scripts/e2e.ts` now refuses every `safeFetch` until the scout stage
    installs the e2e feed set.
  - The campaign stage awaits `getEngine().settle()`.
  - My baseline run and one verification run (before I found this) made those
    public GET requests to WeWorkRemotely, RemoteOK and others. Nothing was
    submitted.

A02's and A04's own fixtures changed hash with these fixes, so I re-recorded
them with their own scripts. I also changed `server/writer/record-fixtures.ts`:
it used to empty whole task folders, which deleted A11's critic recordings and
would have deleted mine. It now deletes only the files it wrote
(`scenario: "a04"`).

## Recordings added (125, all `scenario: "e2e"`)

| Task | Count | What |
| --- | --- | --- |
| scan | 1 | A01's weekly discovery: results are the fixture employers' own boards, so the scout's counts are unchanged |
| match | 6 | five batches covering 25 postings, plus the one-job repeat for Lumen Ledger |
| research | 13 | one brief per employer, on its fictional example.com site, consistent with the feeds and replicas |
| evidence | 13 | evidence maps citing real fact ids; hooks copied from the brief |
| write_cv | 13 | tailored CVs |
| write_letter | 26 | 13 drafts with 3 variants, subjects, outreach and follow-up, plus 13 revisions applying the critic's demands |
| critic | 26 | first scores and re-scores, each looked up by the exact letter text |
| answer_q | 13 | why us, why this role, tell us about a project |
| audit | 13 | clean, because every text was checked against the facts first |
| learning_plan | 1 | the Lumen Ledger crash plan for this run's gaps (AWS) |

For each job, one variant is polished in Rania's voice and scores 8.2–8.8:
hook ×6, proof ×5, story ×2. The other two are plausible weaker drafts with
specific demands. The critic quotes their stock lines, flattery and vague asks.
After revision they score 6.3–7.9, so the chosen letter never depends on the
bandit's random pick. The chosen letters measure 207–242 words in the
medium band (205–250). Each reuses at least 2 voice-bank passages, and none
uses a number or tool that is not in her facts.

## How to re-record

The answers are code under `scripts/e2e/recordings/authored/`: `scan`,
`match`, `research`, `learning`, and `letters/<employer>.ts` for the writer.
Each request is identified from its prompt (task, company, step), never from
its hash, so a prompt change only needs a re-run:

```sh
npx tsx scripts/e2e/recordings/record.ts --clean        # ≈ 11 rounds × 3 min; stops when nothing new is answered
npx tsx scripts/e2e/recordings/record.ts --rounds 1 --keep-sandbox
npx tsx scripts/e2e/recordings/bench.ts <sandbox> [company…] [--letters]   # every writer gate, offline, in seconds
```

`record.ts` runs the real e2e (by default the stages that run before the
writer or feed a prompt) and answers what the miss dump asks for. It then
repeats, one pipeline step further each round. It never answers the
humanizer, lint-fix or truth-fix steps: if one is requested, the authored text
is what needs fixing.

`bench.ts` runs `writeApplicationRun` on a copy of a sandbox with a fake Claude
that serves the authored answers. It prints each step, every variant's lint
values, truth issues, and the outreach, follow-up and answers that were kept.

Note: the match assertion in §1 stops that stage before the one-job repeat
call. To record that call I patched the assertion locally during the
recording run and reverted it afterwards. Nothing weakened is committed.

## Still failing, and why

- **match:** `stretch.blockers.length > 0` for the Sentinel clearance job.
  A02's hard filter skips the job for its on-site Huntsville location before
  Claude reads the clearance requirement. That is correct behaviour, so the
  assertion can't pass. Proposed fixes are in requests/REC.md §1; it's the
  lead's call.
- **external-agent:** the stage's `api()` helper always sends
  `content-type: application/json`. Fastify rejects the body-less
  `POST /packet` with a 400. Once fixed, that stage's extra job also needs a
  writer chain (§6).
- **crash-resume:** now pending. The worker seeds its own "Worker Co" jobs,
  which need their own writer recordings. Those are worth adding once A05's
  `fillApplication` exists (§7).
- **rehearse, submit:** pending on A05. **ui-smoke:** pending until the UI is
  built.

## Gate concerns (no gate or threshold was changed)

These are written up in `docs/build/requests/REC.md`:

- **§2:** the truth lock's scope-verb lookahead has no word boundary, so
  "My lead asked…" (from the voice bank) is flagged as "led".
- **§3:** the employer-in-prose rule flags gap admissions as unknown
  employers, e.g. "I haven't worked with CRDTs".
- **§4:** `specific_opening` only accepts the full company name, so
  "Copperline's post…" and "Kranich's post…" fail.
- **§5:** the e2e's fact store has 9 of the CV's 20 skills. JavaScript,
  Express, REST APIs and Git all fail the truth lock, and a real matcher will
  emit them as keywords that the lock then watches.

## Commits

- `2f80680` replay determinism
- `15dfe7d` recorder, bench and authored answers
- `cac09ee` first recordings
- `b3fc85a` offline-first e2e and the full stage set
- `8eef2e8` the final re-record with the worker pending fix
- `8174be4` this report

Temporary sandboxes, dumps and bench copies were deleted.
