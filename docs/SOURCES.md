# Job sources: verified endpoints and response shapes

Verified with live `curl` / Node `fetch` requests on **2026-10-27**. Requests used a desktop Chrome User-Agent and 25–40 s timeouts. No API keys were used. Raw responses were saved outside the project, in the session scratchpad.

Target normalized shape used in every mapping below:

```ts
{ externalId, title, company, location, remote /*bool*/, url /*apply or listing*/, descriptionHtmlOrText,
  postedAt /*ISO*/, salaryMin, salaryMax, salaryCurrency, tags: string[] }
```

---

## 0. Summary

| # | Source | Works? | URL pattern | Key quirks |
|---|---|---|---|---|
| 1 | Greenhouse | YES | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true&pay_transparency=true` | Full list, no paging. `content` is **HTML-entity-escaped** HTML, so decode it twice. Salary is in `pay_input_ranges` (in cents) only when you pass `pay_transparency=true`. Remote status has to be inferred. |
| 2 | Lever | YES | `https://api.lever.co/v0/postings/{company}?mode=json[&skip=N&limit=M]` | Root is an array. `createdAt` is epoch **ms**. Transfers are slow (about 25 KB/s seen; Palantir is about 6 MB), so use `limit`/`skip` with long timeouts. EU tenants use `api.eu.lever.co`. Plaid has moved off Lever (404) to Ashby. |
| 3 | Ashby | YES | `https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true` | Has the best structured salary data (`compensation.summaryComponents`). Gives `isRemote` and `workplaceType`. A bad org returns 404 text/plain. A real org with nothing listed returns 200 with `jobs: []`. |
| 4 | Remotive | DEGRADED | `https://remotive.com/api/remote-jobs` | Returns the **same 10 jobs whatever the params**: `category`, `search` and `limit` are all ignored (identical md5). The data is 24 h delayed. Their own ToS caps polling at 4 per day. Low value. |
| 5 | RemoteOK | YES | `https://remoteok.com/api` (optional `?tag=x`) | `[0]` is a legal/metadata object, so skip it. About 100 jobs. `salary_min`/`max` are 0 when unknown. Location is usually `""`. The RSS feed is **410 Gone**. Backlinking is required. |
| 6 | Arbeitnow | YES | `https://www.arbeitnow.com/api/job-board-api?page=N` | 300 jobs per page. Mostly German/EU listings. `created_at` is epoch seconds. No salary or company id. |
| 7 | Himalayas | YES | `https://himalayas.app/jobs/api?limit=20&cursor=…` and `/jobs/api/search?q=…&page=N` | Max 20 per request. Uses cursor paging; `offset` is deprecated. Has good salary and seniority data. No CORS, so call it server-side only. Updates daily. |
| 8 | Jobicy | YES | `https://jobicy.com/api/v2/remote-jobs?count=N&tag=&industry=&geo=` (also `/api/jobs`) | `tag` is a loose full-text match. `count` can go up to 200, with cursor paging. Salary fields appear only when known. Poll at most once per hour. |
| 9 | HN "Who is hiring" | YES | Algolia `search_by_date?tags=story,author_whoishiring` then `items/{id}` | Comments are free text, so you must parse the first line heuristically. Of about 393 comments, 263 are top-level. Unauthenticated access is generous. |
| 9b | HN job stories (YC) | YES | `https://hacker-news.firebaseio.com/v0/jobstories.json` then `/v0/item/{id}.json` | Each item is only a title and URL, about 30 IDs. |
| 10 | We Work Remotely | YES | `https://weworkremotely.com/categories/{slug}.rss` | RSS. The title is `"Company: Role"`. `description` is escaped HTML. Some items have `skills`, `type`, `country`, `expires_at`. |
| 11 | The Muse | YES | `https://www.themuse.com/api/public/jobs?page=N&category=&level=&location=` | 20 per page. **500 requests/hour without a key** (confirmed through `X-Ratelimit-*` headers). No salary. Heavy on non-tech and big-company roles. |
| 12 | Reddit | BLOCKED (JSON) / PARTIAL (RSS) | `https://www.reddit.com/r/{sub}/new/.rss` | `.json` returns **403 "blocked by network security"** on www, old and api hosts. `.rss` (Atom) works but returns **429 after about 1 request** in a burst, so expect roughly 1 request every few seconds. |
| 13a | Workable | YES | `https://apply.workable.com/api/v1/widget/accounts/{sub}?details=true` | Without `details=true` there is no description. `published_on` is a date only. `telecommuting` is the remote flag. No salary. |
| 13b | SmartRecruiters | YES | `https://api.smartrecruiters.com/v1/companies/{id}/postings?limit=100&offset=N` | The list has **no description**. You need a per-job GET on `ref` for `jobAd.sections`. The company ID is case-sensitive (`Ubisoft2`). An unknown ID returns 200 with `totalFound: 0`. |
| 13c | Recruitee | YES | `https://{company}.recruitee.com/api/offers/` | Large payload (application questions included). Timestamps look like `"2026-10-26 13:02:53 UTC"`, which is not ISO. Has a `salary` object, often null. |
| 14a | Working Nomads | YES | `https://www.workingnomads.com/api/exposed_jobs/` | About 39 jobs, flat. `tags` is a comma string. The `url` is a redirect (`/job/go/{id}/`). No salary. |
| 14b | 4dayweek.io | YES | `https://4dayweek.io/api` (redirects to `/api/v1?page=N`) | 25 per page, about 27k total. The description is **Markdown**. Uses `posted` (epoch s). The salary is on a different endpoint, `/api/jobs`, where company names are "locked". |
| 14c | Landing.jobs | YES | `https://landing.jobs/api/v1/jobs?limit=N&offset=M` | EU (PT-heavy). Has a salary range and currency but **no company name** field (parse it from the `url` `/at/{company}/`). |
| 14d | SimplifyJobs GitHub lists | YES | `raw.githubusercontent.com/SimplifyJobs/{New-Grad-Positions,Summer2026-Internships}/dev/.github/scripts/listings.json` | About 2 MB, around 19k rows. **Filter `active && is_visible`**. New grad and intern roles only. No descriptions. |
| 14e | Jobspresso RSS | YES | `https://jobspresso.co/?feed=job_feed` | WP Job Manager RSS with `job_listing:company/location/salary/job_type`. 10 items. |
| 14f | Larajobs RSS | YES | `https://larajobs.com/feed` | 5 items. `job:salary`, `job:tags`, `job:location` namespaced. |
| 14g | Python.org jobs RSS | YES | `https://www.python.org/jobs/feed/rss/` | 20 items. Sparse: title is `"Role, Company"`, and the description starts with the location. |
| 14h | WorkWithIndies (gamedev) | YES | `https://workwithindies.com/careers/rss.xml` | 100 items. Title is `"{studio} is hiring a {role} to work from {where}"`. Tags are embedded in the description text. |
| 14i | Remote Game Jobs (gamedev) | YES | `https://remotegamejobs.com/feed.rss` | 34 items. Title is `"{studio} is hiring {role} (Remote Job)"`. |
| 14j | Himalayas RSS | YES | `https://himalayas.app/jobs/rss` | Atom-ish RSS with a `himalayasJobs:*` namespace. The JSON API is better. |
| 14k | Jobicy RSS | YES | `https://jobicy.com/feed/job_feed` | About 430 KB. The JSON API is better. |
| 14l | Workday CXS (bonus) | YES | `POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | Unofficial. Pages are at most 20. `postedOn` is relative text ("Posted 4 Days Ago"). You need a detail GET for the description and `startDate`. Covers CrowdStrike, NVIDIA and others. |
| x | infosec-jobs.com / ai-jobs.net | NO | Redirects to `foorilla.com/hiring/` | Merged into Foorilla. Its API is **paid** (PRO+). No free feed. |
| x | Remote.co | NO | `remote.co/remote-jobs/developer/feed/` | Connection reset. |
| x | Authentic Jobs | NO (not jobs) | `authenticjobs.com/feed/` | The feed is now **blog posts**, not jobs. |
| x | Hitmarker, golang.cafe RSS, devitjobs XML | NO | various | 404, or redirected to a signup page. |

**Recommended core set:** Greenhouse + Lever + Ashby (curated company list in section 15), plus Himalayas, Jobicy, RemoteOK, WWR RSS, Arbeitnow, HN Who's Hiring, The Muse, 4dayweek, Working Nomads, SmartRecruiters/Workable/Recruitee per company, and WorkWithIndies + RemoteGameJobs for gamedev.

General advice: send a real UA, cache aggressively (most sources update hourly to daily), poll no more often than hourly, and always store and display the source's own job URL with source attribution.

---

## 1. Greenhouse Job Board API: WORKS

- **List:** `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true&pay_transparency=true`
- **Single job:** `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}?pay_transparency=true`
- Also available: `/departments`, `/offices`, and `/v1/boards/{token}` (board info).
- Tested: anthropic (679 jobs), stripe (711), cloudflare (462), discord (46), figma (140). All returned 200.
- **Bad token:** 404 `{"status":404,"error":"Job not found"}`.
- **Pagination:** none. One call returns all jobs plus `meta.total`. With `content=true` the payload is large (Anthropic is about 3.2 MB, Stripe about 1.9 MB). Leave out `content=true` for a cheap check that jobs exist.
- **ToS:** a public, documented, unauthenticated API ("Job Board API"). It sends no rate-limit headers. Be polite: one fetch per board per few hours.
- **Quirks:**
  - `content` is HTML that has been **entity-escaped** (`&lt;div&gt;…`). Decode the entities once to get the HTML.
  - `pay_transparency=true` works on the **list** endpoint too. It adds `pay_input_ranges[]` with `min_cents`/`max_cents`, so divide by 100. On Discord, 43 of 46 jobs had it.
  - There is no remote boolean. Infer it from `location.name` or `offices[].name` matching `/remote/i`. Some boards (Anthropic) have a `metadata[]` entry with `name: "Location Type"` and a value such as `"On-Site"` or `"Remote"`.
  - `absolute_url` may be `job-boards.greenhouse.io/...`, `boards.greenhouse.io/...?gh_jid=`, or the company's own careers page with `?gh_jid=`.
  - Use `first_published` for `postedAt`, because `updated_at` changes on edits.
  - The response has `company_name`, so you don't need to hard-code it.

| normalized | Greenhouse field |
|---|---|
| externalId | `"gh:" + token + ":" + id` |
| title | `title` |
| company | `company_name` |
| location | `location.name` |
| remote | `/remote/i.test(location.name) \|\| offices.some(o=>/remote/i.test(o.name)) \|\| metadata "Location Type" == Remote` |
| url | `absolute_url` |
| descriptionHtmlOrText | `decodeEntities(content)` (HTML) |
| postedAt | `first_published` (ISO with offset), falling back to `updated_at` |
| salaryMin / Max / Currency | `pay_input_ranges[0].min_cents/100`, `max_cents/100`, `currency_type` |
| tags | `departments[].name` (+ `offices[].name`) |

Sample (one job, trimmed):

```json
{
  "absolute_url": "https://job-boards.greenhouse.io/discord/jobs/8806482002",
  "internal_job_id": 6524134002,
  "location": { "name": "San Francisco Bay Area" },
  "metadata": [{ "id": 4105571002, "name": "Featured on Website", "value": [], "value_type": "multi_select" }],
  "id": 8806482002,
  "updated_at": "2026-10-20T20:27:20-04:00",
  "requisition_id": "R-107406",
  "title": "Commercial Policy Lead",
  "pay_input_ranges": [{ "min_cents": 19200000, "max_cents": 21600000, "currency_type": "USD",
                         "title": "Base Salary", "blurb": "<p><em>The base salary range for this full-time position…" }],
  "company_name": "Discord",
  "first_published": "2026-09-15T12:52:11-04:00",
  "language": "en",
  "application_deadline": null,
  "content": "&lt;div class=&quot;content-intro&quot;&gt;&lt;p&gt;Discord has a highly engaged community…",
  "departments": [{ "id": 4054683002, "name": "Policy", "child_ids": [], "parent_id": 4094263002 }],
  "offices": [{ "id": 4082816002, "name": "Remote (US)", "location": null, "child_ids": [], "parent_id": null }],
  "data_compliance": "[…omitted]"
}
```

Envelope: `{ "jobs": [...], "meta": { "total": 679 } }`

---

## 2. Lever Postings API: WORKS

- `GET https://api.lever.co/v0/postings/{company}?mode=json`
- Optional parameters: `skip`, `limit`, `team`, `department`, `location`, `commitment`, `level`.
- Single posting: `GET https://api.lever.co/v0/postings/{company}/{id}`
- EU-hosted accounts use `https://api.eu.lever.co/v0/postings/{company}`.
- Tested:
  - spotify: 89 jobs.
  - palantir: about 300 jobs, about 6 MB. **Timed out at 25 s and at 150 s** because transfers ran at about 25 KB/s from this network. `limit=5` took 4.5 s.
  - **plaid: 404** `{"ok":false,"error":"Document not found"}`. Plaid is now on Ashby (`plaid`, 130 jobs).
