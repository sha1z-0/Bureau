# E2E-REC report: e2e recordings and autopilot follow-ups

Branch `v2-e2e-rec` (cut from `v2` at 552c947). No writer gate, truth lock, e2e assertion or manifest
expectation was changed. The e2e stays offline: the refuse-all `safeFetch` replay before the scout stage
is untouched, and every Claude answer comes from a recording.

## Before and after (`npm run e2e -- --strict`)

| Stage | Before (e2e-strict-2026-11-02.log) | After |
| --- | --- | --- |
| seed, profile, campaign, scout, jobs, match, write | pass | pass |
| rehearse | **fail**: personio-job stops on "Do you need a work permit to work for a German employer?" | **pass** (27/27, personio-job included) |
| submit | **fail**, 8 items | fail, 6 items, all in the form-engine agent's list (below) |
| mail-bridge, digest | blocked (needs submit) | blocked (needs submit) |
| inbox, alert | pass | pass |
| crash-resume | pending: no writer recordings for the worker's jobs | **pass**: SIGKILL mid-fill, resume, final states needs_you / submitted / submitted, zero double applications |
| kill-switch | **fail**: `database is locked`, "autopilot never got busy" | **pass**: paused 2 s after STOP, nothing reached an employer, killAll() in ms |
| external-agent | pending: no writer recordings for the extra Lumen Ledger job | **pass** |
| ui-smoke | pass | pass (39 steps) |
| Missing Claude recordings | 6 (answer_q) | 4: the form-engine field picks in §1, left unanswered on purpose |
| **Summary** | 10 passed, 2 pending, 3 failed, 2 blocked | 14 passed, 0 pending, 1 failed, 2 blocked (953 s) |

The `submit` stage still fails. All six of its items are form-engine field handling, which the e2ef agent
is fixing in parallel. None of them depends on a recording:

- `widget-react-select`: the skills multi-select gets the CV skills, not PostgreSQL.
- `widget-shadow-dom`: the form reports "Please fix the highlighted fields".
- `breezy-portal`: the work-history and education entries are empty.
- `smartrecruiters-oneclick`: the experience start date and current flag, and the education end date. Its
  `hiringManagerMessage` now passes.
- `teamtailor-careersite`: "Your CV is required" (the upload).
- `workday`: the GPA is "3.4 / 4.0", and the website field gets the portfolio where the manifest expects GitHub.

`lever` (`comments`) and `personio-job` now submit with every expected value.

mail-bridge and digest only wait on `submit`. One earlier full run had a single `ui-smoke` step fail
(`a10-3-kill.ts`: `/api/campaigns` answered 401). It did not happen again in four runs (alone, after
kill-switch, after the worker stages, and in the final full run). It is noted here in case it comes back.

## 1. answer_q for the form replicas

**Cause.** The form engine asks the writer (`answerQuestion`, answer_q step `answer`) for free-text fields
that are not one of the three pre-written answers. That call never carries company research (by design,
`loadContext(jobId, { brief: null })`; its hooks come from the saved evidence map), and the recorder skipped
every writer prompt containing "No company research is available" as "has no research yet (next round)",
so it could never be recorded. There was also no authored answer to give.

**Fix.**
- `scripts/e2e/recordings/authored/writer.ts`: the no-research skip no longer applies to the `answer` step;
  new `formAnswers` per application (`question` as the form labels it, `answer`, optional `maxChars`),
  matched on the prompt's `<form_question>`. Options questions and gate retries are never answered
  (a retry means the authored text is what needs fixing).
- Authored, truthful to Rania's facts and voice bank, in each employer's file:
  - **Northwind Labs** (Lever `comments`, labelled "Additional information"): the honest Fastify-not-NestJS
    gap, ledger-lite's deferred balance constraint (voice bank `vb-proudest-project`), Lahore inside the
    posting's time-zone window.
  - **Meridian Freight** (SmartRecruiters `hiringManagerMessage`, which the engine labels by its id,
    "hiring manager message input"): Lahore is one of the instant-quote cities (research), the logistics
    invoicing service (`f-tess-invoicing`), the first-month pairing the careers page describes.
