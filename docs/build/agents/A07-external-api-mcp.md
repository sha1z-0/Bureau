# A07: External agent API and MCP server (lets Muse and other agents use Bureau)

**You own:** `server/api/**` (including `server/api/mcp/`), `docs/AGENT_API.md`.
**Mission:** any outside agent (Muse, Claude in Chrome, a custom browser agent) can pull everything it needs to apply, and push back what it learned, safely.

## Build
1. **Auth, separate from the UI session guard:** API keys with the format `bur_<prefix>_<secret>`. Store a hash only (scrypt or argon2) in `api_keys`, with scopes `jobs:read`, `packets:read`, `answers:read`, `recipes:read`, `traces:write`, `applications:write`. Bearer auth. Per-key rate limits. Every call goes to `api_audit`. Keys are created and revoked in the UI (A10) and shown once. The UI's Host/Origin and CSRF guard keeps protecting `/api/*`. `/api/v1/*` uses key auth only, has CORS off by default, and stays loopback-only unless a passphrase is set (respect the existing `BUREAU_HOST` rule).
2. **REST `/api/v1` (schemas in `contracts/api.ts`):**
   - `GET /jobs?state=selected&limit=` lists jobs ready to apply, with a summary and the apply URL.
   - `GET /jobs/:id` returns the job detail.
   - `POST /jobs/:id/packet` makes sure the packet exists (calls A04 if needed) and returns the text fields plus **short-lived signed download URLs** for the CV and letter PDFs (`GET /files/:token`).
   - `POST /answers` takes `{jobId, question, fieldKind, options?}` and returns `{value, source, confidence}` through the A05 map → A03 → A04 chain. Unknowns are recorded.
   - `GET /recipes?url=` returns the matching active recipe if any.
   - `POST /traces` takes a `Trace` from the external agent. It's stored and queued for compile and shadow verification.
   - `POST /jobs/:id/submitted` takes `{proofScreenshot (base64), confirmationText?, url}`, moves the pipeline to `submitted` and records `origin: external`.
   - `POST /jobs/:id/failed` takes a reason.
   - `GET /health`.
3. **MCP server (`server/api/mcp/`) using `@modelcontextprotocol/sdk`:** the same capabilities as tools (`list_ready_jobs`, `get_job`, `get_application_packet`, `answer_form_question`, `get_form_recipe`, `report_trace`, `mark_submitted`, `mark_failed`). Transports: stdio (`npm run mcp`) and streamable HTTP at `/mcp` (key auth). Download tools return signed URLs, not raw bytes.
4. **Claim locking:** an agent `claim`s a job (`POST /jobs/:id/claim`, with a TTL of 20 minutes), so Bureau's own autopilot and external agents never both apply to the same job. The A08 state machine respects claims.
5. **Docs (`docs/AGENT_API.md`):** a step-by-step "how an external agent applies to a job with Bureau" (claim → packet → open the URL → for each field call answers → upload files → verify → submit → report trace → mark submitted), with curl examples, the MCP config snippets for Claude Desktop/Claude Code and for a generic MCP client, and the trace schema.
6. **Safety:** never expose vault secrets, site passwords or the owner's raw email credentials through the API. Packets include only what a form needs. Treat everything external agents submit as untrusted: validate it, size-limit it and sanitise screenshots.

## Tests
- Auth: a missing or invalid key returns 401 and a missing scope returns 403. Rate limits hold.
- Full external flow against a fixture form using a scripted fake agent: claim → packet → answers → trace → submitted.
- MCP: list tools and call each with a test key (stdio transport in the test).

## Acceptance
- [ ] Every REST route and MCP tool is implemented and documented
- [ ] Claims prevent double applications between internal and external runs
- [ ] External traces reach A06's compile and shadow queue
- [ ] Audit log entries for every call