- **ToS:** public documented postings API. No rate-limit headers.
- **Quirks:**
  - Root is a bare array.
  - `createdAt` is epoch **milliseconds**.
  - The title is `text`.
  - `workplaceType` is one of `remote`, `hybrid`, `onsite` (or `unspecified`).
  - The full description is `description` (or `descriptionBody`) plus `lists[]` (titled sections) plus `additional`. Concatenate them for the full text, or use the `*Plain` variants.
  - The `salaryRange {min,max,currency,interval}` field is documented, but it was **not present** on any posting checked (spotify, wealthfront, ro, toptal). Salary text often appears in `additional`.
  - Some tokens return `[]` (200, empty) when the company exists but has nothing open (for example mistral, kraken, highspot).

| normalized | Lever field |
|---|---|
| externalId | `"lever:" + company + ":" + id` |
| title | `text` |
| company | config value (not in payload) |
| location | `categories.location` (all: `categories.allLocations[]`) |
| remote | `workplaceType === "remote"` (or `/remote/i` on the location) |
| url | `hostedUrl` (apply: `applyUrl`) |
| descriptionHtmlOrText | `description + lists.map(l=>"<h3>"+l.text+"</h3>"+l.content) + additional` |
| postedAt | `new Date(createdAt).toISOString()` |
| salary | `salaryRange?.min/max/currency` if present, otherwise null (could regex `additionalPlain`) |
| tags | `[categories.team, categories.department, categories.commitment].filter(Boolean)` |

Sample:

```json
{
  "additionalPlain": "The United States base range for this position is $87,069-$124,385 plus equity. The benefits…",
  "additional": "<div>The United States base range for this position is $87,069-$124,385 plus equity…",
  "categories": { "commitment": "Permanent", "department": "Operations and Business Support",
                  "location": "New York, NY", "team": "Platform", "allLocations": ["New York, NY"] },
  "createdAt": 1792767640768,
  "descriptionPlain": "Spotify Technology is our business-to-business software team…",
  "description": "<div>\n<p>Spotify Technology is our business-to-business software team…",
  "id": "2a55d6c9-c564-443a-be3e-a3851db5a93b",
  "lists": [{ "text": "What You'll Do", "content": "<div>\n<p>• Identify and pursue new business…" }, "…+2 more"],
  "text": "Account Executive - Commercial, Spotify Technology",
  "country": "US",
  "workplaceType": "hybrid",
  "opening": "", "openingPlain": "",
  "descriptionBody": "<div>…", "descriptionBodyPlain": "…",
  "hostedUrl": "https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b",
  "applyUrl": "https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b/apply"
}
```

---

## 3. Ashby Posting API: WORKS

- `GET https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true`
- Tested: openai (797 jobs, about 1.27 MB), notion (139), linear (32), ramp (173). All returned 200.
- **Bad org:** 404, `text/plain` body `Not Found`.
- An existing org with nothing posted returns 200 `{"jobs":[]}`.
- Envelope: `{ "jobs": [...], "apiVersion": "1" }`. No pagination.
- **ToS:** public posting API, documented by Ashby for career-site embedding. No rate-limit headers.
- **Quirks:**
  - The response has no company name, so use your config value.
  - `title` can have leading or trailing spaces, so trim it.
  - `workplaceType` is one of `Remote`, `Hybrid`, `OnSite` or `null`. `isRemote` is a separate boolean. Ramp's "Hybrid" job had `isRemote: true` because of its secondary locations.
  - `compensation` only appears with `includeCompensation=true`. Pick the `summaryComponents` item with `compensationType === "Salary"`. `interval` is, for example, `"1 YEAR"` or `"1 HOUR"`. On OpenAI, 634 of 797 jobs had a salary.
  - `isListed: false` jobs are possible, so filter them out.

| normalized | Ashby field |
|---|---|
| externalId | `"ashby:" + org + ":" + id` |
| title | `title.trim()` |
| company | config value |
| location | `location` (+ `secondaryLocations[].location`) |
| remote | `isRemote \|\| workplaceType === "Remote"` |
| url | `jobUrl` (apply: `applyUrl`) |
| descriptionHtmlOrText | `descriptionHtml` (or `descriptionPlain`) |
| postedAt | `publishedAt` |
| salary | `c = compensation.summaryComponents.find(x=>x.compensationType==="Salary")`, giving `c.minValue`, `c.maxValue`, `c.currencyCode` |
| tags | `[department, team, employmentType].filter(Boolean)` |

Sample:

```json
{
  "id": "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
  "title": " Security Engineer, Cloud",
  "department": "Engineering", "team": "Backend", "employmentType": "FullTime",
  "location": "New York, NY (HQ)",
  "shouldDisplayCompensationOnJobPostings": true,
  "secondaryLocations": [{ "location": "Remote (Canada)", "address": { "postalAddress": { "addressCountry": "Canada" } } }, "…+2 more"],
  "publishedAt": "2026-04-07T17:12:35.753+00:00",
  "isListed": true, "isRemote": true, "workplaceType": "Hybrid",
  "address": { "postalAddress": { "addressRegion": "NY", "addressCountry": "USA", "addressLocality": "New York City" } },
  "jobUrl": "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245",
  "applyUrl": "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application",
  "descriptionHtml": "<h1><strong>About Ramp</strong></h1><p …",
  "descriptionPlain": "ABOUT RAMP\n\nRamp is building the smart infrastructure…",
  "compensation": {
    "compensationTierSummary": "$211.4K – $290.6K • Offers Equity",
    "scrapeableCompensationSalarySummary": "$211.4K - $290.6K",
    "compensationTiers": ["…"],
    "summaryComponents": [
      { "compensationType": "EquityPercentage", "interval": "NONE", "currencyCode": null, "minValue": null, "maxValue": null },
      { "compensationType": "Salary", "interval": "1 YEAR", "currencyCode": "USD", "minValue": 211400, "maxValue": 290600 }
    ]
  }
}
```

