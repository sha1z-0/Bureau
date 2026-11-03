# E2E-FORMS report: form-engine follow-up for the strict e2e `submit` stage

Branch `v2-e2e-forms` (cut from `v2` at 552c947). Changes are in `server/forms/**` and `scripts/checks/a05-forms.ts`.
Nothing in `server/agent/**`, the fixtures, the manifests or the e2e assertions changed.

Baseline: the strict e2e log of 2026-11-02 (`e2e-strict-2026-11-02.log`, "Live submit against the fixture server").

## Results

| Item | Before (strict e2e log) | After (`run-fixtures --submit --seed-address`) |
| --- | --- | --- |
| widget-react-select | 5/6, skills = JavaScript, Python, REST APIs… (no PostgreSQL), 72 s | 6/6, skills = TypeScript; Node.js; PostgreSQL; React; Docker; SQL, 23 s |
| breezy-portal | 18/22, entry company/title/school/field empty | 22/22 |
| smartrecruiters-oneclick | 20/24 (startDate, current, edu endDate, hiringManagerMessage) | 24/24 under `run-fixtures`. In the e2e, `hiringManagerMessage` still needs the other agent's Claude recording |
| teamtailor-careersite | needs_you: "Your CV is required" | submitted, 16/16 |
| workday | 50/52 (gradeAverage "3.4 / 4.0", website-1 = portfolio) | 52/52 |
| widget-shadow-dom | needs_you: "Please fix the highlighted fields" | submitted, 9/9 |

All replicas: **27/27 forms as expected** (`npx tsx scripts/a05/run-fixtures.ts --submit --seed-address`). `npm run selfcheck -- a05`
passes all 62 checks, plus the new unit checks below. The full `npm run selfcheck` passes: 581 checks, 1 skipped. `npm run typecheck` is clean.

## Each item: cause and fix

### 1. widget-react-select: skills

- **Cause.** Two problems. First, when the menu's options were known, the mapper took the intersection of the options and the profile in **option order**. PostgreSQL was missing because it is not an option: you have to create it. Second, on a later pass the menu hid the options already picked, so the mapping changed. `clearWrongPick` then removed every chip and picked a different set (JavaScript, Python, …).
- **Fix.**
  - `rankSkills()` in `map.ts` orders the profile's skills in four tiers: core-stack skills the job names, other skills the job names, the rest of the core stack, then everything else. "The job names" means the skill appears in the posting's title or description. `JobInfo` now carries `description` (`jobs.description_text`), and `Candidate` now carries `coreStack`.
  - A multi combobox gets the top 6 ranked skills, whatever options happen to be shown, so the answer is the same on every pass. A button menu, where you cannot type, only gets skills that are among its options.
  - Skills match options exactly (`sameItem`): "SQL" is not "SQL Server" or "MySQL", and "Node" matches "Node.js". Before, `optionScore ≥ 0.9` also let "SQL" pick "SQL Server" in checkbox lists.
  - `handlers/combobox.ts`, when a field takes several picks:
    - picks already present stay, and only the missing ones are added;
    - wrong pre-filled chips are cleared only when none of the wanted picks is there yet;
    - each pick is the item itself, or the menu's `Create "X"` offer for exactly X, or a match scoring ≥ 0.95. It never takes a near neighbour.
  - Verification of a multi-pick checks every pick.

### 2. breezy-portal: work and education entries

- **Cause.** Breezy's entry inputs have no labels, only placeholders ("Company", "Title", "School", "Field of Study"). The label finder took the section heading ("Work History", "Education") or the previous entry's "Delete" link as the label. So no field was recognised as part of an entry:
  - the engine kept clicking "Add" up to its guard;
  - company and title went unfilled;
  - education entries copied the first entry and got work dates.
- **Fix.** All in `page.ts` and `map.ts`:
  - A caption that sits over several controls names the section, not the input. In that case the input's own placeholder wins, unless it is an example or an instruction (`placeholderName`). "Delete" is now a generic word, not a label.
  - Entries in a list that names its collection (`ul#education > li`) are grouped even when there is only one. The list's own attributes decide the kind, because Breezy uses `li.experience` for education entries too. Block text now includes placeholders.
  - An education entry the profile does not have stays empty. It no longer silently copies `education[0]`.
  - A new `edu_description` key fills an education entry's "Summary" with that entry's own details from the profile, not the professional summary.

### 3. smartrecruiters-oneclick: entry dates and "current"

- **Cause.** Clicking "Add" opens an inline sub-form whose Save button is a `spl-button`: the real `<button>` sits in an open shadow root, and its text comes through a slot. `saveNear` did not look inside shadow roots, so it never found Save. As a result:
  - the sub-form fields were filled as flat fields: Title and Company went in through the current-job keys, while From, To, "I currently work here" and Description got nothing;
  - the engine saved the sub-forms later with those fields still empty.
