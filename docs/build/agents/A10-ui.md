# A10: UI (every new capability visible and controllable, on desktop and phone)

**You own:** `web/**`, and the UI-facing routes under `server/routes/**`. Coordinate route shapes through `contracts/`.
**Mission:** the owner sets up once, runs campaigns and sees everything, from a laptop or a phone, in the existing **Cream & Crimson** design system (read `design/DESIGN.md` and keep its principles: one bold element, data in sans, status by tone, no ornament, plain words).

## Build (extend or replace the existing pages as needed)
1. **Onboarding wizard (first run, reopenable from Profile):** CV upload → links (GitHub, portfolio, LinkedIn URL, socials) → GitHub sync preview → **voice bank** (the 8 prompts with a word counter, and why it matters, in one line) → **answer bank** (the seeded questions, grouped) → learning list → Claude API key → mailbox (IMAP/SMTP) → Telegram bot → the first campaign. Progress is saved after each step.
2. **Campaigns:** list and create/edit with every `CampaignConfig` field (sensible defaults, stretch level explained in one line each). Start, pause and resume, and a **kill switch** that's always visible while anything runs. A live status line (the crimson sash shows only while live). Today's counters, the next action time and the budget meter.
3. **Pipeline:** the existing board, extended with the new states. Each job opens a **timeline**: found (sources) → match (requirements table with met / partial / missing and proof, stretch info, score breakdown) → writer (chosen variant, the other variants, critic scores, lint results, truth lock) → form (step screenshots, field log with value sources, verify result) → outcome (emails, stage).
4. **Writer studio:** browse applications by quality, read the letters and CVs (PDF preview), see the bandit's strategy stats, and edit the voice bank.
5. **Forms and recipes:** recipe library (ATS, scope, status, successes and failures, version history), coverage by ATS, agent runs vs recipe runs over time, and a trace viewer (step list with before/after screenshots). Promote and demote manually.
6. **Agents and API:** create and revoke API keys (shown once), scopes, last used, the audit log, MCP connection snippets (Claude Desktop / Claude Code / generic), and a link to `docs/AGENT_API.md`.
7. **Inbox:** classified messages linked to applications, filterable by class.
8. **Learning:** active learning plans (from interviews), the weekly gap report, and the learning list with one-tap status changes.
9. **Sources and companies:** per-source health, the company registry (search, ATS, open roles, signals, add a careers URL and auto-detect), the JobSpy sidecar status with setup instructions.
10. **Questions:** open unknown questions with an answer box. Answering saves to the bank and re-queues the job.
11. **Digests:** history and today's preview.
12. **Settings:** keep the existing ones, plus Telegram, mailbox, the sidecar, models per new task, and the keep-awake toggle.
13. **Phone:** responsive layouts for Campaigns, Pipeline, Questions, Inbox and Digest at 380px and up. A PWA manifest and icons so it installs on a phone home screen (served over the LAN or a tunnel later; no auth changes needed beyond the existing passphrase rule).

Use `@tanstack/react-query` and the existing `api.ts` patterns. Live updates come over the existing SSE `/api/events`.

## Tests
- `npm run typecheck` clean.
- Add Playwright UI smoke tests in `scripts/ui-smoke.ts` (A11 wires them into e2e): onboarding completes with fixtures, a campaign can be created and started in dry-run, the kill switch works, and the questions answer flow works.
- Screenshot every page at 1440px and 390px into `design/shots/v2/` for the lead to review.

## Acceptance
- [ ] Every spec capability has a place in the UI
- [ ] The phone layouts work, and the PWA installs
- [ ] The design system is respected (lead reviews the screenshots)
