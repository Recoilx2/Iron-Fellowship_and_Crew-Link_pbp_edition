-- Vendored from supabase/supabase docker/volumes/db/jwt.sql @ 189adda9 (Apache-2.0).
-- Mounted read-only into the db container; see supabase/docker-compose.yml.

\set jwt_exp `echo "$JWT_EXP"`

ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
