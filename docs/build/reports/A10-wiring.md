# A10 wiring report: Forms, Inbox and Learning on the real A05 and A09 routes

Branch `v2-a10-wiring` (cut from `v2` at cb98cfb). A10 first built these screens against the routes it proposed in `docs/build/requests/A10.md` §1 and §3. They now read the routes A05 (`server/forms/routes.ts`) and A09 (`server/inbox/routes.ts`, `server/learning/routes.ts`) actually shipped. Where A10's proposal and the real route differed, the UI was changed to match the server. The A06 parts (agent metrics and traces, §2) are unchanged and still fall back to "not in this build" on 404.

## What each screen reads now

| Screen | Reads | Writes |
| --- | --- | --- |
| Forms: Recipes | `GET /api/forms/recipes` (every version) | |
| Forms: recipe drawer | `GET /api/forms/recipes/:id` (steps, hooks, last runs). Version history comes from the recipe list (same ATS, scope and key). | Promote and Demote call `PUT /api/forms/recipes/:id/status` with `active` or `demoted` |
| Forms: Coverage by ATS | `GET /api/forms/summary` (adapters, synonym count, recipes by status, runs in the last 30 days by ATS), combined with the recipe list to get recipe and active counts per ATS | |
| Forms: Form runs (new tab) | `GET /api/forms/runs?limit=100[&jobId=]`. The run drawer reads `GET /api/forms/runs/:id`: the outcome, field log, unknown questions, problems, notes and step screenshots. | |
| Forms: Accounts (new tab) | `GET /api/forms/accounts` (site, username, date made; never a password), `GET /api/forms/settings` | `PUT /api/forms/settings { accountEmail }` |
| Forms: Recipes and agent over time, Traces | A06 `GET /api/agent/metrics`, `/api/agent/traces[/:id]`. Not merged yet, so these still fall back on 404. | |
| Job timeline: Form section | `GET /api/forms/runs?jobId=`, then `GET /api/forms/runs/:id` for the latest run (the same view as the run drawer, plus a link to every run for the job). Falls back to the journal and application row when there are no runs. | |
| Inbox: Messages | `GET /api/inbox/messages` (`?class=`, `?review=1`, `?unlinked=1`), `GET /api/inbox/status` (counts by class, review and unlinked counts, last check or error, whether polling is on) | Check now: `POST /api/inbox/poll`. Done / Mark as new: `POST /api/inbox/messages/:id/done` (new) |
| Inbox: message drawer (`?message=`) | `GET /api/inbox/messages/:id`: facts, summary, links (hidden for held mail), questions and unanswered ones, drafted reply, the reason it was filed, link reasons, crash plan link | Correction: `PUT /api/inbox/messages/:id { class, applicationId }`, with the application picker from `GET /api/applications`. Draft: `POST /api/inbox/drafts/:id/done` or `/dismiss`. |
| Inbox: Follow-ups (new tab) | `GET /api/inbox/followups`: due, waiting, won't be sent (with the reason), log, today's count against the cap | `POST /api/inbox/followups/run`, which needs a second confirming click because it sends mail |
| Learning | `GET /api/learning/plans` (`items`), `GET /api/learning/gaps/latest`, `GET /api/learning/settings`. The plan drawer falls back to `GET /api/learning/plans/:id` when the plan isn't in the list. | Rebuild: `POST /api/learning/gaps`. Add a gap skill: `POST /api/learning/list/queue`. Settings: `PUT /api/learning/settings` (`autoQueueTopGaps`, `defaultPlanDays`). Delete a plan: `DELETE /api/learning/plans/:id`. |
| Settings and onboarding: mailbox card | `GET /api/inbox/settings` (`settings`, `password.set`) and `/api/inbox/status` | `PUT /api/inbox/settings`: host, port, TLS, user, folder, password (to the vault), polling on or off, follow-ups on or off with the per-day cap, draft replies. `POST /api/inbox/test` with the unsaved form (and password, if typed). `DELETE /api/inbox/settings` to forget the password. The onboarding step uses the same card, without the follow-up and draft toggles. |
| Deep links | A09's alerts link to `/inbox/<id>` and `/learning/plans/<id>`. `main.tsx` turns those paths into `#/inbox?message=<id>` and `#/learning?plan=<id>`. | |

`web/src/api.ts` now carries the real shapes: `RecipeRow`, `RecipeDetail`, `FormsSummary`, `FormRun`, `FormRunDetail`, `SiteAccount`, `FormsSettings`, `InboxMessage` (the full stored view), `InboxSettings`, `InboxStatus`, `FollowUps`, `StoredPlan`, `GapReportRow` and `LearningSettings`. The proposed-only types `AtsCoverage` and `ImapSettings` are gone. The run view is shared between the Forms drawer and the job timeline in `web/src/pages/FormRunView.tsx`.

