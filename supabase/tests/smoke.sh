#!/bin/bash
# Smoke test: starts both game-system copies side by side from the template
# and verifies each gateway answers with healthy backends behind it.
#
# Env files must already exist (generate with python3 bin/gen-env.py) and live
# next to docker-compose.yml, one per copy with different ports and secrets.
#
#   tests/smoke.sh                                  # uses .env.ironsworn + .env.starforged
#   IRON_ENV=.env.ironsworn STAR_ENV=.env.starforged tests/smoke.sh
#   CLEANUP=0 tests/smoke.sh                        # leave the stacks running
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IRON_ENV="${IRON_ENV:-$ROOT/.env.ironsworn}"
STAR_ENV="${STAR_ENV:-$ROOT/.env.starforged}"
CLEANUP="${CLEANUP:-1}"

for env_file in "$IRON_ENV" "$STAR_ENV"; do
  [ -f "$env_file" ] || { echo "smoke: missing env file $env_file (run: python3 bin/gen-env.py)" >&2; exit 1; }
  [ "$(cd "$(dirname "$env_file")" && pwd)" = "$ROOT" ] || { echo "smoke: env files must live in $ROOT" >&2; exit 1; }
done
# Absolute paths, so the script works from any working directory.
IRON_ENV="$ROOT/$(basename "$IRON_ENV")"
STAR_ENV="$ROOT/$(basename "$STAR_ENV")"

compose() {
  # compose <project> <env-file> <docker compose args...>
  local project="$1" env_file="$2"
  shift 2
  ENV_FILE="$(basename "$env_file")" \
    docker compose -p "$project" --env-file "$env_file" -f "$ROOT/docker-compose.yml" "$@"
}

get_var() { grep -E "^$2=" "$1" | cut -d= -f2- || true; }

IRON_PORT="$(get_var "$IRON_ENV" API_GW_HTTP_PORT)"
STAR_PORT="$(get_var "$STAR_ENV" API_GW_HTTP_PORT)"
IRON_ANON="$(get_var "$IRON_ENV" ANON_KEY)"
STAR_ANON="$(get_var "$STAR_ENV" ANON_KEY)"
IRON_SERVICE_ROLE="$(get_var "$IRON_ENV" SERVICE_ROLE_KEY)"
STAR_SERVICE_ROLE="$(get_var "$STAR_ENV" SERVICE_ROLE_KEY)"
IRON_SITE_PORT="$(get_var "$IRON_ENV" SITE_HTTP_PORT)"
STAR_SITE_PORT="$(get_var "$STAR_ENV" SITE_HTTP_PORT)"
[ -n "$IRON_PORT" ] && [ -n "$STAR_PORT" ] && [ -n "$IRON_ANON" ] && [ -n "$STAR_ANON" ] \
  || { echo "smoke: API_GW_HTTP_PORT and ANON_KEY must be set in both env files" >&2; exit 1; }
[ -n "$IRON_SERVICE_ROLE" ] && [ -n "$STAR_SERVICE_ROLE" ] \
  || { echo "smoke: SERVICE_ROLE_KEY must be set in both env files" >&2; exit 1; }
[ "$IRON_PORT" != "$STAR_PORT" ] || { echo "smoke: both copies use port $IRON_PORT" >&2; exit 1; }
[ -n "$IRON_SITE_PORT" ] && [ -n "$STAR_SITE_PORT" ] \
  || { echo "smoke: SITE_HTTP_PORT must be set in both env files" >&2; exit 1; }
[ "$IRON_SITE_PORT" != "$STAR_SITE_PORT" ] || { echo "smoke: both copies use site port $IRON_SITE_PORT" >&2; exit 1; }
[ "$IRON_ANON" != "$STAR_ANON" ] || { echo "smoke: both copies share one ANON_KEY" >&2; exit 1; }

