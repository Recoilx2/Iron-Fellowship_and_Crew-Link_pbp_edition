-- Assistant proposal state: remember applied and dismissed outline proposals (#148, part of spec #10).
--
-- A reply can carry an outline proposal. Until now a dismissal lived only in
-- component state, and an Apply left no trace on the reply, so after a reload
-- old proposals offered Apply again, and Undo restored the campaign's newest
-- outline version instead of the one the reply's Apply kept.
--
-- The outcome is recorded on the assistant message that carried the proposal:
--   proposal_state      NULL (no outcome yet, or undone from the reply),
--                       'applied' or 'dismissed'. An Undo from the Outline tab,
--                       a co-GM's Undo or a prune leaves 'applied' with a NULL
--                       applied_version_id (the reply then offers neither
--                       Apply nor Undo).
--   applied_version_id  the outline version that reply's Apply kept, for Undo
--
-- applied_version_id references the kept version and is cleared by the
-- database when that version row goes away (undone, or pruned past the
-- retention cap), so a reloaded reply offers Undo only while its version
-- still exists. Only an applied assistant reply may carry a state or a
-- version.
--
-- Access is unchanged: the existing assistant_messages policies already
-- limit every read and write to the owning GM of the conversation (while
-- still a GM of its campaign), so a co-GM, a player or an outsider can
-- neither read nor set a proposal state. The messages table is already in
-- the realtime publication and its channel family is already allowed, so
-- the supabase/realtime-auth folder needs no new file.
--
-- Conventions: see supabase/migrations/README.md. Additive only and safe to
-- re-run: columns and the constraint are guarded. It runs after the
-- assistant conversations and outline versions migrations it builds on.

BEGIN;

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS proposal_state text NULL;

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS applied_version_id uuid NULL
    REFERENCES public.assistant_outline_versions (id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assistant_messages_proposal_state_valid'
      AND conrelid = 'public.assistant_messages'::regclass
  ) THEN
    ALTER TABLE public.assistant_messages
      ADD CONSTRAINT assistant_messages_proposal_state_valid CHECK (
        (proposal_state IS NULL OR (proposal_state IN ('applied', 'dismissed') AND role = 'assistant'))
        AND (applied_version_id IS NULL OR proposal_state = 'applied')
      );
  END IF;
END $$;

COMMIT;
