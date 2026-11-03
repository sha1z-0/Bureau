#!/usr/bin/env bash
# Creates sidecars/jobspy/.venv and installs the JobSpy sidecar's dependencies.
#   bash scripts/setup-sidecar.sh [--force]        PYTHON=/usr/bin/python3.12 bash scripts/setup-sidecar.sh
# Bureau runs fine without it: the jobspy source just reports "unavailable".
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIDECAR="$ROOT/sidecars/jobspy"
VENV="$SIDECAR/.venv"

pick_python() {
  if [ -n "${PYTHON:-}" ]; then echo "$PYTHON"; return; fi
  for c in python3.12 python3.13 python3.11 python3.14 python3.10 python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; assert sys.version_info >= (3, 10)' 2>/dev/null; then
      echo "$c"; return
    fi
  done
}

PY="$(pick_python || true)"
if [ -z "$PY" ]; then
  echo "Python 3.10+ was not found. Install it (e.g. apt install python3 python3-venv) and re-run." >&2
  echo "Bureau keeps working without it; the JobSpy source shows as unavailable." >&2
  exit 1
fi

if [ "${1:-}" = "--force" ]; then rm -rf "$VENV"; fi
if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating $VENV with $PY"
  "$PY" -m venv "$VENV" || { echo "venv failed; on Debian/Ubuntu install python3-venv" >&2; exit 1; }
fi
"$VENV/bin/python" -m pip install --disable-pip-version-check --no-cache-dir --quiet --upgrade pip
"$VENV/bin/python" -m pip install --disable-pip-version-check --no-cache-dir --prefer-binary -r "$SIDECAR/requirements.txt"
( cd "$SIDECAR" && "$VENV/bin/python" -m jobspy_cli --check )
echo "JobSpy sidecar ready."
