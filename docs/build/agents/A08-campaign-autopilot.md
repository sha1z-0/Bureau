# A08: Campaign autopilot, pipeline, digest and notifications

**You own:** `server/campaign/**`, `server/notify/**`. You replace `server/services/hunt.ts`; the `/api/hunt` routes become `/api/campaigns` (keep `/api/hunt` as a compatibility shim that maps to the active campaign).
**Mission:** the owner switches a campaign on, and Bureau runs unattended until the end date: scouting, matching, writing and applying at a human pace within every limit, surviving restarts, never double-applying, and reporting every day.

## Build
1. **Campaigns (`campaign/campaigns.ts`):** CRUD on `campaigns` with a `CampaignConfig` (see the contracts). Multiple campaigns may exist and one or more can be active, with a global daily cap shared across them. Status changes emit `campaign.status`. At `ends_at` it auto-ends with a final digest. **Dry-run days:** the first N days run in rehearse mode (fill and verify, never submit), then switch to live automatically, and the digest says so.
2. **Pipeline state machine (`campaign/pipeline.ts`):** one row per job in `pipeline`, with legal transitions only (enforced, tested), idempotent steps, `attempts` with exponential backoff, and `next_action_at`. Respect A07 claims. Uniqueness: one live application per job and per company within the cooldown window. A crash at any step resumes safely on restart: steps check their outputs before re-running, so nothing is submitted twice.
3. **Scheduler (`campaign/scheduler.ts`):**
   - Scout every 2–3 hours (configurable).
   - Match after each scout.
   - Profile sync daily at 06:00 local time.
   - Inbox poll every 5 minutes (A09).
   - Recipe shadow and compile jobs as needed.
   - Weekly gap report and company discovery.
   - **Apply worker:** pulls `selected` jobs in priority order and runs write → fill → verify → submit **one at a time** (a single browser, sequential), paced inside the campaign's active hours with a random gap between pacingMinutes.min and max. Prefer the *employer's* business hours when the posting's timezone is known.
   - Respect the daily cap, budget cap (the existing AI budget), and campaign budget.
4. **Kill switch:** `killAll()` stops all workers within 5 seconds and closes browsers. Triggers: UI button, Telegram `/stop`, the file `data/STOP`, or the budget being exhausted. `/pause` and `/resume` work per campaign.
5. **Notifications (`notify/`):**
   - **Telegram bot:** the owner pastes a bot token and chat id in Settings (stored in the vault). It sends instant **alerts** (interview, assessment, campaign error, kill), the daily **digest**, and **questions** (unknown form questions, each answerable with a reply that goes to the A03 answer bank). Commands: `/status`, `/stop`, `/pause <campaign>`, `/resume <campaign>`, `/today`, `/answer <id> <text>`. Only the configured chat id is accepted.
   - **Email digest** over the existing SMTP. Optional ntfy.sh topic as an alternative push channel.
6. **Daily digest (`campaign/digest.ts`), stored in `digests`:**
   - Applications sent (company, role, score, channel, link to the UI screenshot), rehearsed, skipped (grouped by reason), and needs-you items.
   - New unknown questions.
   - Interviews and replies (from A09), spend today and for the campaign, and the top 5 skill gaps this week.
   - Recipes promoted and source health warnings.
   - Short and scannable on a phone.
7. **Keep the PC awake while a campaign runs (Windows):** keep the system awake during active hours (for example through a small PowerShell helper calling `SetThreadExecutionState`), and release it outside active hours. Do nothing on Linux. Keep Start with Windows (`services/autostart.ts`).
8. **Observability:** the activity stream (the existing bus over SSE), per-campaign stats, and a step timeline per job for the UI.

## Tests
- State machine: illegal transitions throw, and resume after a simulated crash at each step never double-submits.
- Pacing respects active hours and the cap, using fake timers.
- The kill switch stops a running fill.
- Digest rendering from a fixture day.
- Telegram command parsing and the chat-id lock (with a mocked API).

## Acceptance
- [ ] Start a campaign, kill the process mid-fill, restart: it resumes with no duplicates
- [ ] Dry-run days switch to live automatically on schedule
- [ ] Telegram alerts, digest, questions and commands all work (verified with a test bot)
- [ ] The campaign auto-ends at `ends_at` with a final digest
