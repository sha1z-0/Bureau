# A04: Writer (aligns the candidate to every job, truthfully, in a human voice)

**You own:** `server/writer/**`. You replace `server/ai/tailor.ts` (keep its exported schemas compatible or migrate the callers) and `TAILOR_RULES` / `FACT_AUDITOR` in `server/ai/prompts.ts`. You also own `server/services/cvPdf.ts`.
**Mission:** for each selected job, produce the application a hiring manager finds hard to turn down: specific, evidence-led, in the candidate's own voice, aligned to the role as far as the truth allows, and showing no signs of AI writing.

## The alignment doctrine (this is the owner's strategy; implement it exactly)
Postings over-ask. Bureau applies anyway and makes the strongest *true* case. For every requirement, the evidence map picks one framing:
- **direct:** the candidate has it. Mirror the posting's exact vocabulary and lead with it.
- **transferable:** the closest real experience, named in the job's terms ("Deployed on GCP and a VPS with Docker; the same container and IaC patterns your AWS stack uses"). Never rename one tool as another.
- **learning:** the skill is on the learning list. It may appear under *Currently learning* and in the letter as active learning with something concrete ("building X in it now").
- **omit:** the candidate has nothing honest to say. Leave it out of the CV. The letter may address the single biggest gap head-on as a fast-learning story, backed by a real example of learning something fast.
Never: invent employers, titles, dates, metrics, degrees, certifications, years of experience, or skills; list a gap skill as a skill; inflate scope ("led" when the CV says "contributed"). The truth lock enforces this. A failed lock means rewrite once, then skip and log.

## Pipeline (`writeApplication(jobId, campaignId)`)
1. **Decode** (task `evidence`): the posting's real priorities (what the team needs, beyond the bullet list), tone, seniority, and the top 3 must-wins.
2. **Research:** `researchCompany()` from A03. Pick 1–2 concrete, recent, verifiable hooks (a product launch, an engineering post, a mission line).
3. **Evidence map:** requirement → best true evidence (a fact id from `profile_facts`) → framing → phrasing in the job's vocabulary.
4. **CV** (task `write_cv`): ATS-safe, single column, standard headings, reverse-chronological, 1 page under ~6 years of experience. Summary written to this job. Skills grouped and ordered by the job's priorities, containing only skills the candidate has. *Currently learning* from the learning list only. Projects chosen and ordered by relevance. Bullets lead with impact using the CV's own numbers. Rewrite the PDF renderer if needed so it's crisp, selectable text with standard fonts that parse cleanly in ATS (test with a PDF-to-text round trip).
5. **Letters** (task `write_letter`), **three variants**, each a different strategy: (a) a company hook first (from research), (b) proof first (the most relevant result), (c) a short story from the voice bank. 180–280 words.
   - **Build from the candidate's own words.** Each variant must adapt at least two voice-bank passages, keeping their rhythm, idioms and sentence shapes, and editing them to fit the job. Research basis: AI-generated text has a consistent stylometric footprint (mainly entropy and lexical diversity) across models, and prompting a model to "sound human" doesn't remove those markers. AI-*edited* human text, by contrast, is hard to tell from human writing (arXiv 2608.27855 "AI Writers Have a Consistent Stylometric Footprint, but AI Editors Do Not"; arXiv 2604.14111 on Biber-feature variation across 11 LLMs; arXiv 2507.00838 on stylometry in short samples). Read these papers and fold any further concrete markers into the lint. So edit the human's writing; don't generate from nothing.
6. **Critic** (task `critic`, an Opus "skeptical senior hiring manager" persona): scores each variant 1–10 on specificity to this company, evidence strength, voice match to the style fingerprint, clarity, the ask, and any AI tells. It returns the edits it would demand. Apply them once, re-score, and choose the best. **If the best is under 8, skip the job and log why.**
7. **Humanizer pass** (task `humanize`): vendor a rule set based on Wikipedia's "Signs of AI writing" taxonomy (paraphrase the rules into our own file with attribution; check licences before copying any third-party skill text such as blader/humanizer (MIT) or stop-slop). The rules cover significance inflation, promotional tone, vague attribution, AI vocabulary ("delve", "testament", "tapestry", "pivotal", "landscape", "leverage", "seamless", "robust", "elevate", "foster", "navigate the complexities"), the rule of three, negative parallelisms ("not just X, but Y"), em-dash overuse, formulaic openers and closers, title-case headings, excessive hedging and sycophancy. Rewrite only the offending spans.
8. **Stylometric lint** (code, `writer/lint.ts`), each check a pass/fail with a measured value:
   - sentence-length standard deviation ≥ the candidate's fingerprint spread × 0.8 (burstiness)
   - type-token ratio within ±15% of the candidate's fingerprint
   - 0 banned phrases, ≤ 1 em dash, no rule-of-three lists, no "I am writing to", no "I am excited/thrilled to apply", no "passionate", no closing summary sentence that restates the letter
   - contraction rate within ±50% of the fingerprint
   - first sentence names something specific to the company or role
   Failing lint means one targeted rewrite of the failing spans, then re-lint. If it still fails, skip the job.
9. **Truth lock** (task `audit` plus a code check, extending the existing `codeAudit`): every figure and employer must be in the source; every listed skill must be in profile facts or the learning list; every transferable claim must name real evidence; "Currently learning" items must be in the learning list. High-severity issue → rewrite once → re-audit → skip if still failing.
10. **Subject lines:** generate 5 (under 70 characters, specific: role + concrete hook, no clickbait, no all-caps, no emojis). The critic picks the best.
11. **Form short-answers:** for common long-form questions ("Why us?", "Tell us about a project", "Why this role?"), pre-write answers from the same evidence map and voice. The form engine asks `answerQuestion(jobId, question)` for anything else, and it goes through the same lint and truth lock in a shorter form.
12. **Outreach note** (400–600 characters) and a **follow-up email** draft (used by A09 after N days).
13. Persist `ApplicationPacket` plus `letter_variants` (critic scores, lint results, style tags). Render the PDFs.
14. **Learning from outcomes (`writer/bandit.ts`):** Thompson sampling over the variant strategies (hook / proof / story) and lengths, using `outcomes` (A09 fills it). Bias the chosen variant toward strategies that earn replies, while keeping 20% exploration.

## Quality report
`npm run writer:report` prints the last N applications with their critic, lint and truth results, so the lead can inspect quality in Phase 3.

## Tests
- Lint unit tests for every rule.
- Truth lock catches an invented metric, an invented skill, a gap skill listed as a skill, and an inflated title.
- The full pipeline on a recorded fixture job produces a packet that passes all gates.

## Acceptance
- [ ] Every sent letter has critic ≥ 8, a lint pass and a clean truth lock (enforced in code)
- [ ] Voice-bank adaptation is verifiable (each variant stores which passages it used)
- [ ] The CV PDF round-trips through text extraction with every section intact
- [ ] The bandit updates from outcomes