---

## 4. Remotive: DEGRADED (works, but returns a fixed 10 jobs)

- `GET https://remotive.com/api/remote-jobs`
- Category list: `GET https://remotive.com/api/remote-jobs/categories`. Slugs include `software-development`, `devops`, `qa`, `data`, `design`, `artificial-intelligence` and others. The old `software-dev` slug is wrong.
- **Finding:** `?category=software-dev&limit=5`, `?category=software-development&limit=50`, `?search=security&limit=3` and no params at all returned a **byte-identical** response with `job-count: 10` and mixed categories. The public API currently ignores filters and caps output at 10.
- **ToS** (embedded in the response under `0-legal-notice`):
  - Link back to the Remotive URL **and** mention Remotive as the source.
  - Do not submit the jobs to Jooble, Google Jobs, LinkedIn and similar.
  - Jobs are **delayed 24 h**.
  - Do not gate listings behind signups.
  - Poll **at most 4 times per day**, or you will be blocked.
  - A paid API exists (from $5k/month).
- Envelope keys: `00-warning`, `0-legal-notice`, `job-count`, `total-job-count`, `jobs[]`.

| normalized | field |
|---|---|
| externalId | `"remotive:" + id` |
| title | `title` |
| company | `company_name` |
| location | `candidate_required_location` |
| remote | `true` |
| url | `url` |
| description | `description` (HTML) |
| postedAt | `publication_date + "Z"` (no timezone given; assume UTC) |
| salary | `salary` is **free text** (`"70K-80K"`, `"$1000 per task"`). Parse it best-effort and set currency to null unless it contains `$`/`€`. |
| tags | `tags[]` + `category` + `job_type` |

```json
{
  "id": 2091161,
  "url": "https://remotive.com/remote-jobs/artificial-intelligence/ai-trainer-video-annotation-2091161",
  "title": "AI Trainer - Video Annotation",
  "company_name": "iMerit Technology",
  "company_logo": "https://remotive.com/job/2091161/logo",
  "category": "Artificial Intelligence",
  "tags": ["video", "AI/ML", "…+1 more"],
  "job_type": "freelance",
  "publication_date": "2026-10-22T18:40:19",
  "candidate_required_location": "Worldwide",
  "salary": "70K-80K",
  "description": "<p dir=\"ltr\" style=\"line-height:1.2;…",
  "company_logo_url": "https://remotive.com/job/2091161/logo"
}
```

---

## 5. RemoteOK: WORKS

- `GET https://remoteok.com/api` returns about 100 most recent jobs.
- `GET https://remoteok.com/api?tag=security` filters by tag. It returned 14 entries, but the tag is loose: "Security Officer", "Loss Prevention" and other non-tech roles came back.
- The **RSS feed `remoteok.com/remote-jobs.rss` and tag RSS return 410 Gone.**
- **ToS** (from `[0].legal`): link back to the Remote OK URL **with follow (no `nofollow`)** and mention Remote OK as the source, or API access will be suspended. Don't use their logo.
- **Quirks:**
  - **Element `[0]` is `{ last_updated, legal }`, not a job.** Skip it.
  - `salary_min` and `salary_max` are `0` when unknown (76 of 100 jobs), so map 0 to null.
  - `location` is often `""`.
  - `apply_url` equals `url` (the RemoteOK page).
  - `description` is HTML.
  - `position` is the title.

| normalized | field |
|---|---|
| externalId | `"remoteok:" + id` |
| title | `position` |
| company | `company` |
| location | `location \|\| "Remote"` |
| remote | `true` |
| url | `url` |
| description | `description` |
| postedAt | `date` (ISO), or `epoch*1000` |
| salary | `salary_min \|\| null`, `salary_max \|\| null`, `"USD"` when > 0 |
| tags | `tags[]` |

```json
{
  "slug": "remote-senior-software-engineer-latam-wagmo-1137572",
  "id": "1137572",
  "epoch": 1793001606,
  "date": "2026-10-26T08:00:06+00:00",
  "company": "Wagmo",
  "company_logo": "",
  "position": "Senior Software Engineer LATAM",
  "tags": ["dev", "design", "…+9 more"],
  "description": "<p style=\"min-height:1.5em\"><strong>Senior Software Engineer</strong></p>…",
  "location": "",
  "salary_min": 100000,
  "salary_max": 140000,
  "apply_url": "https://remoteOK.com/remote-jobs/remote-senior-software-engineer-latam-wagmo-1137572",
  "logo": "",
  "url": "https://remoteOK.com/remote-jobs/remote-senior-software-engineer-latam-wagmo-1137572"
}
```

---

## 6. Arbeitnow: WORKS

- `GET https://www.arbeitnow.com/api/job-board-api?page=N` returns 300 per page.
- Envelope: `{ data[], links{first,last,prev,next}, meta{current_page, per_page, terms, info…} }`
- **ToS** (from `meta.terms`): a free public API, "please do not abuse", and a link back is appreciated. Jobs update hourly, ordered by `created_at`.
- **Quirks:**
  - Mostly German and EU listings, many of them in German.
  - `created_at` is epoch **seconds**.
  - No salary and no numeric id. Use `slug` as the id.
  - `job_types` are often German strings.

| normalized | field |
|---|---|
| externalId | `"arbeitnow:" + slug` |
| title | `title` |
| company | `company_name` |
| location | `location` |
| remote | `remote` |
| url | `url` |
| description | `description` (HTML) |
| postedAt | `new Date(created_at*1000)` |
| salary | null |
| tags | `tags[]` + `job_types[]` |

```json
{
  "slug": "sap-fi-inhouse-berater-dortmund-196923",
  "company_name": "SAPPLIER GmbH",
  "title": "SAP FI Inhouse Berater (m/w/d)",
  "description": "<p>Für ein sehr renommiertes Unternehmen suchen wir…",
  "remote": false,
  "url": "https://www.arbeitnow.com/jobs/companies/sapplier-gmbh/sap-fi-inhouse-berater-dortmund-196923",
  "tags": ["SAP/ERP Consulting", "Development"],
  "job_types": ["Unbefristeter arbeitsvertrag", "berufserfahren"],
  "location": "Dortmund",
  "created_at": 1793107861
}
```

---

## 7. Himalayas: WORKS

- Browse: `GET https://himalayas.app/jobs/api?limit=20&cursor={nextCursor}`. Max 20 per request. Follow `nextCursor` until it is absent. `offset` is deprecated.
- Search: `GET https://himalayas.app/jobs/api/search?q=security&page=N`. Also accepts country, seniority, employment type, company slug, timezone and sort. 20 per page, page-based. The `totalCount` reported for `q=security` was 5000 (capped).
- Is a job still open? `GET /jobs/api/companies/{companySlug}/jobs/{slug}` returns 200 if open, 410 if closed, 404 if unknown.
- Envelope: `{ comments, updatedAt, offset, limit, totalCount (about 132k), nextCursor, jobs[] }`
- **ToS** (`himalayas.app/api`, `/terms#api`):
  - Use `applicationLink` **unchanged** for Apply buttons.
  - Show a visible "via Himalayas" link.
  - Don't redistribute to other boards, Google Jobs or LinkedIn.
  - Remove jobs once they expire.
  - Without a key, all callers share one public allowance. A free key gives 60 requests/min and 10k/day.
  - Returns 429 when over the limit.
  - **No CORS**, so call it from the backend.
  - Data refreshes daily.
- **Quirks:**
  - There is no id field. Use `guid` (the URL).
  - `pubDate` and `expiryDate` are epoch **seconds**.
  - All jobs are remote. Restrictions are in `locationRestrictions[]` and `timezoneRestrictions[]`.

| normalized | field |
|---|---|
| externalId | `"himalayas:" + guid` |
| title | `title` |
| company | `companyName` |
| location | `locationRestrictions.join(", ") \|\| "Worldwide"` |
| remote | `true` |
| url | `applicationLink` |
| description | `description` (HTML), or `excerpt` |
| postedAt | `new Date(pubDate*1000)` |
| salary | `minSalary`, `maxSalary`, `currency` (check `salaryPeriod`) |
| tags | `[...parentCategories, ...categories, ...seniority, employmentType]` |

