-- Vendored from supabase/supabase docker/volumes/db/realtime.sql @ 189adda9 (Apache-2.0).
-- Mounted read-only into the db container; see supabase/docker-compose.yml.

\set pguser `echo "$POSTGRES_USER"`

create schema if not exists _realtime;
alter schema _realtime owner to :pguser;
