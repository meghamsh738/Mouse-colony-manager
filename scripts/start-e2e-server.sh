#!/usr/bin/env bash

set -euo pipefail

E2E_HOST="${E2E_HOST:-127.0.0.1}"
E2E_PORT="${E2E_PORT:-3005}"
E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:${E2E_PORT}}"
E2E_DB_PREPARE_SCRIPT="${E2E_DB_PREPARE_SCRIPT:-}"

export AUTH_URL="$E2E_BASE_URL"
export NEXTAUTH_URL="$E2E_BASE_URL"

if [[ -z "$E2E_DB_PREPARE_SCRIPT" ]]; then
  if [[ "${CI:-}" == "true" ]]; then
    E2E_DB_PREPARE_SCRIPT="db:seed"
  else
    E2E_DB_PREPARE_SCRIPT="db:seed"
  fi
fi

npm run "$E2E_DB_PREPARE_SCRIPT"
npm run build
exec npx next start --hostname "$E2E_HOST" --port "$E2E_PORT"