```json
{
  "title": "Sr. Staff Technical Marketing Analyst (Bay Area Remote) (Fremont, CA, US)",
  "excerpt": "About our group: We are seeking a Sr. Staff Technical Marketing Analyst…",
  "companyName": "Seagate Technology, LLC",
  "companySlug": "seagate-technology-llc",
  "companyLogo": "https://cdn-images.himalayas.app/obh7v6fe1l4z464qb3rpcku6s3ce",
  "employmentType": "Full Time",
  "minSalary": 166000, "maxSalary": 242000, "salaryPeriod": "annual", "currency": "USD",
  "seniority": ["Senior"],
  "locationRestrictions": ["United States"],
  "timezoneRestrictions": [-10, -9, "…+5 more"],
  "categories": ["Technical-Marketing-Analyst", "Product-Marketing-Analyst", "…+3 more"],
  "parentCategories": [],
  "description": "<div>\n<div>\n<div><h2><b>About our group:</b></h2>…",
  "pubDate": 1793109598,
  "expiryDate": 1798293597,
  "applicationLink": "https://himalayas.app/companies/seagate-technology-llc/jobs/sr-staff-technical-marketing-analyst-…",
  "guid": "https://himalayas.app/companies/seagate-technology-llc/jobs/sr-staff-technical-marketing-analyst-…"
}
```

---

## 8. Jobicy: WORKS

- `GET https://jobicy.com/api/v2/remote-jobs?count=50&tag=react&industry=engineering&geo=usa`
- The newer alias `https://jobicy.com/api/jobs?...` returns the same shape (apiVersion 2.2.19).
- Parameters:
  - `count`: 1–200.
  - `tag`: **loose full-text**. `tag=react` returned a "Technical Account Manager".
  - `industry`, `geo`: slugs, listed at `?get=industries` and `?get=locations`.
  - `cursor`: from `nextCursor`. Cursors expire after 24 h.
- Envelope: `{ apiVersion, documentationUrl, friendlyNotice, jobCount, lastUpdate, nextCursor, hasMore, appliedFilters, jobs[], statusCode, success }`
- **ToS** (`friendlyNotice` plus docs):
  - Credit Jobicy with a direct link.
  - Apply buttons must go to the original Jobicy job URL.
  - Start sync passes at most hourly; a few per day is enough.
  - Unspecified 429 rate limits exist.
- **Quirks:**
  - `salaryMin`, `salaryMax`, `salaryCurrency` and `salaryPeriod` are **present only on some jobs**.
  - `jobIndustry`, `jobType` and `jobGeo` are arrays or strings.
  - The description is HTML with a leading newline.

| normalized | field |
|---|---|
| externalId | `"jobicy:" + id` |
| title | `jobTitle` |
| company | `companyName` |
| location | `jobGeo` |
| remote | `true` |
| url | `url` |
| description | `jobDescription` (HTML) |
| postedAt | `pubDate` (ISO) |
| salary | `salaryMin`, `salaryMax`, `salaryCurrency` (period in `salaryPeriod`) |
| tags | `[...jobIndustry, ...jobType, jobLevel]` |

```json
{
  "id": 157339,
  "url": "https://jobicy.com/jobs/157339-senior-phishing-tradecraft-researcher",
  "jobSlug": "157339-senior-phishing-tradecraft-researcher",
  "jobTitle": "Senior Phishing Tradecraft Researcher",
  "companyName": "Huntress",
  "companyLogo": "https://jobicy.com/data/server-nyc0409/galaxy/mercury/2025/06/91eae3ae-221.jpg",
  "jobIndustry": ["Cybersecurity"],
  "jobType": ["Full-Time"],
  "jobGeo": "USA",
  "jobLevel": "Director",
  "jobExcerpt": "What We Do: Cybercrime is growing, and more businesses are getting hit…",
  "jobDescription": "\n<p><strong>What We Do:</strong></p>\n<p>Cybercrime is growing…",
  "pubDate": "2026-10-27T09:59:26+00:00",
  "salaryMin": 170000, "salaryMax": 185000, "salaryCurrency": "USD", "salaryPeriod": "yearly"
}
```

---

## 9. Hacker News "Ask HN: Who is hiring?": WORKS

1. **Find the latest thread:** `GET https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`
   - Results are ordered newest first and include "Who is hiring?", "Who wants to be hired?" and "Freelancer?" threads. Pick the first hit whose `title` starts with `"Ask HN: Who is hiring?"`.
   - Latest at time of testing: `49922569`, "Ask HN: Who is hiring? (October 2026)", created 2026-10-01, 392 comments. The November thread should appear about 2026-11-02.
2. **Fetch its comments**, using either of:
   - **Option A (recommended):** `GET https://hn.algolia.com/api/v1/items/{storyId}` returns the full tree (about 475 KB). Top-level job posts are `children[]` (263 of them). Skip children whose `text` is null (deleted).
   - **Option B:** `GET https://hn.algolia.com/api/v1/search?tags=comment,story_{storyId}&hitsPerPage=1000` returns a flat list of 393 hits, **including replies**. Keep only `parent_id == storyId`. The text is in `comment_text`.
   - The official Firebase API also works: `https://hacker-news.firebaseio.com/v0/item/{id}.json` gives `kids[]` (319 IDs), but that is one request per comment.
- **ToS / limits:** HN Algolia API is public, no key. Algolia documents a limit of about 10k requests/hour per IP.
- **Quirks:**
  - The text is HTML with entity-escaped characters (`&#x2F;`) and `<p>` separators.
  - The first line is conventionally `Company | Role | Location | REMOTE/ONSITE | Salary | URL`, but the separators vary (`|`, `—`, `-`). Parse it heuristically:
    - remote: `/\bremote\b/i`
    - salary: regex such as `\$?\d{2,3}k`
    - url: the first `<a href>`

| normalized | field |
|---|---|
| externalId | `"hn:" + id` |
| title | first line segment that looks like a role (heuristic) |
| company | first segment of the first line |
| location | segment matching city or `REMOTE` |
| remote | `/remote/i.test(firstLine)` |
| url | `https://news.ycombinator.com/item?id=` + id (or the first link in the text) |
| description | `text` (HTML) |
| postedAt | `created_at` |
| salary | regex on text, otherwise null |
| tags | `["hn-whoishiring"]` + tech keywords found |

```json
{
  "author": "mwest1066",
  "created_at": "2026-10-01T15:02:37.000Z",
  "created_at_i": 1790866957,
  "id": 49922584,
  "options": [],
  "parent_id": 49922569,
  "points": null,
  "story_id": 49922569,
  "text": "PrairieLearn (Remote US) — Full-Stack Software Engineer — TypeScript &#x2F; Postgres &#x2F; React &#x2F; AI<p>…",
  "title": null,
  "type": "comment",
  "url": null,
  "children": ["…"]
}
```

### 9b. HN job stories (YC startup job ads): WORKS

- `GET https://hacker-news.firebaseio.com/v0/jobstories.json` returns about 30 IDs.
- Then `GET /v0/item/{id}.json` for each.
- Example: `{"by":"ukd1","id":50179455,"score":1,"time":1792584024,"title":"9 Mothers (YC P26) Is Hiring in Austin, TX","type":"job","url":"https://9mothers.com/careers"}`
- Mapping: title and company are parsed from `title` (`"{Company} (YC xxx) Is Hiring …"`); `url` is `url`; `postedAt` is `time*1000`. There is no description.

---

## 10. We Work Remotely RSS: WORKS

- `https://weworkremotely.com/categories/remote-programming-jobs.rss` (25 items)
- `https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss` (30 items)
- `https://weworkremotely.com/categories/remote-design-jobs.rss` (29 items)
- Other slugs follow `remote-{category}-jobs`. Older aliases include `remote-full-stack-programming-jobs`, `remote-back-end-programming-jobs` and `remote-front-end-programming-jobs`.
- Channel `ttl` is 60 minutes.
- **ToS:** the terms page returned 403 to automated fetch. The RSS feeds are publicly linked, so treat them as fair to read for personal use, and link back to `link`.
- Item elements:
  - Always present: `title`, `region`, `category`, `description` (escaped HTML), `pubDate` (RFC-822), `guid`, `link`.
  - Optional (about 70% of items): `country`, `state`, `skills`, `type`, `expires_at`, `media:content`.
- **Quirks:**
  - `title` is `"Company: Role"`. Split on the first `": "`.
  - The description starts with `<strong>Headquarters:</strong> …`.

| normalized | field |
|---|---|
| externalId | `"wwr:" + guid` |
| title | `title.split(": ").slice(1).join(": ")` |
| company | `title.split(": ")[0]` |
| location | `region` (+ `country`) |
| remote | `true` |
| url | `link` |
| description | `description` (unescape once, then HTML) |
| postedAt | `new Date(pubDate).toISOString()` |
| salary | null |
| tags | `[category, type, ...skills.split(",")]` |

```xml
<item>
  <title>Upsun: Senior IT Systems Engineer</title>
  <region>Anywhere in the World</region>
  <country></country>
  <state></state>
  <skills></skills>
  <category>DevOps and Sysadmin</category>
  <type>Full-Time</type>
  <description>&lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; … (escaped HTML)</description>
  <pubDate>Tue, 27 Oct 2026 07:30:51 +0000</pubDate>
  <expires_at>Thu, 26 Nov 2026 07:30:51 +0000</expires_at>
  <guid>https://weworkremotely.com/remote-jobs/upsun-senior-it-systems-engineer</guid>
  <link>https://weworkremotely.com/remote-jobs/upsun-senior-it-systems-engineer</link>
</item>
```

