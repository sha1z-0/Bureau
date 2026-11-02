# A03: Profile sync, voice bank, answer bank and company research

**You own:** `server/profile/**`, `server/research/**`. You refactor `server/services/profileStore.ts` and `server/ai/profile.ts`.
**Mission:** a living master profile that updates itself daily and is the only source of truth for the writer and forms, plus a research brief on every target company.

## Build
### Master profile (`profile/`)
- `MasterProfile` = the existing extracted profile plus `profile_facts` (every fact with its source), the voice bank, the answer bank, the learning list and links.
- **Daily sync** (`syncProfile`, called by the campaign scheduler at 06:00 local time and on demand):
  - **CV:** if a new CV was uploaded, re-extract it and diff it against the existing facts. New facts are added and removed ones deactivated, never silently overwritten.
  - **GitHub** (public API, optional token from the vault): repos, descriptions, READMEs, languages, topics, stars, recent commit activity. Turn notable repos into project facts with links. Only the candidate's own repos, and forks only if they made meaningful commits.
  - **Portfolio site:** crawl the owner's site (same origin, ≤ 30 pages, through `safeFetch`) and extract projects and claims as facts with source URLs.
  - **LinkedIn:** support importing the official LinkedIn data export (zip/CSV) and pasted profile text. Never scrape LinkedIn while logged in.
  - Every fact is extracted **verbatim or near-verbatim**, never embellished. Claude task `profile_sync`.
- **Voice bank:** an API to add, edit and list passages. Ship 8 suggested prompts (why you build; proudest project, told as a story; a hard bug you cracked; something you learned fast; a team you loved working in; what you're learning now; why this field; a failure and what changed). Compute and store the candidate's **style fingerprint** from these passages: mean and spread of sentence length, type-token ratio, contraction rate, favourite connectives, first-person rate. A04 uses it.
- **Answer bank:** CRUD plus `answerFor(question, job)`. Normalise the question (lowercase, strip punctuation, synonyms such as "notice period" ≈ "when can you start"), match exactly or fuzzily (embeddings) to a stored answer, respecting scope (country, job type). Seed it with the existing preference fields (work authorisation, notice period, salary, sponsorship, relocation) and 25 common questions for the owner to fill: years of experience per core skill, willingness for onsite/hybrid, timezone overlap, degree completion date, portfolio link, GitHub, how did you hear, earliest start date, expected salary by currency/region, and so on.
- **Unknown questions:** `recordUnknown(question, job, field)` stores it in `unknown_questions`. When the owner answers it (UI or Telegram), it's saved to the answer bank and the job is re-queued (emit an event; A08 re-queues).
- **Learning list:** CRUD. The writer may only list skills from it under *Currently learning*.

### Company research (`research/`)
- `researchCompany(company, domain?)` uses Claude web search (the existing `research()` helper) plus a fetch of the company's own site: what they build, product names, recent news and launches (last 6 months), engineering blog or tech-stack signals, values or mission language, team size and stage, and the hiring manager or team lead when publicly named in the posting or the company's own pages. Output a structured `ResearchBrief` with a source URL on every claim. Cache it in `research_briefs` for 14 days.
- Strictly public business information. No personal social-media digging on individuals beyond what they publish professionally about the role.

## Tests
- A sync diff test: a new CV adds facts and removed bullets deactivate.
- Answer bank fuzzy-match tests (20 question paraphrases).
- Research parser on a recorded response.

## Acceptance
- [ ] The profile refreshes daily without overwriting the owner's manual facts
- [ ] Every fact shows its source in the UI data
- [ ] Unknown question → owner answers → bank → job re-queued, working end to end
- [ ] The style fingerprint is computed and exposed to A04