cleanup() {
  echo "smoke: bringing both copies down"
  compose ironsworn "$IRON_ENV" down >/dev/null 2>&1 || true
  compose starforged "$STAR_ENV" down >/dev/null 2>&1 || true
}
if [ "$CLEANUP" = "1" ]; then
  trap cleanup EXIT
fi

echo "smoke: starting ironsworn (port $IRON_PORT) and starforged (port $STAR_PORT)"
compose ironsworn "$IRON_ENV" up -d
compose starforged "$STAR_ENV" up -d

wait_for() {
  # wait_for <label> <curl args...>: polls until curl succeeds (up to 5 min).
  local label="$1"
  shift
  local deadline=$((SECONDS + 300))
  until curl -sf "$@" >/dev/null 2>&1; do
    [ "$SECONDS" -ge "$deadline" ] && { echo "smoke: timed out waiting for $label" >&2; return 1; }
    sleep 5
  done
  echo "smoke: $label up"
}

poll_for() {
  # poll_for <label> <command...>: reruns the command until it succeeds (up to 5 min).
  local label="$1"
  shift
  local deadline=$((SECONDS + 300))
  until "$@" >/dev/null 2>&1; do
    [ "$SECONDS" -ge "$deadline" ] && { echo "smoke: timed out waiting for $label" >&2; return 1; }
    sleep 5
  done
  echo "smoke: $label ok"
}

realtime_healthy() {
  # realtime_healthy <project> <env-file> <anon-key>
  compose "$1" "$2" exec -T realtime \
    curl -sSfL --head -o /dev/null \
    -H "Authorization: Bearer $3" \
    http://localhost:4000/api/tenants/realtime-dev/health
}

functions_placeholder_ok() {
  # functions_placeholder_ok <gateway-url> <anon-key>
  curl -s -H "apikey: $2" "$1/functions/v1/smoke-probe" | grep -q FUNCTIONS_NOT_CONFIGURED
}

migrate_done() {
  # migrate_done <project> <env-file>
  compose "$1" "$2" logs migrate 2>/dev/null | grep -q "migrate: done"
}

check_copy() {
  # check_copy <project> <env-file> <port> <anon-key> <service-key>
  local project="$1" env_file="$2" port="$3" key="$4" service_key="$5"
  local gw="http://localhost:$port"

  wait_for "$project auth" -H "apikey: $key" "$gw/auth/v1/health"
  # The gateway's OpenAPI route only admits the service key; table reads
  # below go through the anon key like a real client.
  wait_for "$project rest" -H "apikey: $service_key" "$gw/rest/v1/"
  wait_for "$project storage" "$gw/storage/v1/status"
  poll_for "$project realtime" realtime_healthy "$project" "$env_file" "$key"
  poll_for "$project functions" functions_placeholder_ok "$gw" "$key"
  poll_for "$project migrations" migrate_done "$project" "$env_file"
}

check_copy ironsworn "$IRON_ENV" "$IRON_PORT" "$IRON_ANON" "$IRON_SERVICE_ROLE"
check_copy starforged "$STAR_ENV" "$STAR_PORT" "$STAR_ANON" "$STAR_SERVICE_ROLE"

check_site() {
  # check_site <project> <site-port> <expected-brand>: the copy's site
  # serves the built site carrying its own game system's branding.
  local project="$1" port="$2" title="$3"

  wait_for "$project site" "http://localhost:$port/"
  curl -sf "http://localhost:$port/" | grep -q "$title" \
    || { echo "smoke: $project site does not serve $title branding" >&2; return 1; }
  echo "smoke: $project site serves $title"
}

check_site ironsworn "$IRON_SITE_PORT" "Iron Fellowship"
check_site starforged "$STAR_SITE_PORT" "Crew Link"

# The two copies must live on separate Docker networks (per-project networks).
for project in ironsworn starforged; do
  docker network ls --format '{{.Name}}' | grep -q "^${project}_default$" \
    || { echo "smoke: network ${project}_default missing" >&2; exit 1; }
done
echo "smoke: both copies side by side on isolated networks"

echo "smoke: OK - both copies healthy"