---

## 11. The Muse: WORKS

- `GET https://www.themuse.com/api/public/jobs?page=1&category=Software%20Engineering`
- Other filters: `level=Senior%20Level`, `location=Flexible%20%2F%20Remote`, `company=…`, `descending=true`.
- `page` is required and 0-based in the docs; `page=1` worked.
- Envelope: `{ page, page_count, items_per_page: 20, took, timed_out, total, results[], aggregations }`
- Totals seen: Software Engineering had 92,926 jobs; Senior plus Remote had 485.
- **Rate limit:** `X-Ratelimit-Limit: 500` per hour without a key (confirmed through headers). A registered `api_key` raises it to 3,600/hour.
- **ToS:** the terms are at `/developers/api/v2/terms`, and registration is expected for anything beyond testing.
- **Quirks:**
  - No salary.
  - `contents` is HTML.
  - Remote shows up as a location named `"Flexible / Remote"`.
  - `levels[]` and `categories[]` are objects.

| normalized | field |
|---|---|
| externalId | `"muse:" + id` |
| title | `name` |
| company | `company.name` |
| location | `locations.map(l=>l.name).join("; ")` |
| remote | `locations.some(l=>/remote\|flexible/i.test(l.name))` |
| url | `refs.landing_page` |
| description | `contents` |
| postedAt | `publication_date` |
| salary | null |
| tags | `[...categories.map(c=>c.name), ...levels.map(l=>l.name), ...tags]` |

```json
{
  "contents": "<div><p>SpaceX was founded under the belief that a future where humanity…",
  "name": "Sr. Embedded Software Engineer, OS/Platform (Starlink)",
  "type": "external",
  "publication_date": "2026-06-26T18:34:36Z",
  "short_name": "sr-embedded-software-engineer-osplatform-starlink",
  "model_type": "jobs",
  "id": 21825761,
  "locations": [{ "name": "Lockhart, TX" }],
  "categories": [{ "name": "Software Engineering" }],
  "levels": [{ "name": "Senior Level", "short_name": "senior" }],
  "tags": [],
  "refs": { "landing_page": "https://www.themuse.com/jobs/spacex/sr-embedded-software-engineer-osplatform-starlink" },
  "company": { "id": 15000190, "short_name": "spacex", "name": "SpaceX" }
}
```

---

## 12. Reddit: BLOCKED (JSON), PARTIAL (RSS)

- `https://www.reddit.com/r/forhire/new.json?limit=5`, `r/remotejs` and `r/cybersecurityjobs` all returned **403**: an HTML page saying "You've been blocked by network security".
- `old.reddit.com/...json` redirects to the login page ("lor2"). `api.reddit.com` also returns 403.
- **RSS works:** `https://www.reddit.com/r/{sub}/new/.rss` returns 200 Atom for `forhire` and `remotejs`. Back-to-back requests get **429**; `cybersecurityjobs` and `gameDevClassifieds` were 429 when burst. Space requests out (more than 10 s apart) and expect occasional 429s.
- **ToS:** Reddit's Data API terms require OAuth app registration for API access. Unauthenticated JSON is effectively closed. For a personal local tool, RSS at low frequency is the pragmatic option. Legitimate high-volume use needs an OAuth "script" app (free, needs a Reddit account and client id/secret).
- r/forhire is mostly `[FOR HIRE]` self-promotion. Filter titles to `[HIRING]`.
- Atom entry fields: `id` (`t3_xxx`), `title`, `link@href`, `author/name`, `published`, `updated`, `content` (escaped HTML), `category@term`.

| normalized | field |
|---|---|
| externalId | `"reddit:" + id` |
| title | `title` (strip `[HIRING]`) |
| company | null, or parsed from the title |
| location | parsed from the title (for example `[Remote]`) |
| remote | `/remote/i.test(title)` |
| url | `link@href` |
| description | `content` |
| postedAt | `published` |
| salary | null or regex |
| tags | `[subreddit]` |

```xml
<entry>
  <author><name>/u/No_Future444</name><uri>https://www.reddit.com/user/No_Future444</uri></author>
  <category term="forhire" label="r/forhire"/>
  <content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Hey, I'm Rish a graphic designer…</content>
  <id>t3_1xgtixy</id>
  <link href="https://www.reddit.com/r/forhire/comments/1xgtixy/for_hire_graphic_designer_6_yrs_logos_brand/" />
  <updated>2026-10-27T14:07:56+00:00</updated>
  <published>2026-10-27T14:07:56+00:00</published>
  <title>[FOR HIRE] Graphic Designer (6+ yrs) Logos &amp; brand Identities for businesses</title>
</entry>
```

---

## 13. Per-company ATS (other than Greenhouse, Lever and Ashby)

### 13a. Workable: WORKS

- `GET https://apply.workable.com/api/v1/widget/accounts/{subdomain}?details=true`. **Without `details=true` there is no `description`.**
- Tested:
  - `huggingface`: 6 jobs.
  - `tiqets`: 200 with `jobs: []`.
  - `workable`: 404 text/plain.
- Alternative: `POST https://apply.workable.com/api/v3/accounts/{sub}/jobs` with body `{"query":"","location":[],"department":[],"worktype":[],"remote":[]}`. It returns `{results:[{id, shortcode, title, remote, location, published (ISO)…}]}` and is paginated with `nextPage` in the body.
- Envelope (v1): `{ name, description, jobs[] }`
- **Quirks:**
  - `published_on` is a **date only** (`"2026-05-29"`).
  - `telecommuting` is the remote flag.
  - No salary.

| normalized | field |
|---|---|
| externalId | `"workable:" + sub + ":" + shortcode` |
| title | `title` |
| company | envelope `name` |
| location | `[city, state, country].filter(Boolean).join(", ")` |
| remote | `telecommuting` |
| url | `url` (apply: `application_url`) |
| description | `description` (HTML, with `details=true`) |
| postedAt | `published_on + "T00:00:00Z"` |
| salary | null |
| tags | `[department, function, employment_type, experience].filter(Boolean)` |

```json
{
  "title": "Open-Source Machine Learning Engineer - EMEA Remote",
  "shortcode": "81B46579FE", "code": "",
  "employment_type": "Full-time", "telecommuting": true, "department": "Open Source",
  "url": "https://apply.workable.com/j/81B46579FE",
  "shortlink": "https://apply.workable.com/j/81B46579FE",
  "application_url": "https://apply.workable.com/j/81B46579FE/apply",
  "published_on": "2026-05-29", "created_at": "2026-05-29",
  "country": "France", "city": "Paris", "state": "Île-de-France",
  "education": "", "experience": "", "function": "Engineering", "industry": "Computer Software",
  "locations": [{ "country": "France", "countryCode": "FR", "city": "Paris", "region": "Île-de-France", "hidden": false }],
  "description": "<p></p><p>At Hugging Face, we're on a journey to democratize good AI…"
}
```

### 13b. SmartRecruiters: WORKS

- List: `GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings?limit=100&offset=0`. Optional `q=`, `country=` and others.
- Detail: `GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings/{id}`, which is the `ref` field from the list.
- Tested:
  - `Ubisoft2`: `totalFound` 326.
  - `BoschGroup`: works.
  - `Visa`: 200 with `totalFound: 0`. An unknown or unused ID returns an empty result, not a 404.
- Envelope: `{ offset, limit, totalFound, content[] }`
- **Quirks:**
  - The list has **no description and no URL**. The detail has `postingUrl`, `applyUrl` and `jobAd.sections.{companyDescription, jobDescription, qualifications, additionalInformation}.text` (HTML).
  - The company identifier is case-sensitive and sometimes suffixed (`Ubisoft2`).
  - No salary in the public posting.

| normalized | field |
|---|---|
| externalId | `"sr:" + company.identifier + ":" + id` |
| title | `name` |
| company | `company.name` |
| location | `location.fullLocation` |
| remote | `location.remote` (also `location.hybrid`) |
| url | detail `postingUrl`, or build `https://jobs.smartrecruiters.com/{identifier}/{id}` |
| description | detail `jobAd.sections.*.text` joined |
| postedAt | `releasedDate` |
| salary | null |
| tags | `[department.label, function.label, experienceLevel.label, typeOfEmployment.label, industry.label]` |

```json
{
  "id": "744000158084745",
  "name": "Gameplay Animation Director - Beyond Good & Evil 2 - H/F/NB",
  "uuid": "b915b23b-94a4-4eaf-bb56-06fca22438a2",
  "refNumber": "REF30710V",
  "company": { "identifier": "Ubisoft2", "name": "Ubisoft" },
  "releasedDate": "2026-10-27T15:37:02.675Z",
  "location": { "city": "Montpellier", "region": "Occitanie", "country": "fr", "remote": false, "hybrid": false,
                "fullLocation": "Montpellier, Occitanie, France" },
  "industry": { "id": "entertainment", "label": "Entertainment" },
  "department": { "id": "775462", "label": "Animation" },
  "function": { "id": "production", "label": "Production" },
  "typeOfEmployment": { "id": "permanent", "label": "Full-time" },
  "experienceLevel": { "id": "director", "label": "Director" },
  "customField": ["…12 items"],
  "visibility": "PUBLIC",
  "ref": "https://api.smartrecruiters.com/v1/companies/Ubisoft2/postings/744000158084745",
  "language": { "code": "en", "label": "English", "labelNative": "English (US)" }
}
```

