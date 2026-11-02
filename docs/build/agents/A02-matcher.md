# A02: Matcher (picks the jobs worth applying to, stretch roles included)

**You own:** `server/match/**`. You refactor `server/ai/score.ts` and the scoring prompts in `server/ai/prompts.ts` (`SCORING_RUBRIC`).
**Mission:** score each job on **how likely the candidate is to pass the screen**, so Bureau applies to strong stretch roles and skips hopeless ones and true blockers.

## Build
1. **Hard filters (code, free):** campaign locations and remote policy, visa/sponsorship needs against the posting, salary floor (when the posting states pay), excluded companies and keywords, **company cooldown** (no second application to the same company within N days, across all campaigns), legitimacy below threshold, and the ghost flag from the scout.
2. **Similarity pre-rank:** cosine between the job embedding and a profile embedding (core stack, target roles, top projects). Combine it with the existing `prefilterScore` to decide which jobs reach Claude each cycle (`assessPerCycle`, with fresh jobs first).
3. **Claude assessment (Haiku 5.5, batched, prompt-cached rubric and profile).** Rewrite the rubric around the owner's strategy:
   - Pass 1 (posting only): requirements, each with importance critical / important / nice, evidence stated / inferred, and `blocker:true` only for legally or practically hard gates: licence, clearance, citizenship, a mandated degree, or years of experience more than roughly 2× the candidate's for a non-entry role. Recognise inflated entry-level postings ("entry level, 5 years required") and say so.
   - Pass 2 (against the profile): met / partial / missing with proof. **Transferable evidence counts as partial.** Skills in the learning list count as partial with the proof "currently learning".
   - Output the `MatchResult` contract.
4. **Scoring (code, deterministic):** `screenPassScore` from weighted requirements (critical .5, important .35, nice .15 of the requirement mass), dimensions and pre-rank, then:
   - Any blocker → cap at 35.
   - `stretchLevel`: conservative allows ≤1 missing important, balanced ≤3, aggressive ≤5. Beyond that, a stepped penalty.
   - Freshness boost (<48h) +5, hiring-signal boost +3.
   - Keep it repeatable: same inputs, same score.
5. **Selection:** `selectForCampaign(cfg)` returns the ordered queue for the campaign's available slots, diversified (at most 2 from the same company per week, and spread across categories).
6. Persist to `jobs.ai_*` (keep the existing columns working for the UI) and move the pipeline to `scored` or `selected` / `skipped` with a reason.

## Tests
- Scoring unit tests: a blocker caps, stretch levels behave as specified, determinism.
- Three recorded assessments (fixtures) covering an inflated entry-level post, a true clearance blocker and a strong match.

## Acceptance
- [ ] The score's meaning is documented in code and in the UI tooltip text: "chance of passing the screen"
- [ ] Stretch levels are configurable per campaign and covered by tests
- [ ] Company cooldown is enforced across campaigns
- [ ] Cost per assessed job is within the existing estimate (cache hits verified)
