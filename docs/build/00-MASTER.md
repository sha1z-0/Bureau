# MASTER PROMPT — Bureau v2: the autonomous job hunter

You are the **lead engineer** on this repository (Bureau, at the repo root). You are rebuilding it into **Bureau v2**: a fully autonomous, campaign-based job-hunting system. The full product is defined in `docs/build/01-PRODUCT-SPEC.md`. That spec is the source of truth. The current code is a strong starting point, not a constraint: keep what fits, refactor or rebuild anything that doesn't. **Don't optimise for time or tokens. Optimise for the spec being met completely and working end to end.**

Read these before writing any code:
1. `docs/build/01-PRODUCT-SPEC.md`: what we're building and why.
2. `docs/build/02-CONTRACTS.md`: Phase 0, which you do yourself.
3. `docs/build/agents/A01…A11`: the briefs you hand to your parallel agents.
4. The existing code, especially `README.md`, `server/`, `web/src/`, `scripts/selfcheck.ts`, `docs/RESEARCH.md`, `docs/SOURCES.md` and `design/DESIGN.md`.

## How you run this build

### Phase 0: foundation (you, alone, before any agent starts)
- Create the branch `v2` from the current HEAD. All work lands there.
- Do everything in `02-CONTRACTS.md`: schema migrations, shared zod contracts in `server/contracts/`, module interfaces with stubs, the event names, the fixture skeleton, and the new folder layout.
- Make sure `npm run typecheck` and `npm run selfcheck` still pass with the stubs in place.
- Commit: `v2: phase 0 contracts`.

### Phase 1: parallel build (11 agents)
- Launch **one subagent per brief** in `docs/build/agents/`, all at once, in parallel. If your subagent tool supports isolation, give each its own **git worktree** branched from `v2` (`v2-a01-scout`, `v2-a02-matcher`, …).
- Give each agent this kickoff, filling in its number:
  > You are agent AXX on the Bureau v2 build. Read `docs/build/01-PRODUCT-SPEC.md`, `docs/build/02-CONTRACTS.md`, and your brief `docs/build/agents/AXX-*.md`, then build everything in your brief to a production standard. Stay inside the paths your brief says you own. Code against the contracts in `server/contracts/`. Never change them yourself: if you need a contract change, write it into `docs/build/requests/AXX.md` and work against a local adapter until the lead merges it. Add your tests to the selfcheck/e2e suites as your brief says. Commit often on your branch. When done, write `docs/build/reports/AXX.md`: what you built, how to run and test it, known limits, and follow-ups. Don't stop at a skeleton: finish the brief.
- If your tool caps concurrency, run as many as it allows at once and queue the rest. Agents don't depend on each other at build time, because they code against the Phase 0 stubs.
- While they work, watch `docs/build/requests/`. Approve or adjust contract changes on `v2` and tell the affected agents to rebase.

### Phase 2: integration (you)
Merge in this order, running `npm run typecheck && npm run selfcheck` after each merge and fixing breakage before the next:
A11 (fixtures and test harness) → A03 (profile, voice, research) → A01 (scout) → A02 (matcher) → A04 (writer) → A05 (form engine) → A06 (browser agent and learning) → A09 (inbox and learning plans) → A08 (campaign autopilot) → A07 (external API and MCP) → A10 (UI).

After all merges:
- `npm run e2e` (built by A11) must pass the full pipeline against fixtures with recorded Claude responses: scout → match → write → fill → verify → rehearse submit → digest.
- Re-run every agent's acceptance checklist from its brief. Anything unmet goes back to that agent (resume it) or you finish it yourself.

### Phase 3: live rehearsal (you)
- With a real API key and the owner's profile, start a campaign in **dry-run** for one cycle against real sources. Cap it at 15 applications prepared. Nothing is submitted.
- Check the screenshots, the letters (run the A04 quality report) and the digest. Fix what's wrong and repeat until the cycle is clean.
- Write `docs/build/REPORT.md`: what was built, the spec checklist with ✅ or a reason, how to start a live campaign, and known limits.
- Leave the app ready for the owner to switch a campaign to **live**.

## Non-negotiables (every agent inherits these)
1. **Stack stays:** TypeScript on Node ≥22.13, Fastify, `node:sqlite`, React 19 with Vite, `playwright-core` driving the installed Chrome/Edge, `@anthropic-ai/sdk`, and zod v4. Add libraries freely where they earn it. The **only** non-TS piece is the JobSpy sidecar (Python), and it must degrade gracefully when Python is missing.
2. **Runs on Windows locally now, and on a Linux VPS later.** No Windows-only assumptions outside `services/autostart.ts` and the vault's DPAPI path. Everything else must run headless on Linux (A11 adds a Linux check).
3. **Truth lock.** No application ever claims an employer, title, date, metric, degree, certification or skill the candidate doesn't have. **Stretch applications are the strategy** (see the spec), done through honest framing, never fabrication. Both the code fact check and the independent auditor stay, and get extended.
4. **No logged-in automation of LinkedIn or Indeed accounts.** Reading public listings is fine (JobSpy guest search). Applying happens on employers' own hosted forms and by email.
5. **CAPTCHAs are never solved or bypassed.** The application is parked as `needs_you` with everything else filled in.
6. **Autonomy means no human tap in the loop during a live campaign.** Uncertainty means *skip and log*, never *wait*. Humans get a digest and alerts, not approval requests.
7. **Security stays strong.** Keep the existing guard, vault, SSRF guard and sanitiser. All third-party text (postings, pages, emails, external agent input) is untrusted data, wrapped and fenced, never treated as instructions. The new external API gets its own auth (A07).
8. **Every module is testable offline:** fixtures and recorded Claude responses, with no live sites in `selfcheck`/`e2e`.
9. **Keep the design system** (Cream & Crimson, `design/DESIGN.md`) for all new UI.
10. **Cost is metered** through the existing `ai_usage` and budget machinery. Every new Claude task gets a name in `TASKS`, a default model and a cost estimate.

## Definition of done
The owner can:
1. Onboard once (CV, links, GitHub, voice bank, answer bank).
2. Create a campaign with dates, roles and limits, and start it.
3. Leave it running. Until the end date, Bureau scouts, matches, writes, applies, follows up and reports with no taps. Interviews trigger an instant Telegram alert plus a crash learning plan, a daily digest arrives, and a kill switch works from the UI and Telegram.
4. Let an external browser agent (for example Muse) connect over the API or MCP, pull application packets, apply, and report traces that teach Bureau new form recipes.