The detail adds `postingUrl`, `applyUrl` and `jobAd.sections.jobDescription.text` (`"<p>Beyond Good &amp; Evil 2 est un jeu…"`).

### 13c. Recruitee: WORKS

- `GET https://{company}.recruitee.com/api/offers/`
- Tested:
  - `bunq`: 20 offers.
  - `mollie` and `recruitee`: 404 `{"error":"Not found"}`-style.
- Envelope: `{ offers[] }`
- **Quirks:**
  - Each offer embeds `open_questions`, `translations` and `locations[]`, so payloads are heavy.
  - Timestamps are `"YYYY-MM-DD HH:MM:SS UTC"`. Replace the space with `T` and ` UTC` with `Z`.
  - `salary {min,max,period,currency}` is often all null.
  - `careers_url` may be a custom domain.

| normalized | field |
|---|---|
| externalId | `"recruitee:" + company + ":" + id` |
| title | `title` |
| company | `company_name` |
| location | `location` |
| remote | `remote` (also `hybrid`, `on_site`) |
| url | `careers_url` (apply: `careers_apply_url`) |
| description | `description + requirements` (HTML) |
| postedAt | `published_at` (normalized) |
| salary | `salary.min`, `salary.max`, `salary.currency` |
| tags | `[department, category_code, experience_code, employment_type_code, ...tags]` |

```json
{
  "id": 2797591, "guid": "vy6tk", "slug": "collections-expert", "title": "Collections Expert",
  "company_name": "bunq", "department": "Support & Operations",
  "location": "Amsterdam, Noord-Holland, Netherlands", "city": "Amsterdam", "country": "Netherlands", "country_code": "NL",
  "remote": false, "hybrid": true, "on_site": false,
  "careers_url": "https://careers.bunq.com/o/collections-expert",
  "careers_apply_url": "https://careers.bunq.com/o/collections-expert/c/new",
  "created_at": "2026-10-26 13:02:53 UTC", "published_at": "2026-10-26 13:13:39 UTC", "updated_at": "2026-10-27 09:49:57 UTC",
  "employment_type_code": "fulltime_permanent", "experience_code": "mid_level", "education_code": "bachelor_degree",
  "category_code": "banking", "tags": [],
  "description": "<p>Our users just got their bunq Credit Card and want to maintain their credit history…",
  "requirements": "<p>As our Collections Expert, you'll own credit card collections end to end…",
  "salary": { "max": null, "min": null, "period": null, "currency": null },
  "status": "published",
  "open_questions": "[…omitted]", "translations": "[…omitted]", "locations": "[…omitted]"
}
```

---

## 14. Other no-key feeds discovered

### 14a. Working Nomads: WORKS

- `GET https://www.workingnomads.com/api/exposed_jobs/` returns a flat array of about 39 recent jobs.
- No pagination and no id. The `url` is a redirect: `/job/go/{id}/`; extract the id from it.
- `tags` is a comma string.
- Mapping:
  - externalId = `"wn:" + url.match(/go\/(\d+)/)[1]`
  - title = `title`
  - company = `company_name`
  - location = `location`
  - remote = `true`
  - description = `description`
  - postedAt = `pub_date`
  - tags = `tags.split(",")` + `category_name`

```json
{ "url": "https://www.workingnomads.com/job/go/1960693/", "title": "Senior Angular Developer",
  "description": "<p><a href=\"https://lemon.io/for-developers/?utm_source=workingnomads…",
  "company_name": "Lemon.io", "category_name": "Development",
  "tags": "angular,typescript,javascript,php,dotnet",
  "location": "Europe, LATAM, APAC, the U.S., Canada", "pub_date": "2026-10-21T14:06:17-04:00" }
```

### 14b. 4dayweek.io: WORKS

- `GET https://4dayweek.io/api`, which redirects to `/api/v1`. Paginate with `?page=N`.
- Envelope: `{ usage, page, total (27,382), has_more, jobs[25] }`
- `usage` text: "link back to https://4dayweek.io". A v2 is documented at `4dayweek.io/developers`.
- **Quirks:**
  - The description is **Markdown**.
  - `posted` is epoch seconds.
  - There is no salary in v1.
  - A separate endpoint, `/api/jobs`, has `salary_lower`/`salary_upper` **in minor units** (for example `4500000` for £45k) and `salary_currency`, but `company_name` is blank and `locked: true` for some jobs.
- Mapping:
  - id = `id_str`
  - company = `company_name`
  - location = `location_original`
  - remote = `is_remote`
  - url = `url`
  - postedAt = `posted*1000`
  - tags = `[category, role, level, ...filters.map(f=>f.label)]`

```json
{ "id_str": "01a17319-26f9-7335-9520-39cd2a99eaad", "title": "Commercial Strategy Associate Director",
  "slug": "commercial-strategy-associate-director-at-vertex-pharmaceuticals-87964798",
  "url": "https://4dayweek.io/job/commercial-strategy-associate-director-at-vertex-pharmaceuticals-87964798",
  "description": "**Job Description**\n\n**General Summary:**\n\nThe main responsibility…",
  "category": "Marketing", "role": "Commercial Strategy", "level": "Executive", "hours": 40,
  "reduced_hours": "Generous PTO", "is_remote": true,
  "location_city": "Boston", "location_country": "United States", "location_continent": "North America",
  "location_original": "Remote in Boston (United States)", "posted": 1792932391,
  "filters": [{ "label": "Commercial Strategy", "value": "commercial-strategy" }, "…+12 more"],
  "company_id": "019d9651-0f45-79c1-8ac7-35c43a7f60a0", "company_name": "Vertex Pharmaceuticals",
  "company": { "name": "Vertex Pharmaceuticals", "slug": "vertex-pharmaceuticals", "remote_level": "Offers remote", "…": "…" } }
```

### 14c. Landing.jobs: WORKS

- `GET https://landing.jobs/api/v1/jobs?limit=50&offset=0` returns an array.
- EU/Portugal tech jobs. Has a salary but **no company name**. Parse it from the `url` `/at/{company-slug}/`.
- Mapping:
  - id = `id`
  - title = `title`
  - location = `locations.map(l=>l.city+", "+l.country_code)`
  - remote = `remote`
  - description = `role_description + main_requirements + nice_to_have`
  - postedAt = `published_at`
  - salary = `gross_salary_low`, `gross_salary_high`, `currency_code`
  - tags = `tags`

```json
{ "id": 19066, "currency_code": "EUR", "expires_at": "2027-03-02",
  "main_requirements": "<ul><li>6-8 years of experience in software development with Java.</li>…",
  "nice_to_have": "<ul><li>Experience with Cloud Native engineering.</li>…", "perks": "<ul>…",
  "relocation_paid": false, "role_description": "<div>Our client is a Global retail chain…",
  "title": "Senior Java Software Developer", "created_at": "2025-02-26T08:53:02.254Z",
  "updated_at": "2026-10-01T01:00:03.491Z", "published_at": "2025-02-26T09:38:38.127Z",
  "type": "Full-time", "remote": false, "gross_salary_low": 50000, "gross_salary_high": 67000,
  "tags": ["Spring Boot", "Java", "…+4 more"],
  "url": "https://landing.jobs/at/inscale/senior-java-software-developer-in-lisbon-2025",
  "locations": [{ "city": "Lisbon", "country_code": "PT" }] }
```

Note: it contains old listings (published 2025, still with a future `expires_at`). Filter on `expires_at`.

### 14d. SimplifyJobs GitHub listings (new grad and internships): WORKS

- New grad: `https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json` (about 2 MB, 19,051 rows, **2,946 active**).
- Interns: `https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json` (17,385 rows, 4,918 active).
- Updated continuously; the newest row was a few hours old.
- Filter `active && is_visible`. No description and no salary.
- Mapping:
  - id = `id`
  - company = `company_name`
  - location = `locations.join("; ")`
  - remote = `locations.some(l=>/remote/i.test(l))`
  - url = `url` (the direct ATS link)
  - postedAt = `date_posted*1000`
  - tags = `[category, sponsorship, ...degrees]`

```json
{ "source": "Simplify", "category": "Software", "company_name": "RTX", "id": "6e5c3139-4a80-4c65-9018-d5bd9e544a9e",
  "title": "Software Engineer 2", "active": true, "date_updated": 1793111426, "date_posted": 1793059200,
  "url": "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway/job/US-MA-MARLBOROUGH-…",
  "locations": ["Marlborough, MA"], "company_url": "https://simplify.jobs/c/RTX",
  "is_visible": true, "sponsorship": "Other", "degrees": ["Master's"] }
```

### 14e–14k. RSS feeds (all returned 200)

