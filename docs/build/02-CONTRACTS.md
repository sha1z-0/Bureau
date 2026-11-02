# Phase 0: contracts (the lead does this before launching agents)

Goal: after this phase, every agent can build in parallel against stable interfaces. Keep each contract small and explicit. Every boundary gets a zod schema.

## 1. Folder layout (create it, with stub `index.ts` files)
```
server/
  contracts/        # zod schemas + TS types shared by everyone (lead-owned)
    profile.ts  job.ts  match.ts  writer.ts  forms.ts  agent.ts  campaign.ts  inbox.ts  learning.ts  api.ts  events.ts
  sources/          # A01: connectors (existing + new)
  scout/            # A01: registry, discovery, dedupe, resolve, signals, sidecar client
  match/            # A02: filters, embeddings, assessment, scoring
  profile/          # A03: sync (github, portfolio, cv), voice bank, answer bank, learning list
  research/         # A03: company research briefs
  writer/           # A04: evidence map, cv, letters, critic, humanizer, lint, truth lock, bandit
  forms/            # A05: detect, extract, map, handlers/, adapters/, recipes, verify, accounts
  agent/            # A06: browser agent loop, traces, recipe compiler, shadow verify
  api/              # A07: /api/v1 external API, keys, audit; mcp/ server
  campaign/         # A08: campaign engine, pipeline state machine, pacing, scheduler, digest, notify
  inbox/            # A09: imap, classify, link, followups
  learning/         # A09: learning plans, skill-gap reports
sidecars/jobspy/    # A01: Python JobSpy wrapper (CLI → JSON)
web/src/pages/      # A10
fixtures/           # A11: ats forms, feeds, recorded claude responses, emails
scripts/e2e.ts      # A11
docs/build/requests/  docs/build/reports/
```
The existing `services/` files may stay as thin re-exports during the transition. A08 replaces `services/hunt.ts`, A05 replaces `services/formFiller.ts`, and A04 replaces `ai/tailor.ts`.

## 2. Database migrations (`server/db.ts`, additive and idempotent)
Add tables, keeping all existing ones:
- `campaigns(id, name, status[draft|active|paused|ended], starts_at, ends_at, config JSON, created_at, updated_at)`
- `pipeline(job_id PK, campaign_id, state, attempts, next_action_at, last_error, updated_at)`. States: `found → filtered → scored → selected → writing → written → filling → verified → submitted | rehearsed | skipped | needs_you | failed`, with transitions enforced in code.
- `companies(id, name, domain, ats, ats_token, careers_url, discovered_via, status, last_checked_at, open_roles, prev_open_roles, signals JSON)`
- `job_embeddings(job_id PK, model, vector BLOB)`
- `profile_facts(id, kind, text, source[cv|github|portfolio|manual|linkedin], source_ref, added_at, active)`
- `voice_bank(id, prompt, text, tags JSON, created_at)`
- `answer_bank(id, question_norm, question_raw, answer, scope JSON, source[owner|derived], created_at, updated_at)`
- `unknown_questions(id, question_raw, question_norm, job_id, field_kind, options JSON, status[open|answered|ignored], created_at)`
- `learning_list(id, skill, status[learning|queued|done], started_at, notes)`
- `research_briefs(company_key PK, brief JSON, fetched_at)`
- `letter_variants(id, application_id, variant, style_tags JSON, critic JSON, lint JSON, chosen INTEGER)`
- `form_recipes(id, ats, scope[ats|company|url], scope_key, version, recipe JSON, status[candidate|shadow|active|demoted], successes, failures, created_at, updated_at)`
- `agent_traces(id, job_id, application_id, origin[internal|external:<keyId>], url, ats, trace JSON, outcome, created_at)`
- `site_accounts(id, domain, username, secret_name, created_at)`. The password goes in the existing vault.
- `api_keys(id, name, prefix, hash, scopes JSON, created_at, last_used_at, revoked_at)` and `api_audit(id, key_id, ts, route, status, detail)`
- `inbox_messages(id, message_id UNIQUE, from_addr, subject, received_at, class, application_id, data JSON, handled)`
- `learning_plans(id, application_id, company, plan JSON, created_at)` and `gap_reports(id, period, report JSON, created_at)`
- `digests(id, campaign_id, date, content JSON, sent_via JSON)`
- `outcomes(application_id PK, replied INTEGER, reply_class, days_to_reply, updated_at)`
Add columns `applications.campaign_id`, `applications.variant_id` and `jobs.apply_url_canonical`, `jobs.ats`, `jobs.company_id`, `jobs.legitimacy`.

