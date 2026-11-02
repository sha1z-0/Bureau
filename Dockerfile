# syntax=docker/dockerfile:1.7
#
# Bureau on Linux, headless: Node + Debian Chromium + the Python JobSpy sidecar.
#
#   docker build -t bureau .
#   docker run --rm --shm-size=1g bureau npm run e2e        # the full offline suite
#   docker compose up -d                                     # the VPS deploy (docs/DEPLOY.md)
#
# Everything Windows-specific (Start with Windows, DPAPI) is inactive on Linux;
# the vault master key comes from BUREAU_MASTER_KEY instead.

FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# Chromium for the form engine, fonts so screenshots and PDFs render real
# glyphs, Python for the JobSpy sidecar, tini to reap browser processes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji \
      python3 python3-venv python3-pip \
      ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 # playwright-core's "chrome" channel looks for /opt/google/chrome/chrome on Linux;
 # point it at Debian's Chromium so launchBrowser() works unchanged. BUREAU_CHROME_PATH
 # names the same binary for code that takes an explicit path.
 && mkdir -p /opt/google/chrome \
 && ln -s /usr/bin/chromium /opt/google/chrome/chrome

ENV BUREAU_CHROME_PATH=/usr/bin/chromium

WORKDIR /app

# Dependencies first for layer caching. Dev dependencies stay: the server runs
# TypeScript through tsx, and the test suites run in this same image.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit

COPY . .

# The web UI, then the optional JobSpy sidecar venv (Bureau degrades gracefully without it).
RUN npm run build \
 && if [ -x scripts/setup-sidecar.sh ]; then scripts/setup-sidecar.sh; \
    elif [ -f sidecars/jobspy/requirements.txt ]; then \
      python3 -m venv sidecars/jobspy/.venv && sidecars/jobspy/.venv/bin/pip install --no-cache-dir -r sidecars/jobspy/requirements.txt; \
    fi

# Run as an unprivileged user; data lives on a volume.
RUN groupadd --system bureau && useradd --system --gid bureau --home-dir /app --shell /usr/sbin/nologin bureau \
 && mkdir -p /data && chown -R bureau:bureau /data /app
USER bureau

ENV BUREAU_DATA_DIR=/data \
    BUREAU_HOST=127.0.0.1 \
    BUREAU_PORT=4317 \
    BUREAU_LOG=warn
VOLUME ["/data"]
EXPOSE 4317

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BUREAU_PORT||4317)+'/api/health').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "server/index.ts"]