- **Fix.**
  - `saveNear` searches open shadow roots too, and reads a shadow button's host text and `data-test`.
  - Each sub-form is filled as work or education entry N and then saved.
  - Graduation date: the profile only says "2023", but the field wants MM/YYYY. The month now comes from the owner's own answer-bank entry "When did you complete your degree?" ("June 2023"), and only when its year matches the profile's.
  - An **optional** field that wants a month the profile does not have now stays empty. Before, it got an invented "01/2019"; this also affected Breezy's education start date.

### 4. teamtailor-careersite: "Your CV is required"

- **Cause.** Dropzone.js appends its hidden `<input type=file>` to the end of `<body>`. The upload-label search walked up from that input to `<body>` and matched "portfolio" in the job ad text, so the input was labelled "portfolio" and nothing uploaded the CV.
- **Fix.** `detachedZone()` matches a file input that sits directly under `<body>` to the drop zone it serves (in zone order) and labels it from that zone ("Upload CV" → `cv`). The label search no longer reads `<body>` or `<html>`. The upload then posts to the fixture's S3 replica and `candidate[resume_remote_url]` is committed before submit.
- **Also needed for 16/16: the optional multiple-choice question was invisible.** "Which of these have you used in production?" is a button with `aria-haspopup="menu"` over `menuitemcheckbox` items. It is now a multi combobox with options, and the handler does not toggle an open menu shut. The answer is "Node.js; PostgreSQL; React": the profile's own skills, and the CV says production work on those.

### 5. workday: GPA and websites

- **GPA.** The manifest expects `profile:gpa` = "3.4" (`fixtures/profile/expected.json`). The quirks list "GPA with scale" among the planted parse errors. The profile states "CGPA 3.4 / 4.0", so "3.4" is truthful. A05 had GPA on the never-enter list, which left the parser's "3.4 / 4.0" in place.
  - Fix: `gpa` is now a profile key. The value comes only from the education entry's details (`CGPA 3.4 / 4.0` → `3.4`; a "GPA scale" field gets `4.0`). No GPA in the profile means empty, or an unknown question if the field is required.
- **Websites.** Workday's "Websites" panels label every box just "URL". The parser had pre-filled github then portfolio, in the same order the profile lists them, and the manifest expects that order. There were two causes:
  - the mapper gave every generic URL box the portfolio;
  - after a re-render, the engine's `refind()` matched website-1 by signature, and the twin boxes share one, so it typed into website-2.

  Fixes:
  - `spreadWebsites()` gives several generic website fields distinct links in the profile's order. A numbered panel (`#website-2--url`) gets its number's link on whichever pass maps it. Links that have their own field on the page (LinkedIn) are skipped.
  - `refind()` and the verifier's re-find prefer a twin with the same `#id` or `[name=]` selector.

### 6. widget-shadow-dom: closed shadow root

- **Not impossible, so it is not left as needs_you.** The fixture documents the way in, and it works without faking anything: the closed root delegates focus, so click plus keyboard reaches the input, and the value is readable through `new FormData(form)`. No manifest change is needed.
- **Fix.**
  - `closedField()`: a form-associated custom element with no reachable `shadowRoot`, a `name` and no light-DOM control becomes a text field (`meta.closed`), labelled from its `label` or `aria-label` attribute.
  - `fillClosed()` clicks the host, selects all, types the value and presses Tab.
  - Read-back uses `FormData(form).get(name)`. Verification checks that read-back value, so `verified: true` still means the value really reached the form.
- **The LinkedIn box was also missing.** Its label is light-DOM text projected through a `<slot>`. `ownText()` now reads a slot's assigned nodes, so the field is "LinkedIn profile" and gets filled.

## New checks (`scripts/checks/a05-forms.ts`)

- Skills by relevance, exact option matches only, multi-pick verification.
- Education: GPA only as the profile states it, no copied second entry, no invented month.
- Several generic website fields get distinct links in profile order, including a later pass that maps one numbered panel alone.

## Not changed (other agent's area)

- Lever `comments` and SmartRecruiters `hiringManagerMessage`: these need Claude recordings for the free-text answers.
- personio-job: the owner's answer to "Do you need a work permit to work for a German employer?" is missing.

`run-fixtures` passes them only because it seeds that answer and uses fallback packets.

## For the lead

- No manifest change is proposed: every item was fixable truthfully.
- `npm run e2e -- --only rehearse,submit` did not pull in its prerequisites: `write` failed because `match` was not selected ("only selected jobs are written"). This is a runner issue in A11's area. Use `--only scout,match,write,rehearse,submit` or the full run.
- Native `type=date` inputs still need a day: a month-only profile date becomes the 1st of the month (pre-existing). A **required** field that wants a month the profile does not have still gets January. Recording it as an unknown question would ask the owner a meaningless "From?" question; a better question text is a follow-up.
