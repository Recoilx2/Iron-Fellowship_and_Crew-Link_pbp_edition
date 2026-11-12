#!/bin/bash
# Runs the Docker-based behavior tests (`src/**/*.live.test.ts`) against one
# already-running stack copy started from the Compose template.
#
# In CI the smoke job starts the stack first (`CLEANUP=0 tests/smoke.sh`); for
# local runs, start one copy the same way, e.g.:
#
#   supabase/tests/smoke.sh          # leaves both copies up with CLEANUP=0
#   ENV_FILE=.env.ironsworn supabase/tests/live.sh
#
# Later tickets add their behavior tests to the same job by dropping in new
# `*.live.test.ts` files: this script discovers them all, so no list here
# ever needs updating.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.ironsworn}"

[ -f "$ENV_FILE" ] || { echo "live: missing env file $ENV_FILE (run: python3 bin/gen-env.py)" >&2; exit 1; }
[ "$(cd "$(dirname "$ENV_FILE")" && pwd)" = "$ROOT" ] || { echo "live: env file must live in $ROOT" >&2; exit 1; }

get_var() { grep -E "^$2=" "$1" | cut -d= -f2- || true; }

export SUPABASE_URL="http://localhost:$(get_var "$ENV_FILE" API_GW_HTTP_PORT)"
export SUPABASE_ANON_KEY="$(get_var "$ENV_FILE" ANON_KEY)"
export SUPABASE_SERVICE_ROLE_KEY="$(get_var "$ENV_FILE" SERVICE_ROLE_KEY)"
# The data-layer singleton reads its own variables.
export VITE_SUPABASE_URL="$SUPABASE_URL"
export VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY"

[ -n "$SUPABASE_ANON_KEY" ] && [ -n "$SUPABASE_SERVICE_ROLE_KEY" ] \
  || { echo "live: ANON_KEY and SERVICE_ROLE_KEY must be set in $ENV_FILE" >&2; exit 1; }

mapfile -t files < <(cd "$ROOT/.." && find src -name "*.live.test.ts" | sort)
[ "${#files[@]}" -gt 0 ] || { echo "live: no *.live.test.ts files found" >&2; exit 1; }

echo "live: running ${#files[@]} behavior test file(s) against $SUPABASE_URL"
cd "$ROOT/.." && npx vitest run --no-coverage "${files[@]}"
