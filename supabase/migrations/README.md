# Database migrations

SQL files in this directory are applied automatically on every stack start by
the `migrate` service (see `supabase/migrate/apply.sh`): in filename order,
each exactly once, tracked in `supabase_migrations.applied`. Upgrading is
pulling and restarting; a failed file aborts the run with an error so the data
services never boot on a half-migrated database.

Conventions (followed by the schema tickets that add files here):

- Name files `<UTC timestamp>_<short-name>.sql`, e.g.
  `20261112000000_campaigns.sql`. Timestamps order the files; never rename a
  file that has already run anywhere.
- Every file must run cleanly once against an empty database. Prefer
  `CREATE TABLE IF NOT EXISTS` / `DO` guards for objects that older copies of
  the stack may already have, and wrap multi-statement changes in a
  transaction when a half-applied file must never persist.
- The app reads through PostgREST, which only exposes the schemas in
  `PGRST_DB_SCHEMAS` (default `public,graphql_public`). Keep bookkeeping
  objects such as `supabase_migrations` out of those schemas.
- Never edit a migration that has already been applied to a running copy;
  add a new file instead.
