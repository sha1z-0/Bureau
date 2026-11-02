# A01: Scout (finds the jobs)

**You own:** `server/sources/**`, `server/scout/**`, `sidecars/jobspy/**`, `docs/SOURCES.md`.
**Mission:** reach the maximum number of real, relevant, fresh postings on the internet through every legitimate channel, normalised into one schema, with no duplicates, resolved to the employer's own apply URL.

## Build
### 1. Connectors (extend `server/sources/`)
Keep all 16 existing connectors. Add the following. **Verify every endpoint live** before relying on it, and record it in `docs/SOURCES.md` (endpoint, auth, rate limit, fields, a sample).
- **ATS feeds, per company token:** SmartRecruiters (`api.smartrecruiters.com/v1/companies/{id}/postings`), Workday (the CXS JSON endpoint `POST https://{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`, paginated, with details from the job path), Workable, Recruitee (`{c}.recruitee.com/api/offers/`), Personio (`{c}.jobs.personio.de/xml`), Teamtailor, BambooHR, Breezy, JazzHR, Rippling, Pinpoint, Comeet, iCIMS where public. Each one maps into `RawJob` with `ats` and `applyUrl` set.
- **The JobSpy sidecar** (`sidecars/jobspy/`): a Python CLI (`python -m jobspy_cli --json '{...}'`) wrapping `python-jobspy`. Sites: linkedin, indeed, glassdoor, google, zip_recruiter, bayt, naukri. Guest or public search only, never logged in. Add `scripts/setup-sidecar.(ps1|sh)` to create a venv and pip install, and a TS client `scout/jobspy.ts` that spawns it, enforces a timeout and parses the JSON. If Python or the venv is missing, the connector reports `unavailable` and the scan continues. Respect JobSpy's documented limits (LinkedIn rate-limits early, about 1000 results per search). Rotate search terms from the campaign's roles × locations. Optional proxies come from settings.
- **Local and Gulf boards:** Rozee.pk, Mustakbil, GulfTalent, NaukriGulf (Bayt comes through JobSpy). Use public listing pages or RSS where they exist. Obey robots.txt, rate-limit politely, and identify honestly. If a site forbids automated access, skip it and document why.
- **More remote and niche boards:** keep the existing ones and add any high-signal public feeds you can verify (for example Wellfound's public listings if accessible without login, Y Combinator's Work at a Startup public pages, cybersecurity and game-dev niche boards). Document each.
- **Deep scan** (exists, `ai/scout.ts`): keep it. Feed it the campaign's roles, and have it also return the *company careers URLs* it sees, which go into the registry.

### 2. Company registry (`scout/registry.ts`)
- Seed from `sources/boards.ts`, every token in `docs/SOURCES.md`, the SimplifyJobs lists, and YC company lists.
- **ATS auto-detection:** given any careers URL or domain, detect the ATS from URL patterns and DOM fingerprints (boards.greenhouse.io / job-boards.greenhouse.io, jobs.lever.co, jobs.ashbyhq.com, *.myworkdayjobs.com, careers.smartrecruiters.com, apply.workable.com, *.recruitee.com, *.jobs.personio.*, *.teamtailor.com, *.bamboohr.com, *.breezy.hr, and so on), then extract the token.
- **Discovery:** every apply URL seen anywhere (aggregators, HN, deep scan) is parsed. If it points at an ATS, that company joins the registry and its whole board gets polled from then on. A weekly discovery job also uses Claude web search for `site:` queries per ATS, targeted at the campaign's categories.
- Per company, store the open-role count each poll. Record `signals` when the count jumps by 30% or more, or when deep scan reports funding news.

### 3. Pipeline (`scout/index.ts` → `runScout`)
1. Run connectors concurrently with per-source concurrency and rate limits, and per-source health (ok / slow / failing / unavailable, last error, counts) for the UI.
2. **Resolve:** follow aggregator "apply" links (HTTP only, through `safeFetch`, no browser) to the employer's ATS URL where possible, and set `apply_url_canonical`.
3. **Normalise:** salary parsing and annualisation, remote / hybrid / onsite, visa mentions, seniority, posted-at.
4. **Dedupe:** canonical URL, then the existing fingerprint (company + title + location), then **embedding similarity** (local `@huggingface/transformers` with a small sentence model, vectors in `job_embeddings`; cosine ≥ 0.92 with the same company counts as a duplicate). Keep the richest record and link the sources.
5. **Ghost / scam filter:** older than the campaign's max age, reposted 3+ times, no resolvable apply route, or obvious scam signals (payment requests, personal email only, crypto bait). Mark it, don't delete it.
6. **Freshness priority:** postings under 48 hours old get a boost the matcher reads.
7. Insert, then emit `pipeline.state` → `found` for each new job.

### 4. Hiring signals (`scout/signals.ts`)
Companies with fresh signals get their whole board polled every cycle, and their open roles in the campaign's categories get a priority flag.

## Tests (add to `selfcheck`, with fixtures from A11, or create your own under `fixtures/feeds/`)
- A parser test per connector against a recorded payload.
- ATS detection on 30+ URL samples.
- Dedupe: the same job from 3 sources collapses to 1.
- JobSpy client handles a missing Python gracefully.

## Acceptance
- [ ] 12+ ATS families supported, each verified live and documented
- [ ] The JobSpy sidecar works on Windows and Linux, and degrades gracefully
- [ ] The registry grows automatically from discovered apply URLs
- [ ] Per-source health is available through `/api/sources`
- [ ] A full scout run on a seeded registry yields ≥ 2,000 unique postings, with dedupe stats logged
