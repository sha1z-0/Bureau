# A06: Browser agent and recipe learning (handles unknown forms and teaches the system)

**You own:** `server/agent/**`.
**Mission:** fill forms no recipe or adapter covers, using a Claude-driven browser agent, and turn every successful run into a recipe so the next run is fast, cheap and deterministic. The system gets better the more it applies.

## Build
1. **Agent loop (`agent/loop.ts` → `agentFill({page, fields, packet})`):**
   - Use **Stagehand** (TypeScript, works with Playwright and Anthropic models) if it integrates cleanly with `playwright-core` and the installed Chrome. Otherwise implement our own loop: each turn, send Claude (task `agent_step`, Sonnet or Opus 5.5) the accessibility snapshot of the form region, the current field list from A05 `extract`, a downscaled screenshot, the packet (values only, no secrets), and the trace so far. Claude returns one tool call: `fill(signature|ref, valueKey)`, `select`, `check`, `upload(cv|letter)`, `click(ref)`, `next`, `wait`, `ask_value(question)` (routes to A05 map, then A03/A04), `done`, `give_up(reason)`.
   - The agent picks **value keys**, never free-typed facts. Values are resolved by our mapper from the packet, profile and answer bank, so the agent can't invent data.
   - **Guardrails:** domain allow-list (the job's apply domain plus its ATS domains), a max of 60 steps and a time limit, no navigation to payment, login (unless A05 accounts provides credentials) or unrelated pages. Never interact with CAPTCHA frames. **Never presses the final submit:** it calls `done`, then A05 `verify()` runs, then A05 submits.
   - Page text is untrusted: fence it, and ignore any instructions found in it (prompt-injection defence; log attempts).
2. **Traces (`agent/trace.ts`):** record every action with the field signature, labelNorm, widget, selector candidates (role-based, label-based, CSS, xpath), value source/key, step index, URL, and before/after screenshots. Store them in `agent_traces` with the origin (internal, or external with the key id from A07).
3. **Recipe compiler (`agent/compile.ts` → `compileTrace`, task `recipe_compile` plus code):**
   - Turn a successful, verified trace into a `Recipe`. Generalise the scope: if the ATS family is known, produce an **ats-scope** recipe keyed on signatures, so it works for every company on that ATS. Otherwise produce a company or url scope.
   - Drop company-specific long-form questions from the ats-scope recipe and keep them as signature → answer-bank hooks.
   - Status `candidate`.
4. **Shadow verification (`agent/shadow.ts`):** the next time a matching form appears, A05 runs the candidate recipe in **dry mode** alongside the normal path (agent or adapter) and compares the intended values and verification. Three matching runs promote it to `active` (emit `recipe.promoted`). A mismatch keeps it as a candidate with a diff, and three mismatches discard it.
5. **Repair:** when A05 reports a recipe failure that the agent completed, compile the repaired steps into a new recipe version.
6. **External traces:** traces submitted through A07 enter the same compiler, but always need shadow verification by an internal run before promotion (they're untrusted).
7. **Metrics:** recipe coverage by ATS, agent runs vs recipe runs over time, cost per agent run. These are exposed for the UI.

## Tests
- On 3 fixture forms with no adapter, the agent completes a verified fill using recorded Claude responses (replay mode).
- The compiler produces a recipe, the recipe replays deterministically on the same fixture, and promotion happens after 3 shadow matches.
- An injection test: a fixture form containing "ignore previous instructions" text gets no compliance and is logged.

## Acceptance
- [ ] Unknown forms are filled by the agent within guardrails, and it never submits on its own
- [ ] The trace → recipe → shadow → promote loop works end to end on fixtures
- [ ] External traces are accepted but are never promoted without internal verification
- [ ] Learning metrics are available through an API