## Server changes (all small, behind the existing UI session and CSRF guard)

1. **`server/forms/routes.ts`.** `GET /api/forms/runs/:id` also returns `shots`: the step screenshots as URLs (`/api/forms/runs/:id/shots/<name>`). The list is built from the base names in `run.json`, keeping only names that match `^[\w-][\w.-]{0,100}\.jpg$`. The shot route now uses the same stricter pattern (before, it allowed names starting with a dot). Paths never leave the server.
2. **`server/inbox/messages.ts`.** `StoredMessage` has a new optional `done` flag (default `false`), stored in `data`. It means "the owner dealt with it" and is display-only. A09's `handled` column means "effects have run", and a poll re-runs every message where it is 0, so the UI must never write it. A10 had assumed the opposite.
3. **`server/inbox/routes.ts`.**
   - New `POST /api/inbox/messages/:id/done { done: boolean }`. The id is validated (`^[A-Za-z0-9-]{1,100}$`) and the body with zod. It answers 404 for an unknown message and never re-runs effects.
   - The list and detail routes add `jobId`, the job of the linked application, so a row can open the job timeline. This takes one extra query per page.
4. **`server/routes/ui.ts` (A10's own).** The shell's inbox badge now counts replies that want the owner and aren't marked done: interviews, assessments, offers and recruiter questions, plus anything flagged for review. Before, it counted `handled = 0`, which under A09 means "processing hasn't finished" and is almost always 0.

No route returns a password, a vault secret name or a verification code. `site_accounts.secret_name` is not exposed, and inbox `code` is always null.

## Other UI changes

- **First-run redirect.** It now only applies to a plain start (no hash, `#/` or `#/overview`), so a deep link from an alert is never sent to the setup wizard.
- **Plain-language reasons.** `unknown_question: …` reasons read "A required question nobody could answer truthfully: …".
- **Row titles in the Inbox.** Row titles are links that open the drawer, because the row also holds a button. `.list-row a.title` is styled without an underline until hover.

## Tests

- `npm run typecheck`: clean. `npm run build`: succeeds.
- `npm run ui-smoke`: **39 passed, 0 failed** (all steps). The new `scripts/ui-smoke/a10-5-forms-inbox.ts` adds 16 steps. It plants fictional rows with `scripts/a10/forms-inbox-seed.ts` into `t.dataDir`: recipes with history, recipe runs, two fill runs (one with `run.json` and a real JPEG step shot), a site account, four inbox messages, a crash plan and a gap report. It then checks:
  - recipes, promote via `PUT /status`, coverage, the run drawer with a shot URL that actually loads, and the account email and site accounts (no secret in the response);
  - that bad shot names are refused;
  - the inbox list, drawer and draft, and that Done and Mark as new move the shell badge without touching `handled`;
  - both alert deep links, the Learning plan and gap report, and Add going through `/list/queue`;
  - the job timeline Form section and the Settings mailbox card;
  - that no screen shows "isn't in this build yet".
- `npm run selfcheck`: **all 550 checks passed**. The `a10-ui` check gained 3 wiring checks (13 in total):
  - the done flag and badge semantics, and validation;
  - `jobId` on the inbox list, with no code;
  - shot URLs only for safe names, served and refused correctly.
- `scripts/a10/seed-demo.ts` also plants the forms, inbox and learning rows, so `scripts/a10/shots.ts` shows these screens filled in. These design shots were refreshed: `forms-*`, `inbox-*`, `learning-*`, `settings-desktop`, `timeline-desktop`, plus the new `forms-run-desktop`, `forms-coverage-desktop` and `inbox-message-desktop`. All data is fictional (`example.net`).

## Left open

- **A06.** The agent metrics and traces tabs still wait for `GET /api/agent/metrics`, `/api/agent/traces` and `/api/agent/traces/:id` (requests/A10.md §2).
- **Owner "done" flag.** It is a UI concept added to A09's message store. A09 should know about it (it is optional and ignored by the pipeline). If the lead would rather A09 own it, the route can move unchanged.
- **Seed-demo side effect.** The demo seeder's interview message is stored with `handled = 0`, so a running demo server re-runs its effects on the first poll (it builds a fallback crash plan). That is harmless for demos but differs from what A09 stores.
- **Coverage "Success".** It uses A05's 30-day rate, which counts sent and rehearsed runs alike. A rate for live submits only would need A05 to split the counts.
