# Bureau v2: build report

Branch `v2`. Written at the end of Phase 3 (the live dry-run rehearsal). The spec is `docs/build/01-PRODUCT-SPEC.md`. Each agent's own report is in `docs/build/reports/`.

## 1. Summary

Bureau v2 is built. All 12 parts of the spec exist and are wired together: onboarding and profile sync, scout, matcher, writer, form engine, browser agent with recipe learning, the external API and MCP server, the campaign autopilot, inbox and follow-ups, the learning engine, digests and alerts, and the UI. The offline suites pass (642/642 self-checks; UI smoke 39 steps). The strict e2e result is in section 4. In Phase 3, Bureau ran on the owner's real profile against live sources in dry run, with every apply channel off. Nothing was submitted and no employer form was opened. The rehearsal found seven problems; all seven are fixed (section 5). Two choices differ from the spec on purpose: the owner set the recruiter-critic bar to 5/10 in quality mode (spec: 8), and the new default volume mode skips the critic and the paid auditor. Real Telegram, IMAP and SMTP have not been tested live. JobSpy is installed and returned real postings. The app is ready for the owner to start a live campaign (section 7).

## 2. What was built

**1. Onboarding and profile** (A03, UI by A10; `reports/A03.md`). CV upload, links, GitHub sync, a voice bank, an answer bank and a learning list. The profile refreshes daily from the CV, GitHub and the portfolio site. Every fact keeps its source and the owner's manual facts survive syncs. An unknown form question goes to the owner, the answer goes into the bank, and the parked job is re-queued. Company research briefs cite a source URL for every claim. The owner's voice bank now holds 8 passages (three bracketed self-notes removed) and 11 owner-stated facts were added.

**2. Scout** (A01; `reports/A01.md`). 33 connectors. 14 ATS families are polled (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee, Personio, Teamtailor, BambooHR, Breezy, JazzHR, Rippling, Pinpoint). Remote boards, HN, Reddit, Rozee.pk and Mustakbil are read too. A JobSpy sidecar reads guest search on LinkedIn, Indeed, Glassdoor, Google, ZipRecruiter, Bayt and Naukri. The company registry grows from every apply URL it sees. Duplicates merge by URL, fingerprint and embeddings. Ghost and scam listings are flagged. Fresh postings (under 48 hours) go first. Hiring signals come from changes in a company's open roles. Health per source shows in the UI.

**3. Matcher** (A02; `reports/A02.md`). Hard filters in code, then embedding pre-rank, then a Claude assessment. The score means "chance of passing the screen". Requirements are split into critical, important and nice. Stretch level (conservative, balanced, aggressive) sets how many unmet important requirements are allowed. Company cooldown works across campaigns. Phase 3 added three caps (section 5).

**4. Writer** (A04; `reports/A04.md`). Decode the posting, research the company (when the mode allows), build an evidence map, assemble the CV PDF, write the letter from the owner's voice-bank passages, then the humanizer, the stylometric lint and the truth lock. It also writes the subject line, short answers and an outreach note. A bandit learns which letter strategy and length get replies. A campaign picks a writing mode (`writingMode`, default `volume`):

- **Volume:** one letter, no critic. One tailored CV per role, reused across jobs. Research only if the company is already cached (no web search). The free code truth check runs; the paid Claude auditor does not. A volume letter must reuse at least 1 voice-bank passage (quality: 2).
- **Quality:** two letter drafts, a recruiter critic with a bar of 5/10, one revision, and the full truth lock (code check plus independent auditor).

**5. Form engine** (A05, follow-up in `reports/E2E-FORMS.md`; `reports/A05.md`). ATS detection, field extraction across frames and open shadow roots, mapping to profile / answer bank / writer / file with a confidence, widget handlers, read-back and verification, and a guard so nothing submits unless `verified: true`. 14 adapters, Workday multi-step included. Recipes, self-heal and demotion. Account creation and email codes for login-walled ATSs, using the job-search mailbox and vault passwords. Step screenshots and a field log for every run.

**6. Browser agent and learning** (A06; `reports/A06.md`). A Claude-driven agent for forms with no recipe, inside guardrails: allowed domains, 60 steps, 6 minutes, no login, no payments, no CAPTCHA solving, never submits on its own. Every action is a trace. Traces compile into recipes, which are shadow-verified and promoted after three matching runs. ATS-scope recipes cover every company on that ATS.

