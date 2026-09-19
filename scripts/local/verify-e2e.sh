#!/usr/bin/env bash
set -euo pipefail

port="${ALPHALENS_LOCAL_PORT:-8788}"
base_url="http://localhost:${port}"
log_file="${TMPDIR:-/tmp}/alphalens-local-fixture-${port}.log"

if [[ ! -f .dev.vars ]]; then
  echo "Missing .dev.vars. Copy .dev.vars.example before running the local fixture workflow." >&2
  exit 1
fi

CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=wrangler.local.jsonc \
  WRANGLER_LOG_PATH=.wrangler/wrangler.log \
  pnpm exec vinext dev --host localhost --port "${port}" --strictPort >"${log_file}" 2>&1 &
server_pid=$!
cleanup() { kill "${server_pid}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

for _ in {1..40}; do
  if curl --silent --output /dev/null "${base_url}/"; then
    ALPHALENS_LOCAL_URL="${base_url}" pnpm local:verify
    exit 0
  fi
  sleep 0.25
done

echo "AlphaLens local server did not become ready. Log: ${log_file}" >&2
exit 1
