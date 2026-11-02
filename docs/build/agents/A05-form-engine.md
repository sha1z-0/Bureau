# A05: Form engine (fills any application form, verifies, submits)

**You own:** `server/forms/**`. You replace `server/services/formFiller.ts` (keep a thin re-export for old callers until A08 switches over) and `server/services/browser.ts`.
**Mission:** given an `ApplicationPacket`, fill the employer's form correctly every time, prove it's correct, and submit. Known forms run from fast deterministic recipes. Unknown forms hand off to the browser agent (A06), and what the agent learns comes back as recipes.

## Architecture
```
fillApplication(packet, opts)
  → open (guarded context, realistic viewport, the owner's timezone and locale, human-like typing delays)
  → detect(page)            // ATS family + version from URL + DOM fingerprint
  → findForm(page)          // follow Apply hops (keep the existing logic), handle new tabs and iframes
  → recipe = recipes.match(ats, company, url)
  → if recipe: runRecipe(recipe)  else if adapter: adapter.fill()  else: agentFill() (A06)
  → per step: extract → map → fill → next (multi-step)
  → verify()                // read back every field, check required fields, file uploads, no validation errors
  → challenge? → needs_you (never solve)
  → submit (if opts.submit) → confirm()  (confirmation page/URL/text, or a confirmation email via A09)
  → record outcome, screenshots per step, the field log; on recipe failure → self-heal or demote
```

## Build
1. **Extract (`forms/extract.ts`):** start from the existing `EXTRACT_FIELDS` and harden it. Pierce **shadow DOM**, walk **same-origin iframes** (Greenhouse embeds) and record cross-origin frames. Handle custom comboboxes (react-select, MUI, Headless UI, Workday prompts), date pickers, location typeaheads, phone inputs with country pickers, rich-text editors, repeating sections ("Add another" for education and experience), consent blocks, and EEO sections. Every field gets `labelNorm` and a stable **signature**: a hash of the normalised label, widget kind, option set and section. Signatures, not raw selectors, are the contract between runs.
2. **Map (`forms/map.ts`):** deterministic first, through a synonyms dictionary of 300+ label variants mapped to profile and answer-bank keys (first name, last name, preferred name, email, phone, LinkedIn, GitHub, portfolio, location, city, country, address, current company, current title, years of experience, salary, notice, start date, sponsorship, authorisation, relocation, referral, how did you hear, pronouns (optional, decline by default), EEO → decline options). Then the answer bank (A03 `answerFor`). Then the writer (A04 `answerQuestion`) for long-form questions. Each value carries `source` and `confidence`. **Required field with confidence < 0.7 → `recordUnknown` → outcome `skipped` with reason `unknown_question`** (or `needs_you` if the campaign says so). Never guess legal attestations.
3. **Handlers (`forms/handlers/*.ts`), one per widget:** text, textarea, native select, custom select / combobox (open, type, wait, pick the best-matching option, confirm the chip), radio, checkbox, date (typed, picker, or segmented), file upload (input[type=file], drag zones, "upload from device" flows), phone with country code, location typeahead, rich text, repeating groups. Every handler has to **read back** what it wrote.
4. **ATS adapters (`forms/adapters/`):** Greenhouse (classic and the new job-boards), Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio, Teamtailor, BambooHR, Breezy, **Workday** (account creation or sign-in, the multi-step wizard: My Information → My Experience with resume parse correction → Application Questions → Voluntary Disclosures → Self Identify → Review), and iCIMS / Taleo / SuccessFactors as best effort. An adapter encodes the ATS's flow, quirks and confirmation signals, and emits a recipe on its first success.
5. **Recipes (`forms/recipes.ts`):** CRUD on `form_recipes`. Scope priority: url > company > ats. `runRecipe` executes the steps by field signature, trying each selector candidate, then **self-heals**: re-extract, re-match by signature or `labelNorm`, patch the selector list, bump the version. If healing fails, it hands the remaining steps to the agent (A06) and records the run so A06 can repair the recipe. Track successes and failures, and **demote** after 2 consecutive failures.
6. **Accounts (`forms/accounts.ts`):** for login-wall ATSs, use the campaign's dedicated job-search email, generate a strong unique password per domain and store it in the vault (`site_accounts`), handle the email verification code or link through A09 `waitForCode(domain)`, and reuse the account on later applications to the same tenant. Never use the owner's personal accounts. Never create accounts on LinkedIn or Indeed.
7. **Verify (`forms/verify.ts`):** after the final step and before submit, re-extract every field and compare with the intended values (normalised). Check that every required field is non-empty, uploaded files show their filename chip, and no `[aria-invalid=true]` or error text is present. Take a full-page screenshot per step. `verified:false` → never submit.
8. **Challenges:** keep `VISIBLE_CHALLENGE` and extend it (Turnstile, reCAPTCHA v2/v3 visible widgets, hCaptcha, Arkose). Detected → `needs_you`, everything else filled, with "finish in browser" support (keep the existing headful flow).
9. **Confirm:** confirmation text, URL or DOM signals per adapter, plus an optional confirmation email match (A09). Store the proof screenshot.
10. **Human-like behaviour without deception tricks:** realistic typing cadence and small pauses. **No** fingerprint spoofing, IP rotation or anti-bot evasion. If a site blocks automation, mark the job `needs_you` with the reason.

## Tests (A11 provides the fixture forms; build extras yourself as needed)
- Every adapter against its fixture form: ≥ 95% of fields verified, multi-step navigation, uploads.
- Each handler on a dedicated widget page (react-select, a MUI date picker, a phone country picker, shadow DOM and iframe cases).
- Recipe self-heal: change selectors in the fixture and the run still passes, with a new recipe version.
- A verify failure blocks submit.

## Acceptance
- [ ] 10+ adapters, Workday multi-step included, all passing fixtures
- [ ] Recipes are used first, self-heal works, and demotion works
- [ ] Zero submissions without `verified:true` (enforced and tested)
- [ ] Unknown required questions flow to the answer-bank loop
- [ ] Per-step screenshots and a field log are stored for every run
