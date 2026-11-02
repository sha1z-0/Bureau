# Fixtures

Everything the offline suites (`npm run selfcheck`, `npm run e2e`) need, so no
test touches a live site, a real mailbox or the Anthropic API. Owned by A11;
other agents add files in their own subfolders. Every person and employer here
is fictional, and every domain is `example.com`/`.example` (the recorded real
feeds are the only third-party data).

| Path | What |
| --- | --- |
| `ats/manifest.json` | Global settings: the prompt-injection **canaries** the fixture server flags. |
| `ats/<ats>/manifest.json` | The forms in that folder (schema: `scripts/e2e/manifest.ts`): route, files, required keys, `expect` rules for exactly what a correct submission contains, quirks reproduced, expected outcome. |
| `ats/<ats>/*.html, *.js, *.css` | Local replicas of real ATS application flows: Greenhouse (classic board, job-boards app, cross-origin iframe embed), Lever, Ashby, Workable, SmartRecruiters (shadow DOM), Recruitee, Personio, Teamtailor, BambooHR, Breezy, Workday (account, email code, resume parse with planted errors, 6-step wizard). |
| `ats/_widgets/` | Torture pages: react-select, MUI date picker, phone pickers, shadow DOM (open, nested, closed, form-associated), cross-origin iframe, repeating sections, rich text, location typeahead, three CAPTCHA mocks, prompt injection, verify traps. |
| `ats/_shared/` | Fixture plumbing (posting to the fixture server) and a Google Places look-alike. Not part of any replica's visible structure. |
| `feeds/index.json` | URL → file map for the fetch-replay layer (`scripts/e2e/fetch-replay.ts`), plus the dedupe triple and the trap postings. |
| `feeds/recorded/` | One real payload per connector request (16 existing connectors + 8 ATS feed APIs), fetched once on 2026-11-02 and trimmed to a few postings. |
| `feeds/e2e/` | Fictional employers in each source's exact response shape; apply URLs point at the replicas through `{{ORIGIN_A}}`. Dates are shifted to "now" when served. Includes the Lumen Ledger job across Greenhouse, Remotive and Himalayas (dedupe), a clearance blocker, an inflated entry-level post, a scam and a stale posting. |
| `mail/*.eml`, `mail/index.json` | 32 raw RFC 822 messages (CRLF kept by `mail/.gitattributes`) covering every inbox class at least twice, with the expected class, company, codes, links and deadlines in the index (never in the headers). |
| `profile/` | The seeded candidate, Rania Haroon: `cv.md`, `profile.json` (v1 profile; `cvMarkdown: "@cv.md"`), `facts.json`, `voice-bank.json` (8 passages in her own voice), `answer-bank.json`, `learning.json`, `texts.json` (long answers), `expected.json` (flat values the forms expect), and her CV and letter PDFs. |
| `claude/<task>/<hash>.json` | Recorded Claude responses for replay mode: `{ task, hash, model, usage, output }` (structured) or `{ …, text, sources }` (research). `<hash>` is `replayHash(task, system, content)`. |

## Running the fixtures

- `npm run fixtures` starts the fixture server on two random loopback ports and prints every form URL. Submissions: `GET /__fixture/submissions`; generated mail (Workday codes): `GET /__fixture/mail`; `POST /__fixture/reset`.
- `npx tsx scripts/e2e/run-golden.ts [id…] [--headful] [--verbose]` runs the hand-written golden fills (`scripts/e2e/golden/<id>.ts`) and prints what the server recorded against each form's `expect` rules. selfcheck runs all of them.

## Adding a form

1. Put the page(s) under `ats/<ats>/` and add an entry to `ats/<ats>/manifest.json` (`route` mirrors the real URL with the host as the first path segment).
2. Post to `/__submit/{{FORM_ID}}` (steps: `/__submit/{{FORM_ID}}/<step>`). Server-side ATS behaviour (pre-uploads, accounts) goes in `scripts/e2e/fixture-routes/<ats>.ts`.
3. Write `scripts/e2e/golden/<id>.ts` and run it until it's ✓.

## Replay mode

- `BUREAU_REPLAY=1` serves `claude/**` instead of calling the API. A missing recording throws `REPLAY_MISSING` with the task and hash; a recording that doesn't match the output schema throws `REPLAY_INVALID`.
- `BUREAU_REPLAY_DUMP=<dir>` writes each missed request (system, content, output schema) to `<dir>/<task>/<hash>.request.json`. `npm run e2e` always sets it and lists what's missing.
- `BUREAU_RECORD=1` (with a real key, not replaying) records live responses into this layout.
- Recordings need deterministic prompts: no timestamps, random ids or temp paths in prompt text, or the hash changes every run.
- `scripts/e2e/replay-fixtures.ts` writes the canonical recordings selfcheck uses to prove replay works.
