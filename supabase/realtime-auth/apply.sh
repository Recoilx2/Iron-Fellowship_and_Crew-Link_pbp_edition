#!/bin/sh
# Applies supabase/realtime-auth/*.sql after live updates boots.
#
# The realtime.messages table (and its RLS) is created by the realtime tenant
# setup at boot, so channel policies cannot live in supabase/migrations/:
# the migrate service finishes before realtime starts. This script polls until
# the table exists, then reuses migrate/apply.sh, which records each file in
# supabase_migrations.applied so restarts and upgrades apply each file once.
set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
PGHOST=db
PGPORT="${POSTGRES_PORT:-5432}"
PGDATABASE="${POSTGRES_DB:-postgres}"
PGUSER=postgres
export PGHOST PGPORT PGDATABASE PGUSER
export PGPASSWORD="$POSTGRES_PASSWORD"

i=0
until psql -v ON_ERROR_STOP=1 -qAt \
    -c "SELECT 1 FROM realtime.messages LIMIT 0;" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 60 ] \
    && { echo "realtime-auth: timed out waiting for realtime.messages" >&2; exit 1; }
  sleep 5
done

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/realtime-auth}" /migrate/apply.sh
