# Open-Source Landscape Research: AI Job-Hunting Tools

_Researched 2026-10-27. Star counts are approximate snapshots taken from GitHub repo pages. "Last activity" is the newest commit in each repo's `commits.atom` feed on that date. Treat every number as a ballpark._

## 1. Repo-by-repo survey

### 1.1 AIHawk: feder-cr/Jobs_Applier_AI_Agent_AIHawk (formerly LinkedIn_AIHawk)
- **URL:** https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk. **This URL now redirects to https://github.com/feder-cr/invisible_dots.** The repo was renamed and repurposed into a general "undetectable" self-hosted web agent (~32k stars, MIT, TS/Go/Python, alpha, last commit 2026-10-15). Third-party trackers list the job-applier era as **AGPL-3.0** with ~30k stars (https://www.star-history.com/feder-cr/jobs_applier_ai_agent_aihawk, https://www.sourcepulse.org/projects/1831324).
- **What it did:** It was a Python bot (Selenium-based in the LinkedIn era) that mass-applied to LinkedIn "Easy Apply" jobs. It answered form questions with an LLM and generated tailored resumes and cover letters. Configuration came from `secrets.yaml` (LLM key) plus `plain_text_resume.yaml`. That YAML held personal info, education, experience, projects, availability, salary expectations, self-identification, legal authorization and `work_preferences` such as remote, relocation, assessments, drug tests and background checks (seen in a mirror fork: https://github.com/OnlineGBC/Jobs_Applier_AI_Agent). It supported OpenAI, Claude, Gemini and Ollama.
- **What happened:** The author reported ~1,000 applications in two days and 50 interviews. LinkedIn later restricted his account for "repeatedly sharing content that facilitates access to tools that automate activity" (https://www.semafor.com/article/09/12/2024/linkedins-have-nots-and-have-bots). ERE reports that all LinkedIn features were removed in January 2025 after legal threats and a platform ban (https://newsletter.ere.net/p/what-it-means-to-apply-for-a-job-is-changing-0c55). Users also reported the tool **adding false information to resumes** (Business Insider, as reported in search results; the original article at https://www.businessinsider.nl/a-free-ai-tool-can-help-you-apply-to-hundreds-of-jobs-per-day-users-said-there-are-risks-but-theyre-worth-it/ redirected and was not read directly).
- **Borrow:** The structured "plain-text resume" YAML schema, which is a good template for our profile fields (work authorization, salary, notice period, EEO answers). Also the idea of a reusable answer bank for screening questions.
- **Weaknesses/risks:** It was built on ToS-violating browser automation and produced the canonical ban story. Volume-first strategy, hallucinated CV content, and the repo now points somewhere else (supply-chain/continuity risk for anyone who depended on it).

### 1.2 JobSpy: speedyapply/JobSpy
- **URL:** https://github.com/speedyapply/JobSpy. ~4.6k stars, MIT, Python ≥3.10, last commit 2026-10-27. Ships a CLI and an MCP server.
- **What it does:** `scrape_jobs()` scrapes LinkedIn, Indeed, Glassdoor, ZipRecruiter, Bayt, Naukri, BDJobs and HelloWork into a pandas DataFrame. Google Jobs is listed but currently unavailable. Parameters include `search_term`, `location`, `distance`, `results_wanted`, `hours_old`, `is_remote`, `job_type`, `easy_apply`, `country_indeed`, `proxies` (round-robin), `fetch_description` and `enforce_annual_salary`.
- **Output schema worth copying:** `id, site, job_url, job_url_direct, title, company, location, date_posted, job_type, interval, min_amount, max_amount, currency, salary_source, is_remote, job_level, description, emails, company_url, company_num_employees...`. Note `job_url_direct`, which is the employer's own apply URL and the best dedupe key.
- **Rate limits (from README):** LinkedIn returns 429 on bursts. Glassdoor rate-limits above ~2 req/s. Most boards cap at ~1,000 results per search. `fetch_description` adds one request per job. The FAQ says "all boards are aggressive about blocking" and recommends waits and proxies.
- **Borrow:** The normalized JobPost schema, salary normalization (`interval` + `enforce_annual_salary`), and the `hours_old` recency filter.
- **Weaknesses/risks:** It is a scraper of sites whose ToS forbid scraping. It depends on proxies and breaks whenever the boards change. Indeed's `date_posted` is when Indeed ingested the job, not the original posting date. Python-only (we would have to run it as a sidecar or port the ideas).

### 1.3 career-ops: santifer/career-ops → career-ops-hq/career-ops (closest analogue to our app)
- **URL:** https://github.com/career-ops-hq/career-ops (old URL redirects). ~78k stars, MIT (name trademarked), Node.js `.mjs` scripts + Go TUI dashboard + Playwright, last commit 2026-10-27. Runs inside Claude Code, Codex or OpenCode.
- **Origin:** The author evaluated 740 listings, sent 68 applications, got 12 interviews and 1 offer. Manifesto: "Apply better to fewer. Signal over volume", "A human decides", local-first.
- **Pipeline:** scan → dedupe → liveness check → evaluate (report) → tailored PDF → tracker → follow-up drafts. Its statement on submission: "It drafts and fills; it never submits." No mail transport exists in the codebase.
- **Scanning** (https://raw.githubusercontent.com/career-ops-hq/career-ops/main/modes/scan.md): tiered discovery.
  - **L0:** zero-token local parsers per company.
  - **L1:** Playwright on `careers_url`, strictly one company at a time.
  - **L2:** ATS JSON APIs (Greenhouse, Ashby, Lever, BambooHR, Teamtailor, Workday, Breezy).
  - **L3:** `site:` WebSearch for discovering new companies.
  - **Filters:** `title_filter` with `positive` and `negative` keywords plus `seniority_boost`, `location_filter` (allow/block/block_hard) and `max_posting_age_days`.
- **Dedupe keys:**
  - URL with query and fragment stripped (`scan-history.tsv`).
  - Normalized company + role (tracker).
  - **SimHash of the JD** to flag near-identical cross-postings within 90 days (warn-only).
  - Observational statuses like `skipped_title` don't count as "seen", so changing filters can resurface jobs.
- **Liveness:** It treats 404/410, `?error=true` redirects and "no longer open" phrases as expired. Blank pages are "unconfirmed" and are rechecked next scan rather than recorded.
- **Scoring** (https://raw.githubusercontent.com/career-ops-hq/career-ops/main/modes/_shared.md, `modes/oferta.md`):
  - **Gates before scoring:** liveness → user blacklist → dealbreakers (only if a JD sentence *states* the breaking fact) → agency/intermediary check → research budget (max 5 web searches).
  - **Step 0, archetype:** classify the role against the user's target archetypes. A non-match is reported plainly and scores North Star = 1. The rule is "never force a hybrid label".
  - **Blocks:**
    - A: role summary plus culture screen and work-authorization check.
    - B: CV-match table.
    - C: level strategy.
    - D: comp, with reliability tiers and the advertised figure quoted verbatim.
    - E: top 5 CV and LinkedIn changes.
    - F: 6–10 STAR+Reflection interview stories.
    - G: posting legitimacy (High / Caution / Suspicious, kept separate from the score).
    - H: draft application answers, only when score ≥ 4.5.
  - **Block B is two-pass and anti-bias:**
    - **Pass 1** extracts requirements and importance from the JD alone (critical/high/meaningful/preferred/low_signal). Each requirement is tagged with an evidence tier (stated / structural / inferred). Importance cannot be revised after reading the CV, and *inferred* rows can never be critical or high.
    - **Pass 2** reads the CV and fills Strong/Partial/Missing with evidence. Max 12 rows.
  - **Global score 1–5** over five dimensions: CV match, North Star alignment, comp, culture, red flags. The README describes it as holistic, "no arithmetic formula or weights".
    - **Bands:** ≥4.5 apply now. 4.0–4.4 worth applying. 3.5–3.9 recommend against unless the user has a specific reason. <3.5 skip.
    - **Confidence:** each dimension's evidence is marked supported, partial or unknown. Confidence describes evidence quality and does not change the score.
  - **Machine Summary:** a YAML block with `final_decision` (Apply / Consider / Research first / Skip), `score`, `risk_summary` and `confidence_gaps`, so scripts can consume the LLM output.
- **CV generation** (`modes/pdf.md`):
  - **Layout:** single column, standard headers, no text in images, headers or footers. Newest-first ordering is enforced.
  - **Keywords:** JD keywords go in the summary, the first bullet of each role and Skills. Hidden text and stuffing are not allowed.
  - **Page format:** Letter or A4 chosen by employer country, with a 2-page warning.
  - **Fact-check gate:** blocks rendering if numbers or facts aren't found in source files. The rule is "reformulate, never fabricate."
- **Also notable:** `calibrate` checks whether scores predict real outcomes. `patterns` analyzes rejections and advance rates per ATS channel. Repost/ghost-job detection. Headless `claude -p` batch workers.
- **Weaknesses:** Markdown/TSV files as the database (fragile at scale, which is why they need merge scripts and atomic report numbering). It's CLI-centric with no real GUI, and it's heavyweight (3.5k commits, many modes). The holistic score is not reproducible across runs.

### 1.4 Resume-Matcher: srbhr/Resume-Matcher
- **URL:** https://github.com/srbhr/Resume-Matcher. ~29k stars, Apache-2.0, FastAPI/Python 3.13 + Next.js 16 / React 19 + SQLite + LiteLLM, last commit 2026-10-23.
- **Workflow:** upload master resume (PDF/DOCX) → paste JD → LLM tailors → cover letter and interview prep → PDF via headless Chromium. It has a batch "tailoring queue" and an MCP server.
- **Scoring:** a deterministic **ATS score out of 100 with no LLM**:
  - keyword match 40%
  - skills coverage 20%
  - job-title match 15%
  - section completeness 15%
  - date consistency 10%
  - It also offers an "ATS check" that runs the PDF through pdfminer to show what a parser extracts.
- **Borrow:** Pair a deterministic, explainable keyword score with the LLM judgment. Round-trip the generated PDF through a text extractor. Add a configurable cooldown between batch LLM calls (0–60 s).
- **Weaknesses:** Keyword overlap ≠ fit. It only tailors and has no discovery or tracking. The "use your Claude subscription via CLI" mode is flagged in its own README as possibly not permitted by Anthropic.

### 1.5 Reactive Resume: AmruthPillai/Reactive-Resume → reactive-resume/reactive-resume
- **URL:** https://github.com/reactive-resume/reactive-resume. ~45k stars, MIT, TypeScript (React 19, Hono, Drizzle/Postgres), last commit 2026-10-27.
- **Does:** A resume builder with 18 templates, live PDF preview, a public ATS checker and an application tracker. It imports Reactive Resume JSON, **JSON Resume**, LinkedIn data export, PDF and DOCX, and exports PDF, DOCX, Markdown and JSON. PDF rendering uses "Forme" in the browser or on the server, with no Chromium needed. AI (OpenAI, Anthropic, Gemini, Ollama) proposes edits that the user accepts or rejects.
- **Borrow:** Store the CV as structured JSON (the JSON Resume schema is a reasonable interchange format). Treat AI edits as reviewable diffs. Import from a LinkedIn data export (official, user-initiated) instead of scraping a profile.
- **Weaknesses:** Needs Postgres plus storage when self-hosted. It's a builder, not a job-hunt pipeline.

### 1.6 OpenResume: xitanggg/open-resume
- **URL:** https://github.com/xitanggg/open-resume. ~8.9k stars, **AGPL-3.0**, Next.js 13 + react-pdf + pdf.js. **Dormant:** last commit 2024-10-29.
- **Parser algorithm** (https://www.open-resume.com/resume-parser):
  - pdf.js text items are merged into lines, then grouped into sections.
  - A section title is the only item on its line, **bold and ALL-CAPS**, with a keyword fallback.
  - Entries are split into subsections by vertical gaps larger than 1.4× the line gap.
  - Fields are extracted by **feature scoring**. For example, for the name field, letters-only scores +3, bold +2 and all-caps +2, while containing "@", a digit or a comma scores −4 each.
- **Borrow:** Use the parser logic as a cheap **local ATS-readability test** for our generated PDFs, and its implied rules (single column, clear section headers, standard contact formats). Don't copy code without accepting AGPL obligations; reimplement the idea instead.
- **Weaknesses:** Unmaintained, English and single-column only.

### 1.7 JobFunnel: PaulMcInnis/JobFunnel
- **URL:** https://github.com/PaulMcInnis/JobFunnel. ~2.2k stars, MIT, Python. **Archived 2025-12-10.** The author says job boards' bot detection means it no longer works reliably.
- **Did:** scraped Indeed, Glassdoor and similar sites into a master CSV with dedupe ("Never see the same job twice"; TF-IDF similarity is listed as a topic), a `company_block_list`, `max_listing_days`, and a `status` column (interested/applied/interview/offer/archive/rejected/delete).
- **Lesson:** Scraping-only discovery is a dead end long-term. The status-column lifecycle and the persistent block list are still good ideas.

### 1.8 ApplyPilot: Pickle-Pixel/ApplyPilot
- **URL:** https://github.com/Pickle-Pixel/ApplyPilot. ~1.8k stars, **AGPL-3.0**, Python 3.11+, first published 2026-02-17, last commit 2026-03-08.
- **Pipeline:**
  - Discover from 5 boards (via JobSpy-style scraping), 48 Workday portals and 30 career sites.
  - Enrich the JD with a cascade: JSON-LD, then CSS selectors, then LLM extraction.
  - LLM score 1–10 with a `--min-score` threshold (9–10 strong, 7–8 good, 5–6 moderate, 1–4 skip).
  - Tailor the resume while preserving `resume_facts`, then write a cover letter.
  - **Auto-apply:** Claude Code drives Chrome via the Playwright MCP to fill and **submit** forms. A `--dry-run` mode fills without submitting.
- **Dedupe:** by URL only. There are no ToS warnings. Startup Fortune could not verify the viral "100k users" claim (https://startupfortune.com/?p=10281). A fork adds human-in-the-loop apply and Gmail tracking (https://github.com/ibarrajo/ApplyPilot).
- **Borrow:** The JSON-LD-first enrichment cascade (many career pages embed schema.org `JobPosting`) and the `resume_facts` lock.
- **Weaknesses:** Autonomous submission on third-party sites, URL-only dedupe, and an immature package.

### 1.9 Other notable 2025–2026 "AI job agent" repos
- **ai-job-search** (https://github.com/ai-job-search-dev/ai-job-search, formerly MadsLorentzen). ~66k stars, MIT, Claude Code + Python + LaTeX, last commit 2026-10-27.
  - Commands: `/setup`, `/scrape`, `/rank`, `/apply`, `/interview`, `/outcome`, `/gmail-sync`.
  - **Drafter/reviewer split:** a second agent with fresh context critiques the drafts.
  - Deal-breaker vetoes and a hard "Language Gate".
  - **Relevance-weighted CV cutting** instead of dropping the oldest content.
  - **`posting_guard.py`** strips hidden text and prompt-injection lines from job postings, treating JDs as untrusted.
  - Gmail-sync *proposes* status changes for approval.
- **Callback** (https://github.com/nomadicmehul/Callback). Tiny (0 stars) but architecturally almost identical to our plan: TypeScript/Node 22, React dashboard, **SQLite**, Claude Agent SDK, MCP tools as the only data access path for agents, a posting guard, a PDF text-layer read-back, "never auto-submits", and export refused if placeholders remain. Last commit 2026-10-26.
- **ai-job-search-system** (https://github.com/ketankbhagat/ai-job-search-system). Claude Skills + Claude in Chrome with a Sheets tracker. It explicitly avoids LinkedIn scraping and auto-apply.

### 1.10 Job-data sources and ATS public APIs
- **Greenhouse Job Board API** (https://docs.greenhouse.io/job-board.html):
  - `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`. "Authentication is not required for any GET endpoints."
  - The apply POST needs the *employer's* API key, so third parties cannot submit applications via the API.
- **Lever Postings API** (https://github.com/lever/postings-api):
  - `GET https://api.lever.co/v0/postings/{site}?mode=json&skip=&limit=`, with an EU host (`api.eu.lever.co`).
  - The apply POST needs an employer key and is limited to 2 POSTs/s. Lever recommends linking to its hosted form instead.
- **Ashby** (https://developers.ashbyhq.com/docs/public-job-posting-api):
  - `GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true`. No auth.
  - Returns `descriptionPlain`, `workplaceType`, `publishedAt`, `applyUrl` and compensation tiers.
  - Note that `isRemote` is true for hybrid jobs too, so use `workplaceType`.
- **Endpoint catalogue:** https://github.com/danielhagever/job-board-apis (MIT, tiny) documents tested public endpoints for 18 ATSs, including Recruitee, Workable, Teamtailor, Personio, BambooHR, Rippling and Workday CXS (`POST .../wday/cxs/{tenant}/{site}/jobs`). It excludes SmartRecruiters because of robots.txt.
- **Board-token lists:** There is **no canonical official directory**. Options:
  - Seed from community lists. For example, one PR describes ~10.5k boards (Greenhouse 5,444 / Ashby 3,047 / Lever 2,201) from a CC0 "Open Jobs" slugs.json (https://github.com/jimmarkunas/life-os-v7/pull/328).
  - Use per-ATS text files (https://github.com/blakegrudzien/find-jobs).
  - Use Common Crawl–based discovery (https://github.com/repomesh/ashby-job-scraper, which notes that Lever blocks Common Crawl).
  - The slug is simply the path segment of `boards.greenhouse.io/{x}`, `jobs.lever.co/{x}` or `jobs.ashbyhq.com/{x}`. A wrong token returns 404.
- **Curated GitHub lists:** SimplifyJobs New-Grad-Positions (~17k stars) and Summer2026-Internships (https://github.com/SimplifyJobs/Summer2026-Internships), which are maintained daily. These are good free feeds for early-career roles.

## 2. Synthesis

### 2.1 The common end-to-end workflow
1. **Ingest profile:** master CV (structured: YAML/JSON/Markdown), proof points, preferences, dealbreakers, target archetypes and a writing-style sample (AIHawk YAML, career-ops `cv.md` + `profile.yml`, ai-job-search profile files).
2. **Discover:** ATS JSON APIs → career pages (JSON-LD) → board scrapers → web search for new companies (career-ops tiers L0–L3).
3. **Filter cheaply:** title positive/negative keywords, location, age, block list. This step uses no LLM.
4. **Dedupe:** canonical URL, then company + title (+ location), then a description fingerprint.
5. **Liveness / legitimacy:** drop dead or ghost postings before spending tokens.
6. **Score:** gates (dealbreakers) → requirement extraction → CV match → global score + confidence → decision.
7. **Tailor:** CV, cover letter and outreach, with fact-lock, keyword placement and a PDF parse-back check.
8. **Apply:** human-approved (career-ops, Callback, ai-job-search) or autonomous (AIHawk, ApplyPilot, which carry high ban risk).
9. **Track and learn:** status lifecycle, follow-up cadence, outcome logging and calibration of scores against outcomes.

### 2.2 Concrete design lessons for our app

**Scoring rubric**
- **Use gates before scoring:** run hard dealbreakers (location or authorization, language, seniority floor, blacklisted company) as deterministic or LLM-yes/no checks. Only fire one when the JD *explicitly states* the fact (career-ops rule). This saves tokens and avoids false rejections.
- **Use two-pass requirement extraction:** extract requirements and importance from the JD *without the CV in context*, freeze them, then match. Tag each with an evidence tier (stated / structural / inferred) and cap inferred requirements below "high". This prevents the model from inflating requirements the candidate happens to meet.
- **Use a hybrid score:**
  1. A deterministic keyword/skills coverage score (Resume-Matcher weights are a sensible start: 40/20/15/15/10).
  2. An LLM rubric score per dimension: skills match, seniority fit, domain/track fit (cyber/web/app/game), comp, location/remote, culture/red flags.
  3. A **computed** weighted total in code, so it is reproducible, unlike career-ops' holistic number.
  - Keep a separate **confidence** field and a separate **legitimacy** field.
- **Decision bands:** map the total to Apply / Consider / Research / Skip. Gate expensive work such as cover letters and screening answers on the top band (career-ops only drafts answers at ≥4.5/5).
- **Calibrate:** store outcomes and periodically report score versus callback rate per source/ATS (career-ops `calibrate` / `patterns`).

**Prompt structure**
- **Static system block:** rubric, rules and output schema, plus the candidate profile. Cache it with prompt caching, since it's identical across jobs.
- **Per-job user block:** the sanitized JD.
- **Output:** strict JSON (tool or structured output) mirroring a "Machine Summary": `decision, score, dimensions[{name, score, evidence_status}], requirements[{text, importance, tier, match, evidence}], risks[], confidence_gaps[]`.
- **Treat JDs as untrusted input:** strip hidden text and HTML, flag injection-shaped lines, and never let JD text alter instructions (ai-job-search `posting_guard.py`, Callback).
- **Drafter → reviewer:** a fresh-context critique pass on cover letters and CVs catches fabrication and generic phrasing (ai-job-search).

**ATS-friendly CV rules** (career-ops `pdf.md`, OpenResume parser, Resume-Matcher)
- Single column. No tables, sidebars, text boxes or icons-as-text. Nothing important in header or footer.
- Standard section headers: Summary, Experience, Projects, Skills, Education, Certifications. Make them bold and on their own line.
- Reverse-chronological order. Standard date formats. Plain contact line (email, phone, city, portfolio/GitHub URL).
- Real selectable text with embedded standard fonts. No white-text or hidden keyword stuffing.
- Place keywords in the summary, the first bullet of each role and Skills. Use JD vocabulary only for skills that exist in the profile.
- **Fact-lock:** every number, employer, title and skill in the output must trace to the profile. Block export on unverified facts or leftover placeholders. Never change job titles without approval.
- **Verify:** re-extract the generated PDF's text (pdf.js/pdfminer) and check that sections and contact info parse. Letter for US/CA, A4 elsewhere. 1–2 pages.

**Dedupe keys** (store all of them; check in order)
1. `ats_key` = `{ats}:{board_token}:{job_id}` when known (Greenhouse, Lever, Ashby and Workday all expose stable IDs).
2. Canonical apply URL: lowercase host, strip query, fragment, trailing slash and tracking params. Prefer `job_url_direct` over the board URL.
3. `norm(company) + norm(title) + norm(location)` hash. Normalize "Inc/Ltd", seniority synonyms and "Sr."/"Senior".
4. A SimHash/MinHash of the description to catch reposts and cross-posts (90-day window). Warn, don't auto-merge.
- Record observational skips (filtered by title) separately from "seen", so changing filters can resurface them.

**Rate limiting and politeness**
- Per-host token buckets. Sequential for browser-based fetches. ≤1–2 req/s for ATS APIs, with backoff on 429 and Retry-After honored (Lever documents 2 POST/s. Glassdoor blocks above ~2 req/s per JobSpy).
- Conditional and incremental fetches: re-poll boards on a schedule (e.g. every 6–12 h), cache ETags or response hashes, and only fetch descriptions for new IDs.
- Run liveness checks only on new or shortlisted jobs. Log per-source errors and continue.
- Put a concurrency cap and cooldown on LLM batch calls (Resume-Matcher, ApplyPilot's 15 RPM free-tier note).

### 2.3 Legal / ToS and account-ban risk

- **LinkedIn:**
  - The help center states: "we don't permit the use of any third party software, including 'crawlers', bots, browser plug-ins, or browser extensions" that scrape or automate activity. Accounts "may be restricted or shut down" (https://www.linkedin.com/help/linkedin/answer/a1341387).
  - Precedent: AIHawk's creator was banned and threatened legally, and the LinkedIn features were removed.
  - In *hiQ v. LinkedIn* the court held the User Agreement's anti-scraping terms enforceable as contract. The case ended in a December 2022 consent judgment ($500k, permanent injunction, destruction of scraped data) (https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn, https://www.privacyworld.blog/2022/12/linkedins-data-scraping-battle-with-hiq-labs-ends-with-proposed-judgment/).
  - **Conclusion:** logged-in automation (Easy Apply bots, profile scraping, auto-messaging) puts the user's account at real risk, and the user is the one who loses it.
- **Indeed / Glassdoor / ZipRecruiter:**
  - Third-party summaries report that Indeed's terms prohibit scraping and automated access and limit use to personal job search (https://conductatlas.com/platform/indeed/indeed-terms-of-service/provision/CA-P-028619/prohibition-on-scraping-automated-access-and-bot-activity/). We did not read the primary text, so verify before relying on it.
  - All of these use bot management. JobFunnel was archived for exactly this reason.
- **Mass-apply reputational risk:** low-quality bulk applications get flagged by recruiters, and fabricated CV content (reported for AIHawk) can cost offers later.
- **Safer patterns:**
  1. **Prefer official, unauthenticated public ATS feeds** (Greenhouse, Lever, Ashby, Workable, Recruitee) and employer career pages' JSON-LD. These are published *for* distribution.
  2. **Never log into job boards programmatically.** If board results are wanted at all, use opt-in, low-volume, logged-out fetching, or let the user paste a URL or JD (career-ops "paste a URL" mode).
  3. **Human-in-the-loop apply:** the app prepares the CV, cover letter and answers, and opens the employer's hosted apply page. The user reviews and clicks Submit. ATS apply APIs require *employer* keys anyway.
  4. **Outreach:** draft only and never auto-send. Respect privacy law when storing recruiter contact data (minimal fields, user-supplied).
  5. **Honor robots.txt** and per-host rate limits. Identify with an honest User-Agent. No CAPTCHA solving and no proxy rotation for evasion.
  6. **Local-first data:** the profile and applications stay on device, and only the LLM provider sees prompts (career-ops, Callback).

## 3. What we borrow / what we do better

| Area | Borrow from | What we do better |
|---|---|---|
| Discovery | career-ops tiered scan; Greenhouse/Lever/Ashby public APIs; danielhagever endpoint catalogue; community board-token lists | First-class ATS connectors with a SQLite board registry (auto-discover tokens from pasted URLs); scrapers optional and off by default |
| Job schema | JobSpy JobPost fields (`job_url_direct`, salary interval normalization) | Single normalized `jobs` table with ATS IDs, `workplaceType`, comp tiers, and provenance per field |
| Dedupe | career-ops URL + company/role + SimHash | Layered keys (ATS ID → canonical URL → norm hash → MinHash) with a merge UI, not silent drops |
| Scoring | career-ops gates, two-pass requirement extraction, evidence tiers, confidence; Resume-Matcher deterministic ATS score | Code-computed weighted score (reproducible), track-specific rubrics (cyber/web/app/game), calibration dashboard from outcomes |
| Tailoring | career-ops fact-check gate and keyword placement; ai-job-search drafter/reviewer and relevance-weighted cutting; ApplyPilot `resume_facts` | Structured JSON CV + diff view of every change; block export on any unverifiable claim or placeholder |
| CV rendering | Reactive Resume JSON Resume import/export; OpenResume parser heuristics; Resume-Matcher pdfminer check | Built-in parse-back test on every export; Letter/A4 auto; DOCX + PDF |
| Security | ai-job-search `posting_guard`, Callback MCP-only data access | Sanitize JDs before any prompt; JD text never placed in the system role |
| Apply | career-ops "fills, never submits"; Callback approval loop | Approval queue in a GUI: open hosted ATS form, copy-ready answers, user clicks Submit; zero logged-in board automation |
| Tracking | JobFunnel status lifecycle; career-ops `states.yml`, follow-ups, patterns | Real DB pipeline (kanban) with follow-up reminders, outcome logging, per-source funnel stats |
| UX | (all are CLI/agent-in-terminal) | Native desktop app with React UI; non-developers can use it |