| Feed | URL | Items | Useful fields |
|---|---|---|---|
| Jobspresso | `https://jobspresso.co/?feed=job_feed` | 10 | `title`, `link`, `pubDate`, `content:encoded`, `job_listing:company`, `job_listing:location`, `job_listing:salary` (`"US$181k - US$292k"`), `job_listing:job_type`, `job_listing:job_category` |
| Larajobs (PHP/Laravel) | `https://larajobs.com/feed` | 5 | `job:company`, `job:location` (`Remote/USA`), `job:job_type`, `job:salary` (`$160,000.00 - $180,000.00`), `job:tags` (CSV); the description is empty |
| Python.org jobs | `https://www.python.org/jobs/feed/rss/` | 20 | `title` = `"Role, Company"`; the `description` starts with the location; there is no pubDate |
| WorkWithIndies (gamedev) | `https://workwithindies.com/careers/rss.xml` (linked from the homepage; `/rss.xml` is a 404) | 100 | `title` = `"{studio} is hiring a {role} to work from {region}"`; the description ends with `Tags: [Art & Animation] [Freelance]…`; pubDate is a date only |
| Remote Game Jobs (gamedev) | `https://remotegamejobs.com/feed.rss` | 34 | `title` = `"{studio} is hiring {role} (Remote Job)"`, `link`, `pubDate`, `description` (plain text) |
| Himalayas RSS | `https://himalayas.app/jobs/rss` | 20 | `himalayasJobs:companyName`, `:locationRestriction`, and so on; prefer the JSON API |
| Jobicy RSS | `https://jobicy.com/feed/job_feed` | many | prefer the JSON API |

Example (Jobspresso):

```xml
<item>
  <title>Principal Software Engineer, Docker Hardened Images</title>
  <link>https://jobspresso.co/job/principal-software-engineer-docker-hardened-images/</link>
  <dc:creator><![CDATA[Docker<br>⚲&nbsp;United States, Canada]]></dc:creator>
  <pubDate>Tue, 27 Oct 2026 12:22:04 +0000</pubDate>
  <guid isPermaLink="false">https://jobspresso.co/?post_type=job_listing&#038;p=164458</guid>
  <description><![CDATA[About Docker Docker has been one of the most loved brands in developer tooling…]]></description>
  <content:encoded><![CDATA[<p …><strong>About Docker</strong></p> …]]></content:encoded>
  <job_listing:location><![CDATA[United States, Canada]]></job_listing:location>
  <job_listing:job_type><![CDATA[Engineer]]></job_listing:job_type>
  <job_listing:job_category><![CDATA[Full Time]]></job_listing:job_category>
  <job_listing:company><![CDATA[Docker]]></job_listing:company>
  <job_listing:salary><![CDATA[US$181k - US$292k]]></job_listing:salary>
</item>
```

Example (WorkWithIndies):

```xml
<item><title>lightconstruct is hiring a 3D Environment Artist to work from CET ± 3 hours</title>
<link>https://www.workwithindies.com/careers/lightconstruct-3d-environment-artist</link>
<guid>https://www.workwithindies.com/careers/lightconstruct-3d-environment-artist</guid>
<description>We&#39;re looking for a 3D environment artist … Tags: [Art &amp; Animation] [Fre…</description>
<pubDate>Sat, 24 Oct 2026 00:00:00 GMT</pubDate>
<media:content url="https://cdn.prod.website-files.com/…webp" medium="image"/></item>
```

### 14l. Workday CXS (unofficial, no key): WORKS

Many large companies, including CrowdStrike, NVIDIA, Palo Alto Networks, Salesforce, Intel and Adobe, use Workday. That covers big security vendors that are not on Greenhouse.

- **Search:** `POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`
  - Headers: `Content-Type: application/json`
  - Body: `{"appliedFacets":{},"limit":20,"offset":0,"searchText":"security"}`. `limit` is at most 20.
- **Detail:** `GET https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{externalPath}`
- Tested:
  - `crowdstrike.wd5…/crowdstrike/crowdstrikecareers`: 380 matches for "security".
  - `nvidia.wd5…/nvidia/NVIDIAExternalCareerSite`: works.
- **Quirks:**
  - This is an undocumented internal API, so it may change.
  - The list `postedOn` is relative text ("Posted 4 Days Ago"). The detail has `startDate` (`"2026-10-23"`), `jobDescription` (HTML), `externalUrl`, `timeType`, `jobReqId` and `country`.
  - The tenant, `wdN` and site name come from the company's careers URL.
- List item: `{ "title": "Sr Software Engineer, Cloud - Fusion (Hybrid, Sunnyvale)", "externalPath": "/job/USA---Sunnyvale-CA/Sr-Software-Engineer--Cloud---Fusion--Hybrid--Sunnyvale-_R30384", "locationsText": "USA - Sunnyvale, CA", "postedOn": "Posted 4 Days Ago", "bulletFields": ["R30384"] }`
- Mapping:
  - id = `jobReqId`
  - location = `location`
  - remote = `/remote/i` on the location or title
  - url = `externalUrl`
  - postedAt = `startDate`
  - tags = `[timeType]`

### Not usable (checked)

- **infosec-jobs.com, ai-jobs.net:** both redirect to `foorilla.com/hiring/`. Foorilla's API (`foorilla.com/api/`) is PRO+ (paid).
  - For security jobs, use Jobicy `industry=cybersecurity` (or `tag=security`), Himalayas search `q=security`, and the security-company ATS boards in section 15.
- **Remote.co** developer feed: connection reset.
- **Authentic Jobs** feed: blog posts only.
- **RemoteOK RSS:** 410 Gone.
- **Hitmarker** `/jobs/feed` and `/api/jobs`: 404.
- **golang.cafe/rss:** 404.
- **devitjobs.uk/job_feed.xml:** redirects to a signup page.
- **Reddit JSON:** 403 (see section 12).
- **Remotive RSS** `/remote-jobs/feed/software-dev`: 404.
- **Needs key (not tested further):** Adzuna, Jooble, USAJobs, Careerjet, Findwork.dev, web3.career, Foorilla.

---

## 15. Confirmed ATS board tokens (live on 2026-10-27, job count at test time)

All of the following returned 200 with **at least 1 job**. Unless a note says otherwise, the company name returned by Greenhouse (`company_name`) or the Ashby descriptions matched the intended company.

Endpoints:

- GH: `boards-api.greenhouse.io/v1/boards/{token}/jobs`
- Lever: `api.lever.co/v0/postings/{token}?mode=json`
- Ashby: `api.ashbyhq.com/posting-api/job-board/{token}`

### AI labs / AI infrastructure

| Company | ATS | Token | Jobs |
|---|---|---|---|
| Anthropic | Greenhouse | `anthropic` | 679 |
| OpenAI | Ashby | `openai` | 797 |
| xAI | Greenhouse | `xai` | 308 (`company_name` now reads "SpaceXSI") |
| Scale AI | Greenhouse | `scaleai` | 167 |
| Together AI | Greenhouse | `togetherai` | 85 |
| Databricks | Greenhouse | `databricks` | 895 |
| Cohere | Ashby | `cohere` | 116 |
| Perplexity | Ashby | `perplexity` | 132 |
| ElevenLabs | Ashby | `elevenlabs` | 151 |
| Harvey | Ashby | `harvey` | 364 |
| LangChain | Ashby | `langchain` | 104 |
| Cognition | Ashby | `cognition` | 105 |
| Sierra | Ashby | `sierra` | 210 |
| Decagon | Ashby | `decagon` | 133 |
| Writer | Ashby | `writer` | 46 |
| Cerebras | Ashby | `cerebras` | 119 |
| Crusoe | Ashby | `crusoe` | 349 |
| Lambda | Ashby | `lambda` | 99 |
| Baseten | Ashby | `baseten` | 109 |
| Modal | Ashby | `modal` | 43 |
| Pinecone | Ashby | `pinecone` | 8 |
| Anyscale | Ashby | `anyscale` | 21 |
| Character.AI | Ashby | `character` | 13 |
| Cursor | Ashby | `cursor` | 123 (descriptions currently open with SpaceX boilerplate, so verify) |

### Dev tools / infrastructure

| Company | ATS | Token | Jobs |
|---|---|---|---|
| Stripe | Greenhouse | `stripe` | 711 |
| Cloudflare | Greenhouse | `cloudflare` | 462 |
| Datadog | Greenhouse | `datadog` | 430 |
| GitLab | Greenhouse | `gitlab` | 236 |
| MongoDB | Greenhouse | `mongodb` | 364 |
| Elastic | Greenhouse | `elastic` | 403 |
| Grafana Labs | Greenhouse | `grafanalabs` | 133 |
| Vercel | Greenhouse | `vercel` | 93 |
| Canonical | Greenhouse | `canonical` | 314 |
| Fivetran | Greenhouse | `fivetran` | 172 |
| Twilio | Greenhouse | `twilio` | 135 |
| Cockroach Labs | Greenhouse | `cockroachlabs` | 15 |
| Figma | Greenhouse | `figma` | 140 |
| Discord | Greenhouse | `discord` | 46 |
| Asana | Greenhouse | `asana` | 114 |
| Notion | Ashby | `notion` | 139 |
| Linear | Ashby | `linear` | 32 |
| Docker | Ashby | `docker` | 52 |
| Sentry | Ashby | `sentry` | 42 |
| Replit | Ashby | `replit` | 36 |
| Supabase | Ashby | `supabase` | 64 |
| PostHog | Ashby | `posthog` | 11 |
| Hex | Ashby | `hex` | 38 |
| Kong | Ashby | `kong` | 101 |
| Resend | Ashby | `resend` | 14 |
| Zapier | Ashby | `zapier` | 12 |
| Spotify | Lever | `spotify` | 89 |
| Palantir | Lever | `palantir` | about 300 (6 MB, so page with `limit`) |
| Sysdig | Lever | `sysdig` | 31 |
| Outreach | Lever | `outreach` | 21 |
| Toptal | Lever | `toptal` | 28 |
| Contentsquare | Lever | `contentsquare` | 17 |
| Pigment | Lever | `pigment` | 131 |

