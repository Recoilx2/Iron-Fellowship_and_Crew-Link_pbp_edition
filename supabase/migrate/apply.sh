#!/bin/sh
# Applies supabase/migrations/*.sql in filename order and records each file in
# supabase_migrations.applied, so `docker compose up` and upgrades are safe to
# repeat. Runs once per stack start inside the `migrate` service (see
# docker-compose.yml); the data services wait for it to finish successfully.
#
# Conventions for migration files (enforced by later tickets' schema work):
# - Name files <UTC timestamp>_<short-name>.sql, e.g. 20261112000000_campaigns.sql.
# - Every file must be safe to run once against an empty database. Wrap the
#   body in a transaction when a half-applied file must never persist.
set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
PGHOST=db
PGPORT="${POSTGRES_PORT:-5432}"
PGDATABASE="${POSTGRES_DB:-postgres}"
PGUSER=postgres
export PGHOST PGPORT PGDATABASE PGUSER
export PGPASSWORD="$POSTGRES_PASSWORD"

PSQL="psql -v ON_ERROR_STOP=1 -qAt"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

$PSQL -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations;" \
      -c "CREATE TABLE IF NOT EXISTS supabase_migrations.applied (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

pending=0
applied=0
for file in "$MIGRATIONS_DIR"/*.sql; do
  # Nullglob: the directory starts out empty, so skip the literal pattern.
  [ -e "$file" ] || continue
  name=$(basename "$file")
  if [ "$($PSQL -c "SELECT 1 FROM supabase_migrations.applied WHERE name = '$name';")" = "1" ]; then
    echo "migrate: already applied, skipping: $name"
    continue
  fi
  pending=$((pending + 1))
  echo "migrate: applying: $name"
  $PSQL -f "$file"
  $PSQL -c "INSERT INTO supabase_migrations.applied (name) VALUES ('$name');"
  applied=$((applied + 1))
done
echo "migrate: done, $applied of $pending pending migration(s) applied"
