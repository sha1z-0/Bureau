# REC requests (from recording the e2e's Claude responses)

None of these were changed to make a recording pass. Each is a gate,
assertion or heuristic that I believe is wrong, found while hand-writing
the e2e recordings; the recordings work around them by phrasing, never by
weakening the check.

## §1 A11 / A02: the match stage's clearance-blocker assertion can never pass

`scripts/e2e/stages.ts` (match) asserts, for the Sentinel Defense job:

```ts
assert.ok(b.stretch.blockers.length > 0 && (b.screenPassScore <= 35 || b.decision === 'skipped'), …)
```

The job is on-site in Huntsville, AL (both the scouted feed posting and the
e2e's own fallback). A02's hard filter (`server/match/filters.ts`, `location`)
rejects it before Claude ever reads the clearance requirement, so the result
is `decision: 'skipped'`, score 0, `explain.filter.code: 'location'`, and
`stretch.blockers` is empty by construction (`rejectedMatch()` never has
requirements). `fixtures/feeds/index.json` itself says "matcher must skip it",
which it does. The rest of the stage (inflated Harbor & Pine, repeatable
score, Lumen Ledger selected, blocker not selected) passes with the
recordings in place: I checked it with this one condition bypassed locally,
not committed.

Suggested fix (lead's call, it is an assertion): accept a hard-filter skip as
"capped", e.g.
`b.decision === 'skipped' && (b.stretch.blockers.length > 0 || !!b.explain.filter)`,
or make the blocker job remote (US only) if the intent is to prove Claude
recognises a clearance gate. With a remote US-only posting the `remote_region`
filter would still fire first, so the cleanest test of Claude's blocker
judgement is a remote-anywhere posting that requires a clearance.

## §2 A04 (`server/writer/truth.ts`): scope-verb lookahead has no word boundary

```ts
{ re: /\b(?:led|leading|lead)\b(?!\s+(?:to|by|in)\b)(?=\s+(?:a|an|the|our|my|two|…))/gi, … }
```

The lookahead alternation has no `\b`, so any word that merely *starts* with
"a", "an", "the", "our", "my"… matches: "My lead asked me to write up what
happened" (straight from the voice bank, `vb-failure`) is flagged as a
high-severity "led overstates your scope". Same for the `managed` pattern.
Fix: close the alternation with `\b`, e.g. `(?=\s+(?:a|an|…|rollout)\b)`.

## §3 A04 (`truth.ts`): a gap admission is read as an unknown employer

Rule 4 ("employers named in prose") fires on any sentence with an employment
cue ("worked", "working", "joined", …) followed by a capitalised word after
at/for/with. So honest gap sentences are high-severity truth failures:
"I haven't worked with CRDTs", "I haven't worked with PostGIS", "I worked
with Postgres" (Postgres is not literally in the fact text). The tool rule
right below already skips sentences with `GAP_CUE`; rule 4 should too, and it
should skip terms the tool lexicon or `factBacks()` recognise.

## §4 A04 (`lint.ts` `openingNames`): short company names don't count

`specific_opening` (letters, why-us answers, outreach) only accepts the full
company name minus a legal suffix. A person writes "Copperline's post on
idempotency keys…" or "Kranich's post on partitioning…", which fail because
the job's company is "Copperline Payments" / "Kranich Software GmbH"
(`COMPANY_SUFFIX` strips GmbH, Inc, Labs… but not descriptors like Payments,
Software, Health). The letters now say "Copperline Payments' post", which reads
worse. Suggest also accepting the company's first word when it is
capitalised, at least 5 letters and not a common word.

## §5 A03 / A11 (fixtures): the fact store has 9 of the CV's 20 skills

`fixtures/profile/facts.json` lists TypeScript, Node.js, React, PostgreSQL,
Python, Docker, Fastify, Linux and Burp Suite as skill facts. The CV also
lists JavaScript, Express, REST APIs, Git, Jest, HTML, CSS, Docker Compose,
SQL, pytest and Leaflet; some of those are backed only by incidental words in
achievement facts, the rest by nothing. The truth lock reads facts only, so a
letter or CV that says "JavaScript", "Express", "Git" or "REST APIs" for
Rania fails as an invented skill, and the CV sanitiser silently drops them.
A real Claude matcher will also put "REST APIs", "Git" or "JavaScript" into
`atsKeywords`, which become truth-lock watch terms. The recordings avoid these
words. Either the seed should sync every CV skill into facts (as
`syncCvFacts` does in production) or the e2e should assert that it did.

## §6 A11 (`scripts/e2e/stages.ts`, external-agent): empty JSON body

The stage's `api()` helper always sends `content-type: application/json`, so
`POST /jobs/:id/packet` with no body gets Fastify's 400 "Body cannot be empty
when content-type is set to 'application/json'". Send the header only when
there is a body (or send `{}`). Once fixed, the packet call runs the writer
for the stage's extra Lumen Ledger job ("Junior Backend Engineer (external
agent run)") inside the server child process, which needs its own recordings.

## §7 A11 / A08: worker scenarios need their own recordings once A05 lands

`crash-resume` and `kill-switch` seed their own jobs in a separate data dir
("Worker Co greenhouse-classic", "Worker scenario …", the generic posting, no
match result). The autopilot writes those before it fills, so they need a
full writer chain each (research → evidence → CV → letters → critic → …).
Until `fillApplication` exists the scenario can't get past the writer anyway;
I made `workerPending()` recognise a replay miss in `pipeline.last_error`
("No recorded Claude response…", the message rather than the code), so the
stage now reports pending with the reason instead of "never started
filling". When A05 merges, record these with
`npx tsx scripts/e2e/recordings/record.ts --stages crash-resume,kill-switch`
after adding answers for the "Worker Co" companies under
`scripts/e2e/recordings/authored/` (the worker process's misses are dumped to
its own data dir's `BUREAU_REPLAY_DUMP`, i.e. the sandbox's `replay-misses`).

## Already fixed in the harness (lead, please confirm)

- **The e2e went online.** `startCampaign()` scouts in the background
  (`void this.tick()`), and the campaign stage ran before the scout stage
  installed the fetch replay, so every full `npm run e2e` fetched the live
  WeWorkRemotely, RemoteOK, Remotive… feeds (the baseline run's match batches
  held Toptal, Vercel, Databricks jobs from today's boards). `scripts/e2e.ts`
  now installs a refuse-all replay before the first stage, and the campaign
  stage awaits `getEngine().settle()` so the background tick can't race the
  scout stage. Both runs I made before finding this (the baseline and one
  verification run) did make those public GET requests.
- **Replay could never match in the e2e.** Prompts carried random job UUIDs
  (match, writer), the fixture server's random port, today's date and the
  bandit's `Math.random`. Fixed with a pinned e2e clock (`scripts/e2e/clock.ts`,
  `BUREAU_E2E_NOW`), loopback ports dropped from `replayHash`, batch-position
  keys in the match prompt with a content tie-break, no job id in the writer's
  job block, and a fixed bandit seed in replay mode. A02's and A04's own
  fixtures were re-recorded with their scripts; A04's recorder now deletes
  only its own recordings (it used to wipe whole task folders, including
  A11's critic recordings).
