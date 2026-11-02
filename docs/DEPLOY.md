# Deploying Bureau on a Linux VPS

Bureau runs the same on Linux as on Windows, headless: Node, Debian's Chromium for the form engine, and the Python JobSpy sidecar, all in one Docker image. On the VPS it listens on **127.0.0.1 only**. Caddy, on the same host, terminates HTTPS for your domain and forwards to it. Nothing else can reach it.

What you need:
- a VPS with Docker Engine and the Compose plugin (v2.23 or newer, for inline `configs`): 2 vCPU, 4 GB RAM and 10 GB of disk is comfortable (Chromium is the heavy part);
- a domain name with an A/AAAA record pointing at the VPS, and ports 80 and 443 open;
- SSH access to the VPS.

## 1. Get the code and write `.env`

```sh
git clone <your repo> bureau && cd bureau
cat > .env <<'EOF'
BUREAU_MASTER_KEY=<output of: openssl rand -base64 32>
BUREAU_DOMAIN=jobs.example.com
TZ=Asia/Karachi
EOF
chmod 600 .env
```

`BUREAU_MASTER_KEY` encrypts every secret in the vault (Anthropic key, IMAP password, Telegram token, site passwords). Windows seals this key with DPAPI; Linux has no DPAPI, so it comes from the environment. **Back it up somewhere other than the VPS.** Without it, the vault in the data volume can't be read.

Leave `BUREAU_ALLOWED_ORIGINS` and `BUREAU_COOKIE_SECURE` unset for now.

## 2. Start Bureau (loopback only)

```sh
docker compose up -d --build
docker compose ps          # "healthy" after ~30 s
```

The `bureau` service uses host networking with `BUREAU_HOST=127.0.0.1`, so it binds the VPS's loopback interface and is not reachable from the internet. Data lives in the `bureau-data` volume (`/data` in the container).

## 3. One-time unlock over an SSH tunnel

Bureau refuses to answer for a public origin until it has a passphrase, and the passphrase can only be set from loopback. So set it through a tunnel from your own computer:

```sh
ssh -N -L 4317:127.0.0.1:4317 you@your-vps
```

Open <http://localhost:4317>, go to **Settings → Security** and set a long passphrase (a few random words). While you're there, add your Anthropic API key, mailbox and Telegram bot. Close the tunnel when you're done.

## 4. Open it up behind HTTPS

Add these lines to `.env`:

```sh
BUREAU_ALLOWED_ORIGINS=https://jobs.example.com
BUREAU_COOKIE_SECURE=1
```

Then start Bureau and the proxy:

```sh
docker compose --profile proxy up -d
```

Caddy gets a certificate for `BUREAU_DOMAIN` automatically. It forwards the `Host` header unchanged, which Bureau checks against `BUREAU_ALLOWED_ORIGINS`, and adds HSTS. Visit `https://jobs.example.com` and sign in with the passphrase.

The settings that matter, and why:

| Variable | Value | Why |
|---|---|---|
| `BUREAU_HOST` | `127.0.0.1` (set by compose) | Only Caddy and SSH tunnels can reach the app |
| `BUREAU_ALLOWED_ORIGINS` | `https://your.domain` | The Host and Origin allow-list. Anything else gets 421/403, which defeats DNS rebinding and cross-site requests |
| `BUREAU_COOKIE_SECURE` | `1` | The session cookie is only ever sent over HTTPS |
| `BUREAU_MASTER_KEY` | 32 random bytes, base64 | The vault key (see step 1) |
| `BUREAU_PORT` | `4317` (default) | Change it if the port is taken; Caddy follows it |
| `TZ` | your zone | Log timestamps; campaigns use their own `activeHours.tz` |

## 5. Check it

```sh
docker compose exec bureau npm run selfcheck     # offline checks inside the running image
docker compose run --rm bureau npm run e2e       # the full offline end-to-end suite (fixture forms, no real sites)
curl -sI https://jobs.example.com/api/health     # 200 through Caddy
curl -s  http://YOUR_VPS_IP:4317/ ; echo $?      # must fail: not reachable directly
```

## Operating it

- **Logs:** `docker compose logs -f bureau`. Logs are rotated (10 MB × 3) and redacted.
- **Kill switch:** the button in the UI, Telegram `/stop`, or from the VPS: `docker compose exec bureau sh -c 'touch /data/STOP'`.
- **Back up:** stop the stack, then archive the volume:
  `docker run --rm -v bureau_bureau-data:/data -v "$PWD":/backup debian tar czf /backup/bureau-data.tgz -C /data .`
  Keep the backup and `BUREAU_MASTER_KEY` in separate places.
- **Upgrade:** `git pull && docker compose --profile proxy up -d --build`. Database migrations are additive and run at start.
- **The external agent API and MCP:** `https://your.domain/api/v1/...` and `https://your.domain/mcp` use their own API keys (Settings → Agents). See docs/AGENT_API.md.

## Notes and limits

- **Rate limits behind the proxy.** Bureau doesn't trust `X-Forwarded-For` (there's no trusted proxy by default), so it sees every request as coming from 127.0.0.1 and the per-IP limits become global. Brute force is still throttled; the cost is that someone else's guessing can slow down your own login for a few minutes. To narrow who can reach the login at all, put the domain behind Tailscale, a VPN, or an SSO proxy.
- **Chromium in a container** runs without its own sandbox (Playwright's default in containers), inside the container's user namespace as the unprivileged `bureau` user, with `no-new-privileges`. Every page the form engine opens still goes through Bureau's private-network guard.
- **Shared memory:** compose sets `shm_size: 1gb`. With plain `docker run`, pass `--shm-size=1g` or Chromium can crash on large pages.
- **Windows-only features** (Start with Windows, the keep-awake helper, DPAPI) are inactive on Linux, by design.
- **The JobSpy sidecar** is installed in the image when the repository ships its setup script or requirements. Without it, the aggregator connector reports `unavailable` and the scout continues.