### Security

| Company | ATS | Token | Jobs |
|---|---|---|---|
| Okta | Greenhouse | `okta` | 391 |
| Zscaler | Greenhouse | `zscaler` | 358 |
| Wiz | Greenhouse | `wizinc` | 123 |
| Chainguard | Greenhouse | `chainguard` | 96 |
| Abnormal Security | Greenhouse | `abnormalsecurity` | 85 |
| Tailscale | Greenhouse | `tailscale` | 53 |
| Coalition | Greenhouse | `coalition` | 51 |
| Recorded Future | Greenhouse | `recordedfuture` | 48 |
| Island | Greenhouse | `island` | 36 |
| Tines | Greenhouse | `tines` | 36 |
| Huntress | Greenhouse | `huntress` | 30 |
| Torq | Greenhouse | `torq` | 21 |
| Axonius | Greenhouse | `axonius` | 20 |
| Bugcrowd | Greenhouse | `bugcrowd` | 9 |
| Expel | Greenhouse | `expel` | 8 |
| Orca Security | Greenhouse | `orcasecurity` | 8 |
| 1Password | Ashby | `1password` | 87 |
| Vanta | Ashby | `vanta` | 83 |
| Snyk | Ashby | `snyk` | 35 |
| Drata | Ashby | `drata` | 33 |
| Socket | Ashby | `socket` | 27 |
| Teleport | Ashby | `goteleport` | 23 |
| Semgrep | Ashby | `semgrep` | 13 |
| Persona | Ashby | `persona` | 13 |
| HackerOne | Ashby | `hackerone` | 10 |
| Material Security | Ashby | `materialsecurity` | 4 |
| CrowdStrike | Workday | `crowdstrike.wd5 / crowdstrikecareers` | 380 matching "security" |

### Game studios

| Company | ATS | Token | Jobs |
|---|---|---|---|
| PlayStation (SIE) | Greenhouse | `sonyinteractiveentertainmentglobal` | 198 |
| Roblox | Greenhouse | `roblox` | 268 |
| Riot Games | Greenhouse | `riotgames` | 184 |
| Scopely | Greenhouse | `scopely` | 182 |
| Epic Games | Greenhouse | `epicgames` | 148 |
| KRAFTON | Greenhouse | `krafton` | 57 |
| Insomniac Games | Greenhouse | `insomniac` | 26 |
| Naughty Dog | Greenhouse | `naughtydog` | 17 |
| Bungie | Greenhouse | `bungie` | 5 |
| Gearbox | Greenhouse | `gearbox` | 1 |
| Supercell | Ashby | `supercell` | 38 |
| thatgamecompany | Ashby | `thatgamecompany` | 38 |
| Voodoo | Ashby | `voodoo` | 106 |
| Moon Active | Ashby | `moonactive` | 33 |
| Kabam | Lever | `kabam` | 23 |
| Ubisoft | SmartRecruiters | `Ubisoft2` | 326 |

### Fintech / crypto

| Company | ATS | Token | Jobs |
|---|---|---|---|
| Coinbase | Greenhouse | `coinbase` | 225 |
| Robinhood | Greenhouse | `robinhood` | 155 |
| Brex | Greenhouse | `brex` | 265 |
| Affirm | Greenhouse | `affirm` | 241 |
| Binance | Greenhouse | `binance` | 252 (also Lever `binance` with 6) |
| Mercury | Greenhouse | `mercury` | 76 |
| Chime | Greenhouse | `chime` | 75 |
| Carta | Greenhouse | `carta` | 72 |
| Checkr | Greenhouse | `checkr` | 47 |
| Gemini | Greenhouse | `gemini` | 30 |
| Ramp | Ashby | `ramp` | 173 |
| Plaid | Ashby | `plaid` | 130 |
| Alan | Ashby | `alan` | 126 |
| Voleon | Ashby | `voleon` | 60 |
| Qonto | Ashby | `qonto` | 42 |
| Wealthsimple | Ashby | `wealthsimple` | 39 |
| Ledger | Ashby | `ledger` | 13 |
| Anchorage Digital | Lever | `anchorage` | 23 |
| Wealthfront | Lever | `wealthfront` | 22 |
| Nium | Lever | `nium` | 19 |
| Tala | Lever | `tala` | 9 |
| bunq | Recruitee | `bunq` | 20 |

### Other notable tech

| Company | ATS | Token | Jobs |
|---|---|---|---|
| Airbnb | Greenhouse | `airbnb` | 191 |
| Reddit | Greenhouse | `reddit` | 161 |
| Pinterest | Greenhouse | `pinterest` | 158 |
| Lyft | Greenhouse | `lyft` | 179 |
| Instacart | Greenhouse | `instacart` | 100 |
| Samsara | Greenhouse | `samsara` | 321 |
| Lucid Motors | Greenhouse | `lucidmotors` | 447 |
| Nuro | Greenhouse | `nuro` | 97 |
| Gusto | Greenhouse | `gusto` | 97 |
| Duolingo | Greenhouse | `duolingo` | 59 |
| Dropbox | Greenhouse | `dropbox` | 22 |
| Attentive | Greenhouse | `attentive` | 29 |
| Dataiku | Greenhouse | `dataiku` | 12 |
| Zoox | Lever | `zoox` | 232 |
| Match Group | Lever | `matchgroup` | 63 |
| Ro | Lever | `ro` | 50 |
| Shield AI | Ashby | `shieldai` | 689 |
| Skydio | Ashby | `skydio` | 175 |
| WHOOP | Ashby | `whoop` | 135 |
| Jobber | Ashby | `jobber` | 42 |
| Back Market | Ashby | `backmarket` | 34 |
| Hugging Face | Workable | `huggingface` | 6 |

### Tokens that did NOT work (don't use)

- **Greenhouse/Lever/Ashby 404 or empty:**
  - 404 on all three: deepmind, sourcegraph, temporaltechnologies, marqeta, arcticwolf, dbtlabsinc, gravitational, retool, anduril, rapid7, sentinelone, tenable, unity, unity3d, rovio, nexon, mojang, respawn, 343industries, zynga, playtika, ccpgames, paradoxinteractive, trailofbits, netspi, redcanary, aquasec, panther, cloudsmith, jupiterone, sublimesecurity, cyera, chainalysis, aurora, rivian, appliedintuition, eventbrite, lime, glean, jasper, fireworksai, runwayml, wandb, weightsandbiases, anysphere, perplexity-ai.
  - Empty (200, 0 jobs): Lever `mistral`, `kraken`, `highspot`, `jagex`; Ashby `deel`, `niantic`.
- **Wrong company behind the token:**
  - GH `remedy` is a pharmacy, not Remedy Entertainment.
  - GH `bethesda` is Bethesda Physical Therapy.
  - GH `figure` is Figure Lending.
  - GH `remote` is General Assembly.
- **Moved:** Lever `plaid` now returns 404; Plaid is on Ashby.

---

## 16. Practical notes for the connectors

- **Identity:** prefix `externalId` with the source and board, as in the mappings above, so that dedupe across sources stays stable. Also dedupe cross-source by `normalize(company)+normalize(title)`. Himalayas, Jobicy, WWR and others often re-list the same ATS jobs.
- **HTML entity decoding:**
  - Greenhouse `content` needs a decode step.
  - WWR and Reddit RSS descriptions are escaped inside XML, so the XML parser unescapes once and the result is HTML.
  - HN text uses `&#x2F;` and similar entities.
- **Epoch units:**
  - Lever `createdAt`: ms.
  - RemoteOK `epoch`, Arbeitnow `created_at`, Himalayas `pubDate`, 4dayweek `posted`, HN `time`, Simplify `date_posted`: seconds.
- **Salary:**
  - Structured: Ashby, Greenhouse (with `pay_transparency=true`), Himalayas, Jobicy (some jobs), RemoteOK (0 means unknown), Landing.jobs, 4dayweek `/api/jobs` (minor units).
  - Free text: Remotive, Jobspresso, Larajobs, HN.
- **Timeouts:** Lever was slow from this network, so use 60–90 s timeouts or `limit`/`skip`. Everything else answered in under 5 s.
- **Attribution required:** RemoteOK (dofollow backlink), Remotive (backlink plus name; max 4 polls/day), Himalayas (visible source link; unchanged apply link), Jobicy (credit plus link), Arbeitnow (link appreciated), 4dayweek (link back). Store `sourceName` and `sourceUrl` on every job and render "via X".
