-- Campaign outline: one GM-only note per campaign (ticket #131, part of spec #10).
--
-- The outline marks one campaign_notes row per campaign with kind 'outline'.
-- It holds the planned story, is shared by all of the campaign's GMs, and
-- is edited in the assistant panel's Outline tab with the same editor as
-- other notes. The database enforces the ticket's rules:
-- - at most one outline per campaign (partial unique index below);
-- - the outline is never shared with players: a CHECK keeps shared false
--   on outline rows, and the update guard refuses sharing flips and kind
--   changes (kind is immutable once written);
-- - only GMs of the campaign read or write it: outline rows stay unshared,
--   so the existing visibility helper (shared OR GM) already hides them
--   from players and outsiders over REST, live updates and the note
--   server (Hocuspocus reuses the same helpers), while the tightened
--   insert/update/delete policies below additionally require GM membership
--   for any outline write, so even the author check cannot let a player
--   create or touch one.
--
-- Ordinary notes are unaffected: kind defaults to 'note', and every new
-- predicate passes for non-outline rows exactly as before.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand.
-- Never edit an applied migration; add a new file instead.

BEGIN;

-- Marks the outline row. Existing rows (and every addNote insert, which
-- names no kind) default to ordinary notes.
ALTER TABLE public.campaign_notes
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'note';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_notes_kind_allowed') THEN
    ALTER TABLE public.campaign_notes
      ADD CONSTRAINT campaign_notes_kind_allowed CHECK (kind IN ('note', 'outline'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_notes_outline_unshared') THEN
    ALTER TABLE public.campaign_notes
      ADD CONSTRAINT campaign_notes_outline_unshared CHECK (kind <> 'outline' OR shared = false);
  END IF;
END $$;

-- At most one outline per campaign. The data layer treats a violation as
-- a lost creation race against a co-GM and re-reads the winner's row.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_notes_single_outline
  ON public.campaign_notes (campaign_id) WHERE kind = 'outline';

-- Outline rows stay outline rows and stay unshared: kind never changes,
-- and no update may leave an outline shared. Service-key work with no
-- signed-in person (migrations, auth-user deletes) bypasses the guard, as
-- the note guard it sits beside does.
CREATE OR REPLACE FUNCTION private.enforce_campaign_outline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'note kind cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.kind = 'outline' AND NEW.shared THEN
    RAISE EXCEPTION 'the campaign outline is never shared' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaign_notes_guard_outline ON public.campaign_notes;
CREATE TRIGGER campaign_notes_guard_outline
  BEFORE UPDATE ON public.campaign_notes
  FOR EACH ROW EXECUTE FUNCTION private.enforce_campaign_outline();

-- Outline writes are GM-only. Reads need no change: outline rows are
-- always unshared, so the existing shared-or-GM visibility already hides
-- them from players and outsiders over REST, live updates and the note
-- server. In the USING clause `kind` names the old row; in WITH CHECK it
-- names the new row.
DROP POLICY IF EXISTS "campaign_notes_insert_members" ON public.campaign_notes;
CREATE POLICY "campaign_notes_insert_members" ON public.campaign_notes
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_member(campaign_id)
    AND created_by = (select auth.uid())
    AND (kind IS DISTINCT FROM 'outline' OR private.is_campaign_gm(campaign_id))
  );

DROP POLICY IF EXISTS "campaign_notes_update_members" ON public.campaign_notes;
CREATE POLICY "campaign_notes_update_members" ON public.campaign_notes
  FOR UPDATE TO authenticated
  USING (
    (
      private.is_campaign_note_visible(id)
      OR (created_by = (select auth.uid()) AND private.is_campaign_member(campaign_id))
      OR private.is_campaign_gm(campaign_id)
    )
    AND (kind IS DISTINCT FROM 'outline' OR private.is_campaign_gm(campaign_id))
  )
  WITH CHECK (
    (
      private.is_campaign_note_visible(id)
      OR (created_by = (select auth.uid()) AND private.is_campaign_member(campaign_id))
      OR private.is_campaign_gm(campaign_id)
    )
    AND (kind IS DISTINCT FROM 'outline' OR private.is_campaign_gm(campaign_id))
  );

DROP POLICY IF EXISTS "campaign_notes_delete_members" ON public.campaign_notes;
CREATE POLICY "campaign_notes_delete_members" ON public.campaign_notes
  FOR DELETE TO authenticated USING (
    (
      (created_by = (select auth.uid()) AND private.is_campaign_member(campaign_id))
      OR private.is_campaign_gm(campaign_id)
    )
    AND (kind IS DISTINCT FROM 'outline' OR private.is_campaign_gm(campaign_id))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_notes TO authenticated;

COMMIT;
