-- Index assistant_messages by the version an Apply kept (ticket #151, from
-- the PR #162 review).
--
-- assistant_messages.applied_version_id (20261121000007) is referenced by
-- assistant_outline_versions with ON DELETE SET NULL: every version delete
-- (an Undo, or the retention prune) scans this table for rows pointing at
-- it, and without an index each one read the whole table. At today's sizes
-- that is fine; this partial index keeps it fine as conversations grow,
-- while staying tiny (only applied replies are in it).
--
-- Conventions: see supabase/migrations/README.md. Never edit an applied
-- migration; add a new file instead.

BEGIN;

CREATE INDEX IF NOT EXISTS assistant_messages_applied_version
  ON public.assistant_messages (applied_version_id)
  WHERE applied_version_id IS NOT NULL;

COMMIT;