- `bench.ts` now also runs every authored form answer through `answerQuestionTraced` (the same short lint
  and code truth lock the e2e applies), even when the sandbox job is already submitted. Both pass on the
  first attempt.
- Recorded for the main run and for the crash worker's Lever job (different job text, different hash).

**Not authored, on purpose (form-engine field picks, for the e2ef agent):** the engine also sends
"Education", "Work History" and "Delete" (Pebble Analytics, Breezy's entry sections: a section heading,
a heading and a remove button read as questions) and "Description" (Meridian Freight, the optional
description textarea inside SmartRecruiters' experience entry). Prose for a "Delete" button would be
wrong, and an entry description belongs to the entry (profile data), not to the writer. These four stay as
replay misses until the entry-section work lands; none of them is in a manifest expectation.

## 2. personio-job: "Do you need a work permit to work for a German employer?"

**Fix.** `fixtures/profile/answer-bank.json` gets the owner's answer `ab-work-permit-de`: "Yes", scoped to
Germany (`countries: ["DE"]`), source `owner`. The manifest expects `custom_attribute_2771002 =
custom_option_44101`, which is the "Yes" option, so it agrees. The scope matches because the scouted
posting's location is "Remote · Hamburg".

**A real bug this exposed (fixed in A03's `server/profile/questions.ts`).** A03's intent detection read
"need a work permit" as `work_authorization`. With the new entry, `answerFor()` then answered
"Are you legally authorized to work in Germany?", "Do you have the right to work in Germany?" and
"…in the country where this job is located?" (on a German job) with that **Yes**: the opposite of the
truth. "Do you need / require a work permit" is now the sponsorship intent (yes = needs one; A05's form
synonyms already read it that way) and is excluded from `work_authorization`. Checked with a script over
both a Hamburg and a remote job: the permit question gets "Yes", every authorisation question keeps the
cautious `ab-work-auth` answer, sponsorship questions still get "Yes". The form engine's own attestation
check (`attestOk`, unchanged) still only accepts the saved answer for the exact same attestation.

The A05 selfcheck then showed a second problem. `upsertAnswer` keeps one answer per normalised question
and scope. "Do you need a work permit to work for a German employer?" normalised to plain
"visa sponsorship", so the owner's answer to it replaced their general sponsorship answer. Before the
intent fix it would have replaced the general *authorisation* answer, with a Yes. The country slot now
also reads demonyms that have no other everyday meaning (German, British, Dutch, Irish, Pakistani,
Emirati, Saudi, Qatari, Swiss, Swedish, Canadian, Australian, Singaporean, Egyptian, Malaysian; not French,
Polish, Indian, American…). So that question is "visa sponsorship :: germany": a separate entry that only
applies to German jobs. `selfcheck a03` (45) and `a05` (62) pass.

## 3. A06's agent turns in the e2e

**Decision: record them, keep the agent on.** Only one replica reaches the agent today:
`widget-verify-trap-impossible` (generic path, does not verify). The agent is not tried on adapter runs at
all (the engine only calls it for generic or recipe runs that do not verify, or when no form is found), so
it does not blur what the adapter stages test; `allowAgent: false` would only have removed the one place
where the e2e drives the agent end to end.

- `scripts/e2e/recordings/authored/agent.ts` answers `agent_step` with **A06's own recording oracle**
  (`scripts/a06/oracle.ts`, unchanged), the rule-based filler A06 authors its selfcheck recordings with.
  The oracle reads the structured turn state; the miss dump only has the prompt, so the state is read back
  from the prompt's `<value_keys>`, `<fields>`, `<controls>` and `<history>` blocks. A small layer after a
  failed `done` re-fills the fields the check named once, then gives up (the oracle alone would claim
  `done` three times).
- What the e2e now exercises: agent turn 1 → `done` (the agent sees every field filled) → the engine
  re-verifies the agent's page, catches the trap (the page rewrites the LinkedIn URL) → `needs_you`, nothing
  submitted, in both the rehearse and the submit stage.
- Any new agent turn (a replica change, a new widget) is answered by the next `record.ts` run.

Observation for A06 (not changed): the agent's own `done` check verifies the fields it filled plus empty
required fields, so it accepts a pre-filled wrong value ("https://www.linkedin.com/" where the profile's
URL belongs) and reports "Filled and verified 0 field(s)". The engine's re-verification catches it, so it is
safe, but the agent could compare pre-filled values with the mapper's `suggest` before claiming `done`.

## 4. crash-resume and external-agent writer recordings

**Cause.** The worker scenarios seeded "Worker Co greenhouse-classic" jobs titled "Worker scenario …" with
no posting of their own, so a truthful application (research on a real employer site, hooks, a specific
opening) could not be written for them; the external-agent stage's extra job is a second Lumen Ledger job.

**Fix.**
- `scripts/e2e/worker.ts` seeds each worker job with the replica's own employer and role from `FORM_JOBS`
  (Lumen Ledger, Northwind Labs, Quillstack for crash-resume; Brightwater Health, Tulip & Tern, Kranich,
  Saffron Studio for kill-switch), the same ones the main run applies to. Their own data dir, fingerprints
  and pipeline are unchanged, and nothing in the scenarios' assertions depends on the company name.
- Recorded with `record.ts --stages crash-resume,kill-switch,external-agent`: 9 rounds, 39 recordings
  (research, evidence, CV, letters, critic, revisions, re-scores, short answers, audit), all from the
  existing authored applications, every writer gate passed on the first try (no humanize, lint-fix or
  truth-fix step was ever requested). The recorder's stage summary now also prints rehearse, submit and
  the worker stages.

## 5. kill-switch: `database is locked`

**Root cause.** `server/db.ts` ran `PRAGMA journal_mode = WAL` *before* `PRAGMA busy_timeout = 5000`.
Setting the journal mode takes a lock even when the file is already WAL, and with no busy handler yet it
fails at once with SQLITE_BUSY whenever another connection is opening, recovering or checkpointing the
same file at that instant. In the kill-switch scenario that other connection is the e2e's read-only poller
(`readStates`, every 150 ms) while the freshly spawned worker opens the database; it is a race, which is
why the stage passed alone and failed in the loaded full run (and why crash-resume, same pattern, could
hit it too). The same race exists in production between Bureau and any second process on the DB (a CLI
script, the MCP server).

Reproduced outside Bureau with two read-only pollers and a writer that opens, sets the pragmas and writes
in a loop: the old order failed with `database is locked` on the `journal_mode` statement (1 in about
5,000 opens, every run); `busy_timeout` first gave zero errors across the same runs.

**Fix.** `server/db.ts` sets `busy_timeout` first, then WAL and foreign keys. The e2e's `campaignStatus()`
poller also sets a busy timeout like `readStates()` already did. No retry was added anywhere.

## 6. Found on the way: the e2e's server child was online

The Bureau server that the external-agent and UI-smoke stages spawn (`startServer` → `spawnTs`) never
installed the fetch replay, so its `safeFetch` used the real network. The parent's refuse-all replay
only covers the parent process. In practice the UI-smoke server's weekly discovery ran and stopped
only because its `scan` call had no recording (a replay miss that only showed in the child's dump).
Once that was recorded, discovery would have fetched live job boards.

**Fix.** `scripts/e2e/offline.ts` is preloaded (`--import`) into every child `spawnTs` starts: the server,
the autopilot workers and `scripts/ui-smoke.ts`. It installs the e2e feed set and refuses everything else, and
exits if `safeFetch` has no replay hook. The discovery scan is now recorded with A01's authored answer (the
fixture employers' boards), and the UI-smoke run leaves no replay misses. No other e2e process can reach
the network now.

The external-agent recordings also had to be made in the full run's context: its evidence prompt
carries the Lumen Ledger research the write stage cached. The recordings first made with
`--stages crash-resume,kill-switch,external-agent` only match a subset run (`--only external-agent`), and
both sets are kept. The full-run set was recorded with
`--stages profile,campaign,scout,match,write,inbox,alert,crash-resume,kill-switch,external-agent`. Leave out
`digest`: it pulls in `submit` and makes every round about 15 minutes instead of 4.

## How to re-record

```sh
# writer chains for the worker scenarios and the external agent (≈ 4 min per round)
npx tsx scripts/e2e/recordings/record.ts --stages profile,campaign,scout,match,write,inbox,alert,crash-resume,kill-switch,external-agent
# form questions and agent turns (≈ 15 min per round)
npx tsx scripts/e2e/recordings/record.ts --stages profile,campaign,scout,match,write,rehearse,submit,crash-resume
# check authored texts (letters, CV, short answers and form answers) against every writer gate
npx tsx scripts/e2e/recordings/bench.ts <kept sandbox> [company …]
```

## Commits

- `c6e4705` db: busy_timeout before the WAL pragma (kill-switch)
- `180787f` answer bank: Germany work-permit answer; "need a work permit" is the sponsorship intent
- `65091e1` worker scenarios seed the replicas' employers; their writer chains; recorder handles form questions and agent turns
- `644df4f` bench.ts form answers; Lever and SmartRecruiters form answers
- `6665968` recordings: form answers, the agent's verify-trap turn
- `dca2b23` every e2e child process offline; discovery scan recorded
- `454d3dc` the external-agent full-context recordings
- `b1ff3c6` A03 demonyms in the country slot (keeps the German permit answer separate)
- this report

## Checks

- `npm run typecheck`: clean.
- `npm run selfcheck`: **all 582 checks pass**, on the final tree (b1ff3c6).
- `npm run e2e -- --strict`: the table above is from the full run at `454d3dc`. The A03 demonym fix
  (`b1ff3c6`) came after it and touches no prompt. A last full run on `b1ff3c6` was still in progress when
  the lead asked to wrap up. `selfcheck a03`/`a05` and the polarity script were re-run on it.

## For the lead

- **Re-recording after the merge.** v2's writer changed (volume/quality modes, 2 drafts, critic bar 5,
  new letter and critic prompts, `messages.create` with manual parsing), so every writer recording here
  will change hash. The lead re-records offline with `record.ts`. What this branch adds to that:
  - the recorder answers single form questions (`formAnswers`);
  - it answers agent turns (A06's oracle, read back from the prompt);
  - worker jobs carry real employers;
  - every child process is offline.

  Re-check two things then. First, the authored letters' variant and critic shapes against the new 2-draft
  quality mode (`authored/letters/*`, `writer.ts` `criticOutput`). Second, the form answers with `bench.ts`.
- **Decide:** keep the A03 intent and demonym changes in `server/profile/questions.ts`. I made them because
  the new bank entry otherwise made `answerFor()` answer "authorized to work in Germany?" with Yes, and
  `upsertAnswer` overwrote the owner's sponsorship answer. A03 should review them.
- **For the e2ef agent:**
  - Breezy's "Education", "Work History" and "Delete", and SmartRecruiters' entry "Description", are
    sent to the writer as questions.
  - SmartRecruiters' message box is labelled by its id ("hiring manager message input"), not by its
    section title "Message to the Hiring Team". The authored answer matches "hiring manager message".
    Add the title as a second `question` if the label changes.
- **For A06 (optional):** the agent's `done` accepts a pre-filled wrong value. The engine catches it (see §3).
