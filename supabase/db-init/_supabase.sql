-- Vendored from supabase/supabase docker/volumes/db/_supabase.sql @ 189adda9 (Apache-2.0).
-- Mounted read-only into the db container; see supabase/docker-compose.yml.

\set pguser `echo "$POSTGRES_USER"`

CREATE DATABASE _supabase WITH OWNER :pguser;