## 3. Shared contracts (`server/contracts/*.ts`, zod plus exported types)
- `job.ts`: `RawJob` (keep the existing shape and add `ats`, `applyUrl`, `companyDomain`), `JobRecord`.
- `match.ts`: `Requirement {text, importance: critical|important|nice, evidence: stated|inferred, match: met|partial|missing, proof, blocker:boolean}`, `MatchResult {jobId, screenPassScore 0–100, grade, requirements[], dimensions{}, legitimacy, verdict, strengths[], gaps[], atsKeywords[], stretch:{unmetImportant:number, blockers:string[]}}`.
- `profile.ts`: `MasterProfile` (the existing Profile plus `facts[]`, `voiceBank[]`, `answerBank[]`, `learning[]`, `links`, `github`).
- `writer.ts`: `EvidenceMap`, `ApplicationPacket {applicationId, jobId, cvPdfPath, letterPdfPath, subject, coverLetter, shortAnswers: Record<string,string>, outreach, quality:{critic, lint, truth}}`.
- `forms.ts`: `FormField {id, kind, label, labelNorm, required, options?, section?, step, signature}`, `FieldValue {fieldId, source: profile|answer_bank|writer|file|generated, key, value, confidence}`, `Recipe {ats, scope, match:{urlPattern?, domFingerprint?}, steps: RecipeStep[]}`, `RecipeStep {action: fill|select|check|upload|click|next|wait|submit, fieldSignature?, selectors: string[], widget, valueSource?, valueKey?}`, `FillOutcome {status: submitted|rehearsed|needs_you|skipped|failed, reason, shotPath, answers[], verified: boolean, unknownQuestions[]}`.
- `agent.ts`: `TraceStep`, `Trace`, `AgentRunResult`.
- `campaign.ts`: `CampaignConfig` (dates, roles, categories, locations, remoteOnly, stretchLevel, minScore, dailyCap, companyCooldownDays, activeHours{tz,start,end}, pacingMinutes{min,max}, budgetUsd, dryRunDays, channels{email,forms,agent}, sources{} overrides).
- `inbox.ts`: `InboxClass`, `ClassifiedMessage`.
- `learning.ts`: `LearningPlan`, `GapReport`.
- `api.ts`: request and response schemas for every `/api/v1` route (A07 implements them).
- `events.ts`: typed bus events. Extend the existing `bus.ts`: `pipeline.state`, `campaign.status`, `application.outcome`, `inbox.message`, `alert.interview`, `recipe.promoted`, `digest.sent`, `activity`.

## 4. Module interfaces (stubs that throw `NotImplemented` or return fixtures)
```ts
// scout
runScout(opts:{campaignId?:string, sources?:string[]}): Promise<{found:number, added:string[]}>
// match
matchJobs(jobIds:string[], cfg:CampaignConfig, opts?:{campaignId?:string}): Promise<MatchResult[]>   // pass campaignId so pipeline rows carry it
// profile & research
syncProfile(): Promise<{added:number}>;  loadMasterProfile(): MasterProfile
researchCompany(company:string, domain?:string): Promise<ResearchBrief>
// writer
writeApplication(jobId:string, campaignId:string): Promise<ApplicationPacket | {skipped:string}>
// forms
fillApplication(packet:ApplicationPacket, opts:{submit:boolean, headful?:boolean}): Promise<FillOutcome>
// agent
agentFill(ctx:{page, fields, packet}): Promise<AgentRunResult>;  compileTrace(traceId:string): Promise<Recipe|null>
// inbox
pollInbox(): Promise<number>;  waitForCode(domain:string, timeoutMs:number): Promise<string|null>
// campaign
startCampaign(id), pauseCampaign(id), killAll(), tick()
// notify
notify(kind:'alert'|'digest'|'info', payload): Promise<void>
```

## 5. Claude task names (add to `TASKS` in `ai/claude.ts`, with default models and cost estimates)
`profile_sync`, `research`, `match` (Haiku), `evidence`, `write_cv`, `write_letter`, `critic`, `humanize`, `audit` (keep), `form_map`, `agent_step`, `recipe_compile`, `inbox_classify` (Haiku), `learning_plan`, `gap_report`, `answer_q`. The writing tasks default to Opus 5.5; classification and scoring default to Haiku 5.5. Keep the cost meter and budget cap authoritative.

## 6. Fixtures skeleton
`fixtures/README.md` describes the layout. A11 fills it: `fixtures/ats/<ats>/*.html` (local copies of forms), `fixtures/feeds/<source>.json`, `fixtures/claude/<task>/*.json` (recorded responses keyed by input hash), `fixtures/mail/*.eml`. Add a `BUREAU_REPLAY=1` mode to `ai/claude.ts` that serves recorded responses, so tests make no API calls.

Commit when typecheck and selfcheck pass. Then launch the agents (see `00-MASTER.md`).
