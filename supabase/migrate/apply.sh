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
# - Files may read deployment settings as psql variables passed on the PSQL
#   line below (e.g. CHAT_IMAGE_MAX_MB, defaulting here); keep the same
#   defaults as the example env file.
set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
PGHOST=db
PGPORT="${POSTGRES_PORT:-5432}"
PGDATABASE="${POSTGRES_DB:-postgres}"
PGUSER=postgres
export PGHOST PGPORT PGDATABASE PGUSER
export PGPASSWORD="$POSTGRES_PASSWORD"

PSQL="psql -v ON_ERROR_STOP=1 -qAt -v CHAT_IMAGE_MAX_MB=${CHAT_IMAGE_MAX_MB:-10}"
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

# Chat image size (spec #9, ticket #118): one deployment setting,
# CHAT_IMAGE_MAX_MB (default 10 MB), drives the chat-images bucket cap on
# every start. Migrations run once and applied files are skipped above, so
# the cap would otherwise freeze at its first value while the site bakes
# the same setting into the composer cap at every build. The stored cap is
# rewritten here and re-checked at once: the start fails when the bucket
# and the setting disagree, so the bucket and the client can never drift
# apart silently.
chat_image_max_mb="${CHAT_IMAGE_MAX_MB:-10}"
case "$chat_image_max_mb" in
  ''|*[!0-9]*|0*)
    echo "migrate: invalid CHAT_IMAGE_MAX_MB '${CHAT_IMAGE_MAX_MB:-}' (want a positive integer, megabytes)" >&2
    exit 1
    ;;
esac
chat_image_bytes=$((chat_image_max_mb * 1048576))
$PSQL -c "DO \$cap\$ BEGIN UPDATE storage.buckets SET public = false, file_size_limit = ${chat_image_bytes}, allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp'] WHERE id = 'chat-images'; IF NOT FOUND THEN INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('chat-images', 'chat-images', false, ${chat_image_bytes}, ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp']); END IF; IF (SELECT file_size_limit FROM storage.buckets WHERE id = 'chat-images') IS DISTINCT FROM ${chat_image_bytes} THEN RAISE EXCEPTION 'chat-images bucket cap % bytes disagrees with CHAT_IMAGE_MAX_MB=%', (SELECT file_size_limit FROM storage.buckets WHERE id = 'chat-images'), ${chat_image_max_mb}; END IF; END \$cap\$;"
echo "migrate: chat-images cap is ${chat_image_bytes} bytes (CHAT_IMAGE_MAX_MB=${chat_image_max_mb})"
echo "migrate: done, $applied of $pending pending migration(s) applied"
