# A11: Fixtures, replay mode, end-to-end tests, security and Linux readiness

**You own:** `fixtures/**`, `scripts/e2e.ts`, `scripts/selfcheck.ts` (structure; other agents add checks), `scripts/ui-smoke.ts` wiring, `docs/SECURITY.md` updates, CI config.
**Mission:** make every part testable offline and prove the whole system works end to end before anything touches a real site.

## Build
1. **Replay mode for Claude:** finish what the lead stubbed. `BUREAU_REPLAY=1` makes `ai/claude.ts` serve recorded responses from `fixtures/claude/<task>/<inputHash>.json`. `BUREAU_RECORD=1` records live responses (for the lead in Phase 3). If a response is missing in replay mode, the test fails with the hash and task, so it's easy to record.
2. **ATS fixture forms (`fixtures/ats/`):** faithful local HTML replicas (structure, widget types, quirks, multi-step flows, confirmation pages) for Greenhouse (classic and the new job-boards, including the iframe embed), Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio, Teamtailor, BambooHR, Breezy and **Workday** (account creation, email verification step, 6-step wizard, resume-parse page). Plus widget torture pages: react-select, a MUI date picker, a phone country picker, shadow DOM, a cross-origin iframe, repeating sections, a visible CAPTCHA mock and a prompt-injection text. Serve them from a local fixture server (`scripts/fixture-server.ts`) on random ports. Each records submissions so tests can assert exactly what was sent.
3. **Feed fixtures (`fixtures/feeds/`):** a recorded payload per connector (A01 adds more), including duplicate jobs across sources.
4. **Mail fixtures (`fixtures/mail/`):** 25+ `.eml` files covering every inbox class, including verification codes from Workday and Greenhouse-style senders, and tricky cases (a rejection worded kindly, an interview invite with a Calendly link, a recruiter question).
5. **E2E (`npm run e2e`):** a temp data dir, replay mode, the fixture server, and a seeded profile, voice bank and answer bank. Then: create a campaign → scout (fixture feeds) → match → write → fill each fixture form → verify → rehearse submit (and live submit against the fixture server) → inbox (drop an interview `.eml`) → alert and learning plan → digest. Assert counts, states, no double submits, and the expected submissions recorded by the fixture server. Include a crash/resume scenario and a kill-switch scenario. An external-agent scenario through `/api/v1` and MCP uses a scripted fake agent.
6. **Security review of new surfaces:** API key auth and scopes, signed file URLs (expiry, no path traversal), MCP over HTTP auth, Telegram chat-id lock, IMAP credential handling, vault coverage for the new secrets (Telegram token, IMAP password, site passwords, GitHub token), SSRF guard on all new fetchers (scout resolution, portfolio crawl, research), and prompt-injection fencing for emails, pages and external traces. Add tests for each and update `docs/SECURITY.md`.
7. **Linux readiness:** a `Dockerfile` and `docker-compose.yml` (Node plus Chromium plus the Python sidecar) that run the full app headless on Linux. `npm run e2e` must pass inside the container. Document the VPS deploy in `docs/DEPLOY.md` (behind HTTPS with a passphrase, using `BUREAU_HOST`, `BUREAU_ALLOWED_ORIGINS` and `BUREAU_COOKIE_SECURE`).
8. **CI:** a GitHub Actions workflow running typecheck, selfcheck and e2e (in the container) on push.

## Acceptance
- [ ] `npm run e2e` passes locally on Windows and in Docker on Linux
- [ ] Every agent's tests run in `selfcheck` with no network and no API key
- [ ] The security checklist is complete, with tests
- [ ] The VPS deploy is documented and works with `docker compose up`
