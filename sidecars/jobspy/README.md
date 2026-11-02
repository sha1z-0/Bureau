# JobSpy sidecar

A tiny Python CLI around [python-jobspy](https://github.com/speedyapply/JobSpy) that
Bureau's scout (`server/scout/jobspy.ts`) spawns to read **public guest search
results** from LinkedIn, Indeed, Glassdoor, Google Jobs, ZipRecruiter, Bayt and
Naukri. It never logs in, never applies, and never stores cookies.

## Install

    # Windows
    powershell -ExecutionPolicy Bypass -File scripts/setup-sidecar.ps1
    # Linux / macOS
    bash scripts/setup-sidecar.sh

Both create `sidecars/jobspy/.venv` (gitignored) and install `requirements.txt`.
If Python or the venv is missing, Bureau reports the `jobspy` source as
`unavailable` and the rest of the scan carries on.

## Protocol

    python -m jobspy_cli --check
    python -m jobspy_cli --json '{"sites":["indeed","linkedin"],"search_term":"security engineer","location":"Remote","results_wanted":50,"hours_old":72}'
    echo '{...}' | python -m jobspy_cli --json -

Output is one JSON document on stdout: `{ ok, jobs: [...], errors: [{site, error}], counts }`.
Progress goes to stderr. Exit codes: 0 ok (per-site failures are in `errors`),
2 bad request, 3 jobspy not installed.

Request fields: `sites`, `search_term`, `location`, `results_wanted` (≤ 200),
`hours_old`, `is_remote`, `country_indeed`, `google_search_term`, `proxies`,
`linkedin_fetch_description`, `pause_seconds` (between sites).

## Limits worth knowing (from JobSpy's docs)

- LinkedIn rate-limits guest search early (around the 10th page from one IP);
  Bureau keeps LinkedIn requests small and spaced, and proxies are optional.
- Every site caps out near 1,000 results per search; Bureau asks for far fewer
  and rotates search terms (campaign roles × locations) instead.
- Indeed accepts only one of `hours_old` and `is_remote`; the CLI prefers freshness.
