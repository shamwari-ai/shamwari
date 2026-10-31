#!/usr/bin/env bash
# End-to-end contract test: the real Worker code against a real Core process.
#
#   scripts/e2e.sh
#
# Starts core/e2e_app.py (Core's real app over an in-memory store holding the fixture
# corpus) on a free local port, runs gateway/test/e2e.test.ts against it, and stops it.
# Needs Core's dependencies installed (pip install --require-hashes -r core/requirements.txt)
# and `npm ci` done in gateway/. No network, no credentials, nothing deployed.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
python="${PYTHON:-python}"
port="${E2E_PORT:-$("$python" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')}"
token="$("$python" -c 'import secrets; print(secrets.token_hex(16))')"
log="$(mktemp)"

cd "$root/core"
E2E_CORE_TOKEN="$token" "$python" -m uvicorn e2e_app:app --host 127.0.0.1 --port "$port" --log-level warning >"$log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; rm -f "$log"' EXIT

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/__e2e/ready" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$pid" 2>/dev/null; then echo "Core e2e app exited:" >&2; cat "$log" >&2; exit 1; fi
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$port/__e2e/ready" >/dev/null || { echo "Core e2e app did not start" >&2; cat "$log" >&2; exit 1; }

cd "$root/gateway"
E2E_CORE_URL="http://127.0.0.1:$port" E2E_CORE_TOKEN="$token" npx vitest run test/e2e.test.ts