**7. External agent API and MCP** (A07; `reports/A07.md`, `docs/AGENT_API.md`). REST under `/api/v1` and an MCP server over stdio and streamable HTTP. Scoped API keys, rate limits, an audit row for every call, signed file links, claims that stop double applications between Bureau and an outside agent. External traces feed A06's queue but never promote a recipe without internal verification.

**8. Campaign autopilot** (A08; `reports/A08.md`). Campaigns with dates, roles, categories, locations, stretch, minimum score, daily cap, cooldown, active hours with jittered pacing, an AI budget, dry-run days, sources, channels and a writing mode. A durable step journal and claims prevent double applications and let it resume after a crash. It auto-ends with a final digest. Kill switch from the UI, Telegram `/stop` and the `data/STOP` file. Filters (roles, categories, locations, remote-only, stretch, min score) can change at any time and re-sort jobs already found; a new CV or synced facts re-sort too; a written application that no longer fits is not sent. Scouting and matching spend counts toward the campaign budget.

**9. Inbox and follow-up** (A09; `reports/A09.md`). Read-only IMAP. Classifies every message (rejection, interview, assessment, recruiter question, verification code, other), links it to the application and moves its stage. Codes go to the form engine. Interviews and assessments trigger a Telegram alert. One polite follow-up after N days when a contact is known. Never replies to scheduling mail; recruiter questions get a draft for the owner.

**10. Learning engine** (A09; `reports/A09.md`). A day-by-day crash plan for each interview or assessment, a weekly gap report with weekend project ideas, and opt-in auto-queue of top gaps into the learning list.

**11. Reporting** (A08; `reports/A08.md`). Daily and final digests by Telegram, email and ntfy: sent, rehearsed, skipped with reasons, needs-you, new questions, spend, interviews, top gaps, drafts and held mail. Live activity in the UI over SSE.

**12. UI** (A10; `reports/A10.md`, `reports/A10-wiring.md`). Setup wizard, campaigns, pipeline with a per-job timeline, writer studio, forms and recipes, agents and API keys, inbox, learning, sources and companies, questions, digests and settings. Phone layout and an installable PWA, in Cream & Crimson. 54 design screenshots in `design/shots/v2/`.

**Test bed** (A11, REC; `reports/A11.md`, `reports/REC.md`). 27 ATS form replicas, a fixture server, fixture feeds and mail, Claude replay recordings, the e2e runner, UI smoke runner, a security checklist (`docs/SECURITY.md`), a Dockerfile, compose file and CI for Linux.

## 3. Spec checklist

✅ built and tested to the spec. ⚠️ built, with a gap or a deliberate deviation stated in the note. ❌ not built. "Offline" means tested on fixtures and recordings; no live application has been submitted yet.

