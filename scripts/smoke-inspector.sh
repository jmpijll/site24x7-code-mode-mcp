#!/usr/bin/env bash
# Spawn the Site24x7 MCP server over stdio and exercise it with the
# MCP Inspector. Useful for quick sanity checks against a live tenant.
#
# Requires `npx @modelcontextprotocol/inspector` to be available.
#
# Usage:
#   npm run smoke:inspector
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

required=(SITE24X7_CLIENT_ID SITE24X7_CLIENT_SECRET SITE24X7_REFRESH_TOKEN)
missing=()
for var in "${required[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "ERROR: missing required env vars: ${missing[*]}" >&2
  echo "Set them in .env or your shell, then re-run." >&2
  exit 1
fi

echo "Launching MCP inspector against site24x7-mcp …"
echo "  zone=${SITE24X7_ZONE:-com}"
echo "  zaaid=${SITE24X7_ZAAID:-(none)}"
echo

npx --yes @modelcontextprotocol/inspector \
  npx tsx src/index.ts
