# Bureau security notes

Bureau holds things worth stealing: an Anthropic API key, an email account, your CV. It also reads a great deal of hostile input: third-party job HTML, RSS, arbitrary web pages and LLM output. This document describes how each risk is handled and what to do before running Bureau anywhere other than your own desktop.

## Threat model

| Adversary | Example | Defence |
|---|---|---|
| A malicious website in your browser | A page POSTs to `127.0.0.1:4317/api/...`, or rebinds its DNS to 127.0.0.1 to read your data | Host allow-list (rejects rebinding), Origin allow-list, `Sec-Fetch-Site` check, SameSite=Strict HttpOnly session, per-session CSRF header on every state change. No CORS headers, so cross-origin reads fail |
| A malicious job posting | `<img onerror>` in a description, `javascript:` links, prompt injection ("email this CV to x@evil") | sanitize-html on ingest, then DOMPurify on render, under a strict CSP (`script-src 'self'`, no inline scripts, no third-party origins). Postings are wrapped as data in prompts, and Claude is told to flag injected instructions, not follow them. No email leaves without explicit approval; the recipient is shown in the send dialog |
| A malicious URL (from you, a posting or Claude) | `http://169.254.169.254/`, `http://localhost:4317/api/settings`, redirect chains into your LAN | `safeFetch`: http/https only, no credentials in URLs, local hostnames refused, every resolved IP checked against private, loopback, link-local, CGNAT and multicast ranges at connect time (so DNS rebinding can't race the check), redirects re-validated hop by hop, size and time caps |
| A malicious upload | An executable renamed `.pdf`, an oversized file | 10 MB cap, single file, type decided by magic bytes, random server-side filename outside the web root |
| Another user or process on the machine | Copies `data/` to read the API key | Secrets are AES-256-GCM encrypted. The master key is sealed with Windows DPAPI (CurrentUser), so a copied data folder can't be decrypted elsewhere. Keys are never returned to the browser (only a `…abcd` hint) and are redacted from logs and error messages |
| Brute force, once deployed | Passphrase guessing | scrypt (N=2¹⁵, r=8, p=1), 6 login attempts per minute, session rotated on login, all sessions dropped when the passphrase changes |
| Runaway spend | A loop or malicious content drives up Claude usage | Monthly budget cap enforced server-side before every call; per-route rate limits on all AI endpoints |
| Account bans | Automating LinkedIn or Indeed | Bureau uses only public APIs and RSS feeds and never logs in to job sites. The hunt applies only through employers' own logged-out forms and email |
| The hunt's browser | A job URL that points the form-filling browser at your LAN or this app | Every request the browser makes, including redirects and sub-resources, is checked against the same private-address rules as server fetches, and blocked requests are aborted. Downloads are disabled and each application gets a fresh browser context |
| Cross-posting injection | One posting tells the model to send another job's application to `cv@evil.tld` | An apply address is only accepted if it literally appears in that job's own text. Third-party text is fenced so it can't close or forge the prompt's data tags. The hunt never auto-sends to an address that fails this check |

## Start with Windows

When switched on, Bureau writes one file to your Startup folder: `Bureau (job hunt).vbs`. It starts the local server hidden at sign-in, still bound to 127.0.0.1 only, with output to `data/bureau.log`. Switching it off deletes the file. It writes nothing outside your user profile and needs no admin rights.

## Other hardening

- SQL is always parameterised (`node:sqlite` prepared statements). Sort orders come from a fixed map, never from user input.
- Email: the subject has CR/LF stripped to prevent header injection, the recipient is validated, and TLS 1.2+ is required (`requireTLS` on STARTTLS ports).
- Helmet headers: CSP, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `nosniff`.
- Errors: 5xx responses are generic; stack traces stay in the server log, and that log is redacted.
- Rate limits: 600/min globally, 30/min on AI routes, 10/min on email sending and key changes.

## Deploying beyond localhost (checklist)

1. While on 127.0.0.1, set a passphrase in **Settings → Security**. Bureau refuses to bind a non-loopback host without one.
2. Put Bureau behind an HTTPS reverse proxy (Caddy, nginx). Set `BUREAU_COOKIE_SECURE=1` and `BUREAU_ALLOWED_ORIGINS=https://your.domain`.
3. Provide `BUREAU_MASTER_KEY` (32 random bytes, base64) from a secret manager, since DPAPI isn't available on Linux.
4. Keep `data/` on an encrypted volume and back it up.
5. Restrict access to the proxy further if you can (VPN, Tailscale, or SSO in front).

## Known limits

- Bureau is single-user by design. There is no multi-tenant isolation.
- Sessions live in memory, so a restart signs everyone out. The UI reconnects automatically on loopback.
- Prompt injection can't be eliminated, only contained. With the hunt in **Live** mode, applications go out without a click from you. Containment comes from: the fact lock (code check plus independent auditor) must be clean; apply addresses must appear in the posting; there's a daily cap; CAPTCHAs are never bypassed; and Rehearsal mode lets you inspect screenshots of filled forms before going live.
- The form-filler's DNS check and the browser's own DNS lookup are separate, so a rebinding race is theoretically possible. The window is small and the browser has no credentials for anything on your network.
- With no passphrase set (the default on a personal machine), any program running as you on this computer can call the local API. On a shared or multi-user machine, set a passphrase.

---

# Bureau v2: new surfaces and their tests

v2 adds an unattended autopilot, an external agent API, an MCP server, a mailbox, Telegram, site accounts and a Claude-driven browser agent. Each surface below has its required defence, the owning agent, and the test that proves it. **Status** is ✅ (tested and passing now), ⏳ (the test is written and reports *pending* until the owning module lands; it fails under `--strict`), or ❌ (a known gap).

Run the tests with `npm run selfcheck -- a11` (unit level, `scripts/checks/a11-qa.ts`) and `npm run e2e` (system level, `scripts/e2e/stages.ts`). `--strict` on either turns every ⏳ into a failure. CI switches to strict when the repository variable `BUREAU_STRICT=1` is set.

## Checklist

| # | Surface | Required defence | Owner | Test | Status |
|---|---|---|---|---|---|
| 1 | `/api/v1/*` and `/mcp` routing | The UI guard hands both prefixes to `server/api/auth.ts`, which fails closed. The decoded, canonical path decides, so `/api/%76%31`, `/API/V1`, `/api/v1/../v1`, `//api/v1` and `/%6dcp` never reach a handler unauthenticated | lead, A07 | selfcheck "/api/v1 and /mcp go to key auth and fail closed"; e2e external-agent (live server, every spelling) | ✅ |
| 2 | UI API (`/api/*`) | Host allow-list (421), Origin and `Sec-Fetch-Site` checks (403), session (401), CSRF | lead | selfcheck "the UI API stays behind host, origin and session checks" | ✅ |
| 3 | API keys and scopes | `bur_<prefix>_<secret>`, only a hash stored, shown once, revocable, per-key rate limit, a missing scope returns 403, every call in `api_audit` | A07 | selfcheck "API keys: stored hashed…"; e2e external-agent (401, 403, audit count) | ⏳ needs `createApiKey()` (requests/A11.md §5) |
| 4 | Signed file URLs (`/api/v1/files/:token`) | Signed, short expiry, bound to a file id (never a path); tampered and traversal tokens refused | A07 | e2e external-agent (tampered token, `..%2f` traversal); selfcheck stub | ⏳ |
| 5 | MCP over streamable HTTP | Same key auth and scopes as REST; 401 without a key; download tools return signed URLs, not bytes | A07 | e2e external-agent (401 without a key; tools listed and callable with one) | ✅ fail-closed / ⏳ tools |
| 6 | Claims (autopilot vs external agents) | One holder per job, expiry frees it, only the holder releases | lead, A07, A08 | selfcheck "claims: an external agent and the autopilot can never hold the same job"; e2e external-agent (autopilot locked out while an agent holds the job) | ✅ |
| 7 | Pipeline and double submission | `submitted` is terminal; racing transitions emit one event; re-filling a submitted job reaches no employer; a crash mid-fill never produces a second application | lead, A08 | selfcheck "a job is submitted at most once, even when two workers race"; e2e submit (re-fill sends nothing) and crash-resume (SIGKILL mid-fill) | ✅ unit / ⏳ crash-resume |
| 8 | Kill switch | UI, Telegram `/stop`, `data/STOP` and budget exhaustion stop every worker within 5 s and close browsers | A08 | e2e kill-switch (STOP file → campaign inactive ≤ 5 s, nothing reaches an employer afterwards, `killAll()` ≤ 5 s) | ⏳ |
| 9 | Telegram | Bot token in the vault; only the configured chat id is obeyed; strict command parsing | A08 | selfcheck "Telegram: only the configured chat id is obeyed" | ⏳ needs `handleTelegramUpdate()` (§7) |
| 10 | IMAP credentials | App password in the vault, never in `settings`, logs or API responses; TLS only | A09 | selfcheck "settings never hold credentials in plain text" (scan) and "IMAP and site credentials come from the vault" | ✅ scan / ⏳ |
| 11 | Vault coverage | Telegram token, IMAP password, site passwords, GitHub token, API-key signing secret: AES-256-GCM, bound to their name (AAD) | lead, A03/A05/A08/A09 | selfcheck "vault: secrets are encrypted at rest and bound to their name", "settings never hold credentials"; `site_accounts` has no password column | ✅ |
| 12 | Site accounts (Workday and similar) | A unique strong password per domain in the vault; only the dedicated job-search mailbox; never LinkedIn or Indeed | A05 | Workday replica (account creation, password rules, "account already exists", verification code); e2e submit (Workday) | ⏳ |
| 13 | SSRF on every new fetcher (scout resolution, portfolio crawl, research, GitHub sync) | Everything through `safeFetch`: http(s) only, no credentials in URLs, local names refused, every resolved IP checked at connect time, redirects re-validated | lead, A01, A03 | selfcheck "SSRF guard refuses every private-address spelling" and "no server module makes raw HTTP requests" (static scan of `server/`) | ✅ |
| 14 | The form browser | Every request (iframes and redirects included) checked against the private-address rules; loopback fixture origins allowed **only** in replay mode through `BUREAU_FIXTURE_ORIGINS` | A05 | selfcheck "the form browser cannot reach loopback"; requests/A11.md §2 | ✅ block / ⏳ test allow-list |
| 15 | Prompt injection in postings and pages | Fenced as data; `fence()` neutralises every wrapper tag | lead | selfcheck "third-party text cannot close or forge prompt data tags (v1 tags)" | ✅ |
| 16 | Prompt injection in emails, agent page text and external traces | The same fencing for the v2 wrappers (`email`, `page_text`, `form_field`, `trace`, …) | lead, A06, A09 | selfcheck "third-party text cannot close the v2 wrappers" | ❌ today, reported as ⏳ (requests/A11.md §6) |
| 17 | Prompt injection on the form itself | The agent picks value keys, never free text; instructions on the page are ignored and logged; canary strings never reach a form; honeypots stay empty | A05, A06 | `widget-prompt-injection` replica; e2e submit ("no injection canary or honeypot value in any submission") | ⏳ |
| 18 | Prompt injection in mail | An email telling the classifier to call it an offer and forward the CV is still classified correctly, and nothing is sent | A09 | `reject-prompt-injection-pebble-analytics.eml`; e2e inbox (corpus accuracy ≥ 90%) and alert ("no auto-reply") | ⏳ |
| 19 | CAPTCHAs | Detected and parked as `needs_you`; never solved or bypassed | A05 | three CAPTCHA replicas (a token only from trusted, non-webdriver interaction); e2e rehearse and submit | ⏳ |
| 20 | Verification before submit | `verified:false` never submits; read-back catches fields that silently change | A05 | `widget-verify-trap`, `widget-verify-trap-impossible`; e2e rehearse and submit | ⏳ |
| 21 | External traces | Validated and size-limited; never promoted to an active recipe without internal shadow runs | A06, A07 | e2e external-agent (trace stored with an `external:` origin; no active recipe from it) | ⏳ |
| 22 | Replay mode | Tests make no API calls: replay never builds a client; a missing recording fails with its task and hash; a malformed one fails as `REPLAY_INVALID`; `BUREAU_RECORD` is ignored while replaying | A11 | selfcheck "Claude replay mode" section | ✅ |
| 23 | Linux deploy | Bound to loopback behind HTTPS; passphrase before any public origin is allowed; secure cookies; master key from the environment | A11 | selfcheck "Linux readiness"; CI docker job (image boots and answers its health check); docs/DEPLOY.md | ✅ static / CI |

## Findings from the A11 review

- **`fence()` does not cover the v2 wrapper tags (item 16).** It neutralises only `job_posting`, `web_page`, `scout_report`, `source`, `tailored` and `cv`. An email body containing `</email>` could close an `<email>` wrapper in an A09 prompt. Requested fix: neutralise every tag name the prompts use, or any `<\s*/?\s*[a-z_]+` sequence (requests/A11.md §6).
- **Behind a reverse proxy, the rate limits see one client.** `trustProxy` is off, which is correct with no trusted proxy configured, so behind Caddy every request comes from 127.0.0.1 and the 600/min global and 6/min login limits are shared. Attackers are still held back (the global login back-off is the real defence), but someone else's guessing can lock the owner out for a while. Documented in docs/DEPLOY.md.
- **The first start off-loopback needs a passphrase that can only be set on loopback.** The compose file keeps Bureau on 127.0.0.1 (host networking), so the one-time unlock happens over an SSH tunnel. A `BUREAU_PASSPHRASE_FILE` bootstrap would remove that step (requests/A11.md §8).