| Part | Status | Note |
| --- | --- | --- |
| 1. Onboarding and profile | ✅ | All items built. GitHub sync hit the anonymous rate limit in Phase 3; add a token. JavaScript-only portfolio sites yield few facts. |
| 2. Scout | ⚠️ | All source types built. JobSpy 1.4.1 is installed in `sidecars/jobspy/.venv` (Python 3.14, 174 MB); a real Indeed + LinkedIn search through the app's code returned 20 postings, all normalised. GulfTalent, NaukriGulf and Wellfound are unreachable (bot challenges); Bayt only via JobSpy. Comeet, iCIMS, Taleo, SuccessFactors and Oracle HCM are detected, not polled. The resolver is weak: 2 of 150 aggregator links resolved to the employer's apply URL on the first live run. |
| 3. Matcher | ✅ | Built to the spec. Phase 3 added caps: unmet office/residency/relocation requirement is a blocker, a missing critical requirement caps at 55, a senior/staff/lead title caps at 45 for entry or junior candidates. |
| 4. Writer | ⚠️ | Deviations chosen by the owner. The spec asks for three letter variants and a critic bar of 8. Quality mode writes two drafts and uses a bar of 5. Volume mode (the default) writes one letter, has no critic, and runs only the code truth check, not the paid auditor. Lint and the code truth check run in both modes. |
| 5. Form engine | ⚠️ | 27/27 replicas submit with every expected value (`run-fixtures --submit`). iCIMS, Taleo and SuccessFactors adapters are untested (no replicas). Closed shadow roots are filled by focus and typing; a form with a truly unreachable required field parks as `needs_you`. Account creation and email codes are tested on fixtures only. |
| 6. Browser agent and learning | ✅ | Trace → recipe → shadow → promote works end to end on fixtures. Agent recordings are oracle-authored, not live transcripts. The agent cannot click buttons inside cross-origin iframes. |
| 7. External API and MCP | ✅ | REST and MCP built, documented and audited. Rate limits are in memory per process. |
| 8. Campaign autopilot | ✅ | Crash recovery proven at six crash points, dry run to live on a fake clock, kill switch under 5 s. Filters re-sort live; the budget includes scouting and matching. |
| 9. Inbox and follow-up | ⚠️ | Built and tested on fixture emails. Never connected to a real mailbox; IMAP IDLE and real SMTP sending are untested live. |
| 10. Learning engine | ✅ | Crash plans, weekly gap report and opt-in auto-queue built. Resource links are filtered but not fetched to check they are live. |
| 11. Reporting | ⚠️ | Digests and alerts built for Telegram, email and ntfy. Only tested against a mocked Telegram API; no real bot or real SMTP yet. |
| 12. UI | ✅ | Every capability has a screen. PWA install not tried on a physical phone (needs HTTPS or localhost). |
| Bar: Scout ≥ 2,000 unique relevant postings/day, health in UI | ⚠️ | Volume met: one run gives 3,500–5,600 unique new tech postings. Relevance to this owner is lower: hard filters kept ~222 of 3,516 in Phase 3. Per-source health is in the UI. |
| Bar: Writer, lint + truth lock, critic ≥ 8 | ⚠️ | Every letter passes the lint and the code truth check. The auditor runs only in quality mode. The critic bar is 5 in quality mode (owner's choice) and absent in volume mode. |
| Bar: Forms ≥ 95% verified fills per adapter, live rate per ATS | ⚠️ | 100% on all 27 replicas for the 11 adapters that have one. iCIMS, Taleo, SuccessFactors have no replica. The per-ATS rate is tracked but mixes rehearsals and real submissions. |
| Bar: Autopilot, zero doubles, zero unverified submits, resume | ✅ | Enforced in code (`submitVerified`, claims, journal) and tested offline, including the strict e2e `crash-resume` and `kill-switch` stages (section 4). |

## 4. Test results

- **Self-checks:** `npm run selfcheck`, 642/642 pass. Offline, replay mode, hash embeddings.
- **Typecheck:** clean (`npm run typecheck`).
- **UI smoke:** `npm run build && npm run ui-smoke`, 39/39 steps pass.
- **Strict e2e:** `npm run e2e -- --strict`. Results below.

Run on 3 November 2026 after the gap fixes, offline (replay mode, local fixture server), 884 s: **17 passed, 0 pending, 0 failed, 0 blocked.**

| Stage | Result |
|---|---|
| seed | ✅ |
| profile | ✅ |
| campaign | ✅ |
| scout | ✅ |
| jobs | ✅ |
| match | ✅ |
| write | ✅ all 13 employers written in quality mode (two drafts, critic ≥ 5, lint and truth lock pass) |
| rehearse | ✅ |
| submit | ✅ |
| mail-bridge | ✅ |
| inbox | ✅ |
| alert | ✅ |
| digest | ✅ |
| crash-resume | ✅ |
| kill-switch | ✅ |
| external-agent | ✅ |
| ui-smoke | ✅ 39/39 steps |

Notes on the last changes before this run:

- The writer now prefers, among letters that clear the critic, one that already passes the free lint (it saves a paid rewrite or a skip). The A04 checks were updated so the humanizer, lint-fix, truth-lock and final-critic gates are still each tested on a letter that needs them.
- The e2e recordings were re-recorded from scratch for quality mode (two drafts per employer, authored from true facts only).
- The e2e `submit` stage fills forms directly, not through the campaign worker, so it now journals each send the way the worker does; the digest is built from that journal.
- The offline runners (e2e, UI smoke, A01) set `BUREAU_JOBSPY_PYTHON=none`, so an installed JobSpy never reaches the live web during tests.

## 5. Phase 3 rehearsal: findings and fixes

Setup: the owner's real profile, Sonnet 5.5 for every task, prompt caching on every call, dry run, every apply channel off. No employer form was opened and nothing was submitted.

What it did:

- **Scout:** one real run read 47,431 postings from 31 sources and stored 3,516 unique new ones. A second run added more after the registry grew by 154 discovered boards. JobSpy did not run then: its Python venv was not installed yet. It has been installed since (section 7, step 3).
- **Match:** hard filters kept about 222 of the 3,516. Claude scored 40 per cycle.
- **Write:** quality-mode letters were truthful and in the owner's voice; the critic first scored them 6.8–7.2 (see fix 6). The owner then chose volume mode for bulk and a critic bar of 5 for quality mode.

Problems found, and the fix for each:

| # | Problem | Fix | Commit |
| --- | --- | --- | --- |
| 1 | The matcher picked a Senior role, a Paris-office job and a job Claude itself called "unlikely". | Unmet office, residency or relocation requirement is a blocker. A missing critical requirement caps the score at 55. A senior, staff or lead title caps at 45 for entry or junior candidates. | `903da2b` |
| 2 | A Hacker News post whose header ran into the first paragraph stored prose as the title and location. | Prose titles fall back to "Multiple roles"; the location parser takes only short segments. | `e276ae6`, `903da2b` |
| 3 | Scouting and matching spend was not counted in the campaign budget. | It counts now. | `03ad0e1` |
| 4 | A structured answer cut off by `max_tokens` failed (thinking shares the token budget). | One retry with twice the room. | `a94f127` |
| 5 | Failed or cut-off calls were billed but not metered (meter $3.23 vs $3.68 billed). | Every response is metered before its JSON is parsed. | `c2b75eb` |
| 6 | The critic rejected real letters at 6.8–7.2. | Letter prompt tightened: one argument, the role named up front, every gap paired with what the candidate does about it, a concrete ask tied to the role. The critic now judges the letter, not the candidate's level. | `14ec26a`, `fc28a41` |
| 7 | The first volume-mode letter was skipped for reusing only one voice-bank passage; with one draft there is nothing to fall back on. | A volume letter must reuse at least one passage (quality keeps two). | `df06f4d` |

Also during Phase 3: every Claude call caches its system prompt (`c85b1ce`). The owner asked for live re-sorting of campaign filters (`809c802`) and the volume/quality writing modes (`2bd6f5d`).

## 6. Costs

Prices come from the app's own table (`server/ai/claude.ts`): Sonnet 5.5 $2 in / $10 out per million tokens, Haiku 5.5 $0.10 / $0.50, Opus 5.5 $4 / $20.

**Per task, metered in Phase 3** (Sonnet 5.5, rows in `ai_usage` of the rehearsal database):

| Task | Calls | Total | Per call | What one call is |
| --- | ---: | ---: | ---: | --- |
| match | 28 | $1.85 | $0.066 | one batch of up to 6 jobs (≈ $0.011 a job) |
| write_letter | 5 | $0.67 | $0.134 | one letter draft |
| scan | 1 | $0.31 | $0.313 | one Claude deep web search for postings |
| research | 2 | $0.30 | $0.148 | one company brief with web search |
| write_cv | 4 | $0.23 | $0.057 | one tailored CV |
| evidence | 4 | $0.16 | $0.039 | one evidence map |
| critic | 4 | $0.14 | $0.035 | one critic pass |
| score (v1) | 1 | $0.09 | $0.090 | v1 scoring path |
| profile | 1 | $0.05 | $0.053 | CV extraction |
| gap_report | 1 | $0.02 | $0.017 | weekly gap report |
| inbox_classify | 1 | $0.001 | $0.001 | one email the rules could not class |

Total metered at that point: about $3.82.

**Per written application:**

| Mode | Cost | Basis |
| --- | --- | --- |
| Quality | ≈ $0.60 | Measured on Sonnet 5.5 at high effort: research, evidence map, CV, letter drafts, critic, revision, auditor, short answers. |
| Volume | ≈ $0.15–0.22 | Measured on the first live volume job: about $0.22, which includes writing a new role CV. Later jobs for the same role reuse that CV, so they cost less once role CVs are cached. |

Matching on Sonnet: 40 jobs a cycle is about 7 batches, so about $0.46 a cycle. With scouting every 3 hours that is up to about $3.70 a day if every cycle fills its 40 (estimate).

**How to cut cost:**

- **Matching on Haiku 5.5** (Settings → Models → match). Haiku tokens cost 1/20 of Sonnet's in the app's price table, so matching drops to roughly $0.20 a day at the same volume (estimate). Haiku is the shipped default for `match`; Phase 3 overrode it to Sonnet.
- **Medium effort for writing.** `write_letter` and `write_cv` default to high effort (`DEFAULT_EFFORT` in `server/ai/claude.ts`). Medium cuts thinking tokens. Effort is set in code today, not in Settings.
- **Volume mode** for bulk campaigns; keep quality mode for a short list of companies. Few, focused roles per campaign mean more jobs share each cached role CV.
- Less frequent scouting ("Look for new postings every (hours)") or a higher minimum score means fewer matcher batches.
- Not built yet: the Batch API (50% off for non-urgent calls such as matching) and skipping the letter when a form has no letter field.

## 7. How to start a live campaign

Start Bureau with `Bureau.cmd` (or `npm start`) and open `http://127.0.0.1:4317`.

**1. Onboarding** (the setup guide opens by itself on a fresh install; reopen it from Profile → "Open the setup guide").

- Upload the CV. Check Profile → Facts and sources: every fact shows where it came from. Hide anything wrong.
- Links: GitHub, portfolio, LinkedIn URL, socials.
- Voice bank: 6–10 passages in your own words. The current bank has 8.
- Answer bank: fill every group (right to work, pay and start date, where and how you work, experience, contact, how you heard). Unanswered required questions skip jobs.
- Learning list: skills you are learning now. Only these appear under "Currently learning" on the CV.

**2. Settings.**

- Claude API key. Monthly AI budget.
- Models per task. Suggested: Haiku 5.5 for `match`; Sonnet or Opus 5.5 for the writer tasks.
- Job-search mailbox: IMAP (host, port, TLS, user, app password) and SMTP. Press "Test". Use a dedicated mailbox. Then Forms → Accounts: set the account email used for ATS sign-ups (Workday and others).
- Telegram: create a bot with @BotFather, paste the token, message the bot, use "Find my chat", lock the chat id, then "Test". Choose what reaches you (alerts, digest, questions).
- GitHub token: Profile → Links and GitHub → Access token (read-only public access is enough). It lifts the anonymous rate limit that Phase 3 hit.
- Start with Windows on, keep-awake on, so the campaign keeps running.

**3. Optional: JobSpy** (LinkedIn, Indeed, Glassdoor, Google and more, guest search only):

Already installed on this machine. To set it up elsewhere (Bureau runs without it and reports the source as unavailable):

```
Windows:  powershell -ExecutionPolicy Bypass -File scripts/setup-sidecar.ps1
Linux:    bash scripts/setup-sidecar.sh        (the Docker image runs this at build time)
```

This creates `sidecars/jobspy/.venv` (gitignored, about 175 MB) with `python-jobspy>=1.4.1` (wheels for Python 3.10–3.14). To use another interpreter, set `BUREAU_JOBSPY_PYTHON=<path to python>`. Check it from `sidecars/jobspy`: `.venv/Scripts/python -m jobspy_cli --check`. Then check Sources → Health: the `jobspy` source should no longer say "unavailable" (the status is cached for 10 minutes, or restart Bureau).

**4. Create the campaign** (Campaigns → New campaign, or edit the rehearsal campaign):

- Name, start and end dates.
- Roles (job titles), categories (fields), locations, Remote only.
- Stretch level (conservative, balanced, aggressive) and "Lowest score to apply" (min score).
- Writing mode: Volume for bulk, Quality for a short list.
- "Applications a day, at most" (daily cap), cooldown per company, active hours, time zone, pacing gap.
- "AI budget for this campaign (USD)". It pauses when spent.
- "Rehearse for (days)": the dry-run days. 1–2 days is a sensible first run: it fills and verifies every form without sending, then goes live by itself. 0 goes live at once.
- Channels: turn **Forms**, **Email** and **Browser agent** on. In Phase 3 all three were off; with them off nothing is applied to.

All filters can change later; jobs already found are re-sorted.

**5. Start and watch.**

- Press Save and start. The campaign band shows Rehearsing or Live, the next application time and the budget meter.
- Read the daily digest (Telegram, email, or the Digests page). Answer new questions on the Questions page or by replying in Telegram; the job re-queues.
- Check Pipeline → Needs you for CAPTCHA pages and forms that could not verify.

**Kill switch.** Any of these stops everything within 5 seconds and pauses every campaign:

- UI: "Stop everything" in the sidebar (top bar on a phone). Clear it with the Clear button; campaigns stay paused until you resume them.
- Telegram: `/stop`.
- File: create `data/STOP`. Delete it, then resume the campaign.

## 8. Known limits and follow-ups

**Not set up or not tested live**

- Not run on a Linux host. JobSpy is installed on Windows only so far.
- Real Telegram, IMAP and SMTP are untested. Do one check of each before going live: Telegram "Test", mailbox "Test", then one poll.
- No application has been submitted to a real employer yet. The first live days are the real test of the form engine.
- Docker and `docker compose` were written but never built on this machine (disk space).
- PWA install not tried on a physical phone.

**Gaps in what is built**

Closed after the first build (3 November 2026, evening):

- **Resolver:** rewritten (`server/scout/resolve.ts`, `server/sources/boardSearch.ts`). On a live sample of 60 aggregator listings it found the employer's ATS posting for 20 (old resolver: 1). It tries the cache, the listing text and stored postings first, then the company's ATS board, the listing page, a name-guessed board and the employer's careers page, all through `safeFetch` with per-ATS cool-offs. It never fetches LinkedIn, Indeed or Google pages. Misses are mostly staffing agencies, Workday/Oracle employers not yet in the registry and Indeed rows without a direct link.
- **iCIMS, Taleo, SuccessFactors:** realistic local replicas (`fixtures/ats/icims|taleo|successfactors`, served by `fixtures/ats/_staged/server.ts`) and rewritten adapters (`server/forms/adapters/enterprise.ts`). Rehearsal verified 100% on all four replicas, and live submissions to them carry every expected value. Account walls are handled once with a vault password; an existing account with no stored password goes to `needs_you`. The replicas are staged, not part of the e2e (adding them would change recorded request hashes); promote one by renaming its `staged.json` to `manifest.json` and recording its requests. The scout also recognises `*.sapsf.com/eu` and Taleo Business Edition hosts.
- **Iframes and shadow DOM:** the browser agent and form engine operate controls inside cross-origin iframes and open shadow roots. A required field in a closed shadow root goes to `needs_you` with the reason.
- **Notice period vs start date:** separate answer-bank questions; old rows are re-keyed in code. A start-date question with no saved date can use the notice period as text, never in a date field.
- **Dates:** a required field that needs a month the profile does not have goes to `needs_you` instead of getting January.
- **Forms coverage:** rehearsal and live rates are reported separately per ATS (API and UI).
- **Inbox times:** interview times are stored as UTC instants with the zone the email used, and shown in the owner's time zone; a time with no zone is never guessed.
- **API rate limits:** kept in sqlite, so a restart does not reset them.
- **Batch API (50% off):** for match scoring, off by default (Settings → "Score jobs in batches"). Batches persist across restarts and fall back to normal calls on error or expiry. Research and evidence prep are not batched yet.
- **Letter not needed:** off by default (Settings → "Skip cover letters the form doesn't ask for"). A letter is skipped only on positive knowledge: Greenhouse's question list (fetched once per job) or the form recipe for that exact posting. Email applications always get one.
- **Unicode PDFs:** CV and letter PDFs embed Noto Sans (Latin-ext, Greek, Cyrillic, Vietnamese, Arabic script) when text needs it; English CVs are unchanged. A wrapped right-to-left paragraph keeps its words but not full bidirectional order; CJK, Devanagari and Hebrew are not covered.

Still open:

- GitHub profile sync hits GitHub's anonymous rate limit. Add a token in Profile → Links and GitHub.
- A11 §8 (passphrase bootstrap for a server install) is deferred.
- Volume-mode cost is measured on one job so far ($0.22 with a new role CV); the cost with a cached role CV still needs a larger sample.
- An unknown question saved before the notice-period split and answered later through Telegram may update the start-date answer (rare, once).

**Deviations from the spec, chosen by the owner**

- Critic bar 5/10 in quality mode (spec: 8).
- Volume mode has no critic and no paid auditor (spec: both on every letter).
- Two letter drafts in quality mode, one in volume mode (spec: three variants).

**Smaller limits** (details in the agent reports)

- Matcher and lint thresholds are not tuned on labelled data (A02, A03, A04).
- Hiring contacts come only from the posting text (A09).
