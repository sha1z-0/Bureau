# GitHub API recordings (A03)

Payloads for the profile sync's GitHub step, shaped exactly like the public REST
API (`/users/:login/repos`, `/repos/:o/:r/{languages,commits,readme}`), for the
fictional user `ayesha-dev`. `index.json` maps each request URL to its file;
unknown URLs answer 404 (so `pixel-pantry` has no README). Served by
`recordedFetcher()` in `server/profile/fetch.ts`. The `since=` date assumes the
selfcheck clock of 2026-11-01.

What the fixture exercises: an owned repo with stars and a README (with a prompt
injection in an HTML comment), a fork without meaningful commits (excluded), a fork
with four commits by the owner (included), a repo without a README, a stale repo
with no description (not notable) and an empty repo (skipped).
