#!/bin/bash
# Runs the Docker-based behavior tests (`src/**/*.live.test.ts`) against one
# already-running stack copy started from the Compose template.
#
# In CI the live job starts one copy first (gen-env.py, compose up, wait for
# health); for local runs, start one copy the same way, e.g.:
#
#   ENV_FILE=.env.ironsworn docker compose -p ironsworn --env-file .env.ironsworn up -d
#   ENV_FILE=.env.ironsworn supabase/tests/live.sh
#
# Skipped tests fail this script: with no stack the behavior tests skip, so
# an all-green run with skips would prove nothing. The JSON report check
# below keeps a misconfigured job from passing silently.
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
REPORT="$(mktemp /tmp/live-report-XXXXXX.json)"

vitest_status=0
cd "$ROOT/.." && npx vitest run --no-coverage \
  --reporter=default --reporter=json --outputFile="$REPORT" \
  "${files[@]}" || vitest_status=$?

node --input-type=module -e '
import { readFileSync } from "node:fs";
const report = JSON.parse(readFileSync(process.argv[1], "utf8"));
const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
console.log(`live: ${total} behavior test(s): ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (total === 0) {
  console.error("live: no behavior tests ran, failing so an empty run never passes");
  process.exit(1);
}
if (skipped > 0) {
  console.error(
    `live: ${skipped} behavior test(s) skipped against a running stack, ` +
      "failing so skips never pass silently"
  );
  process.exit(1);
}
' "$REPORT" || check_status=$?
check_status=${check_status:-0}

rm -f "$REPORT"
if [ "$vitest_status" -ne 0 ]; then exit "$vitest_status"; fi
exit "$check_status"
