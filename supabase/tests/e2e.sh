#!/bin/bash
# Runs the Playwright browser tests (`e2e/*.spec.ts`) against one
# already-running stack copy started from the Compose template, plus the
# site container that copy serves.
#
# In CI the e2e job starts one copy first (gen-env.py, compose build site +
# up, wait for health); for local runs, start one copy the same way, e.g.:
#
#   ENV_FILE=.env.ironsworn docker compose -p ironsworn --env-file .env.ironsworn up -d --build
#   ENV_FILE=.env.ironsworn supabase/tests/e2e.sh
#
# The first run on a machine needs the browser once:
#   npx playwright install chromium
#
# Skipped tests fail this script: the JSON report check below keeps a
# misconfigured job -- or an `test.skip` committed by accident -- from
# passing silently.
#
# Later tickets add their browser tests to the same run by dropping new
# `e2e/*.spec.ts` files: this script discovers them all, so no list here
# ever needs updating.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.live}"

[ -f "$ENV_FILE" ] || { echo "e2e: missing env file $ENV_FILE (run: python3 bin/gen-env.py)" >&2; exit 1; }
[ "$(cd "$(dirname "$ENV_FILE")" && pwd)" = "$ROOT" ] || { echo "e2e: env file must live in $ROOT" >&2; exit 1; }

get_var() { grep -E "^$2=" "$1" | cut -d= -f2- || true; }

export SUPABASE_URL="http://localhost:$(get_var "$ENV_FILE" API_GW_HTTP_PORT)"
export SUPABASE_ANON_KEY="$(get_var "$ENV_FILE" ANON_KEY)"
export SUPABASE_SERVICE_ROLE_KEY="$(get_var "$ENV_FILE" SERVICE_ROLE_KEY)"
export E2E_SITE_URL="${E2E_SITE_URL:-http://localhost:$(get_var "$ENV_FILE" SITE_HTTP_PORT)}"

[ -n "$SUPABASE_ANON_KEY" ] && [ -n "$SUPABASE_SERVICE_ROLE_KEY" ] \
  || { echo "e2e: ANON_KEY and SERVICE_ROLE_KEY must be set in $ENV_FILE" >&2; exit 1; }

echo "e2e: browser tests against $E2E_SITE_URL (gateway $SUPABASE_URL)"
REPORT="$ROOT/../test-results/e2e-report.json"
rm -f "$REPORT"

playwright_status=0
cd "$ROOT/.." && npx playwright test || playwright_status=$?

node --input-type=module -e '
import { existsSync, readFileSync } from "node:fs";
const path = process.argv[1];
if (!existsSync(path)) {
  console.error("e2e: no Playwright JSON report, the run never produced one");
  process.exit(1);
}
const report = JSON.parse(readFileSync(path, "utf8"));
const stats = report.stats ?? {};
const expected = stats.expected ?? 0;
const unexpected = stats.unexpected ?? 0;
const flaky = stats.flaky ?? 0;
const skipped = stats.skipped ?? 0;
const total = expected + unexpected + flaky + skipped;
console.log(`e2e: ${total} browser test(s): ${expected} passed, ${unexpected} failed, ${flaky} flaky, ${skipped} skipped`);
if (total === 0) {
  console.error("e2e: no browser tests ran, failing so an empty run never passes");
  process.exit(1);
}
if (skipped > 0) {
  console.error(
    `e2e: ${skipped} browser test(s) skipped against a running stack, ` +
      "failing so skips never pass silently"
  );
  process.exit(1);
}
' "$REPORT" || check_status=$?
check_status=${check_status:-0}

if [ "$playwright_status" -ne 0 ]; then exit "$playwright_status"; fi
exit "$check_status"
