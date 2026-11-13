-- Campaign note access: strict writes and revoke-on-access-loss (#106).
--
-- Part of spec #11. Two gaps from the #20 review (PR #48):
--
-- 1. Losing campaign access must cut live note access. `note_access_revoked`
--    used to fire only on unshare/delete. It now also fires when a roster
--    row vanishes (member removed), when a GM is demoted to player, when a
--    character leaves its campaign, and when a world stops being used by a
--    campaign. The payloads stay per-document (`campaign-notes/<id>`,
--    `character-notes/<id>`, `world-notes/<id>`,
--    `world-descriptions/<id>`), so the note server re-checks each
--    connected reader with no server change.
--
-- 2. Campaign note writes must not be looser than reads (human decision on
--    #106: strict rules; the old Firestore rules let any signed-in person
--    do all four, which is the gap spec #11 closes, not behaviour to keep):
--    - `created_by` records the author, defaulting to the signed-in person;
--      existing rows take their campaign's first GM (no production data, any
--      backfill is fine).
--    - `private.is_campaign_note_writable` reuses the visibility helper, so
--      note contents are writable exactly where they are readable.
--    - Row UPDATEs stay readable on both sides, and additionally pass for
--      the author while they remain a member (so authors can share their
--      own drafts before a GM shares them); a BEFORE UPDATE guard locks
--      `campaign_id` (and `created_by`) and lets only a member-author or a
--      campaign GM flip `shared`. Service-key work with no signed-in person
--      (backfills, auth-user deletes) bypasses the guard.
--    - DELETEs are member-author-or-GM only, so a removed author loses write
--      access at once. Members still retitle/reorder and edit
--      the contents of the shared notes they can see, as before.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; every statement below is guarded for safe re-runs. It
-- runs after the campaigns, characters, campaign notes and worlds migrations.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- The author of each campaign note. Legacy rows (including the stack-test
-- fixtures) take their campaign's first GM; rows with no GM keep NULL and
-- stay GM-managed only.
ALTER TABLE public.campaign_notes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

UPDATE public.campaign_notes AS n
SET created_by = (
  SELECT m.user_id FROM public.campaign_members AS m
  WHERE m.campaign_id = n.campaign_id AND m.role = 'gm'
  ORDER BY m.created_at LIMIT 1
)
WHERE n.created_by IS NULL
  AND EXISTS (
    SELECT 1 FROM public.campaign_members AS m
    WHERE m.campaign_id = n.campaign_id AND m.role = 'gm'
  );

-- New rows default to the signed-in person when the client sends none.
CREATE OR REPLACE FUNCTION private.set_campaign_note_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := (select auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaign_notes_set_author ON public.campaign_notes;
CREATE TRIGGER campaign_notes_set_author
  BEFORE INSERT ON public.campaign_notes
  FOR EACH ROW EXECUTE FUNCTION private.set_campaign_note_author();

-- Field-level write rules the row policies cannot express (they see only one
-- side of the row): notes never move campaigns, authors never change, and
-- only the author or a campaign GM flips `shared`.
CREATE OR REPLACE FUNCTION private.enforce_campaign_note_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Service-key work (migrations, auth-user deletes that SET NULL the
  -- author) runs with no signed-in person; row policies are bypassed there,
  -- so the trigger must not block it.
  IF (select auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
    RAISE EXCEPTION 'campaign_id cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'note author cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.shared IS DISTINCT FROM OLD.shared
    AND NOT (
      (OLD.created_by IS NOT DISTINCT FROM (select auth.uid())
        AND private.is_campaign_member(OLD.campaign_id))
      OR private.is_campaign_gm(OLD.campaign_id)
    )
  THEN
    RAISE EXCEPTION 'only the note author or a campaign GM changes sharing' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaign_notes_guard_update ON public.campaign_notes;
CREATE TRIGGER campaign_notes_guard_update
  BEFORE UPDATE ON public.campaign_notes
  FOR EACH ROW EXECUTE FUNCTION private.enforce_campaign_note_update();

-- Writable implies visible: contents are writable exactly where readable.
CREATE OR REPLACE FUNCTION private.is_campaign_note_writable(nid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_campaign_note_visible(nid);
$$;

-- Row policies, re-created on the strict rules. UPDATE passes for readers on
-- both sides, and additionally for the author (so authors can share their own
-- drafts) and GMs; the author branch still requires campaign membership so a
-- removed author loses write access at once. The guard above still rejects
-- non-author shared-flips and every campaign move.
DROP POLICY IF EXISTS "campaign_notes_insert_members" ON public.campaign_notes;
CREATE POLICY "campaign_notes_insert_members" ON public.campaign_notes
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_member(campaign_id)
    AND created_by = (select auth.uid())
  );

DROP POLICY IF EXISTS "campaign_notes_update_members" ON public.campaign_notes;
CREATE POLICY "campaign_notes_update_members" ON public.campaign_notes
  FOR UPDATE TO authenticated
  USING (
    private.is_campaign_note_visible(id)
    OR (created_by = (select auth.uid()) AND private.is_campaign_member(campaign_id))
    OR private.is_campaign_gm(campaign_id)
  )
  WITH CHECK (
    private.is_campaign_note_visible(id)
    OR (created_by = (select auth.uid()) AND private.is_campaign_member(campaign_id))
    OR private.is_campaign_gm(campaign_id)
  );

DROP POLICY IF EXISTS "campaign_notes_delete_members" ON public.campaign_notes;
CREATE POLICY "campaign_notes_delete_members" ON public.campaign_notes
  FOR DELETE TO authenticated USING (
    (created_by = (select auth.uid()) AND private.is_campaign_member(campaign_id))
    OR private.is_campaign_gm(campaign_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_notes TO authenticated;

-- Revoke fan-out: one `note_access_revoked` payload per document that may
-- have lost readers. The note server re-checks every connected reader of
-- each named document against the same visibility helpers the policies use,
-- and closes the ones who just lost access; readers who are still allowed
-- stay connected, so over-notifying is safe.
CREATE OR REPLACE FUNCTION private.notify_campaign_notes_for_campaign(cid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  nid uuid;
  wid uuid;
BEGIN
  FOR nid IN SELECT id FROM public.campaign_notes WHERE campaign_id = cid LOOP
    PERFORM pg_notify('note_access_revoked', 'campaign-notes/' || nid::text);
  END LOOP;
  FOR nid IN
    SELECT n.id FROM public.character_notes AS n
    JOIN public.characters AS c ON c.id = n.character_id
    WHERE c.campaign_id = cid
  LOOP
    PERFORM pg_notify('note_access_revoked', 'character-notes/' || nid::text);
  END LOOP;
  SELECT world_id INTO wid FROM public.campaigns WHERE id = cid;
  IF wid IS NOT NULL THEN
    FOR nid IN SELECT id FROM public.world_notes WHERE world_id = wid LOOP
      PERFORM pg_notify('note_access_revoked', 'world-notes/' || nid::text);
    END LOOP;
    PERFORM pg_notify('note_access_revoked', 'world-descriptions/' || wid::text);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.notify_notes_on_campaign_member_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.notify_campaign_notes_for_campaign(COALESCE(NEW.campaign_id, OLD.campaign_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS campaign_members_revoke_notify_delete ON public.campaign_members;
CREATE TRIGGER campaign_members_revoke_notify_delete
  AFTER DELETE ON public.campaign_members
  FOR EACH ROW EXECUTE FUNCTION private.notify_notes_on_campaign_member_change();

DROP TRIGGER IF EXISTS campaign_members_revoke_notify_demote ON public.campaign_members;
CREATE TRIGGER campaign_members_revoke_notify_demote
  AFTER UPDATE OF role ON public.campaign_members
  FOR EACH ROW
  WHEN (OLD.role = 'gm' AND NEW.role = 'player')
  EXECUTE FUNCTION private.notify_notes_on_campaign_member_change();

CREATE OR REPLACE FUNCTION private.notify_notes_on_character_campaign_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  nid uuid;
BEGIN
  FOR nid IN SELECT id FROM public.character_notes WHERE character_id = NEW.id LOOP
    PERFORM pg_notify('note_access_revoked', 'character-notes/' || nid::text);
  END LOOP;
  IF OLD.campaign_id IS NOT NULL THEN
    FOR nid IN SELECT id FROM public.campaign_notes WHERE campaign_id = OLD.campaign_id LOOP
      PERFORM pg_notify('note_access_revoked', 'campaign-notes/' || nid::text);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS characters_campaign_leave_notify ON public.characters;
CREATE TRIGGER characters_campaign_leave_notify
  AFTER UPDATE OF campaign_id ON public.characters
  FOR EACH ROW
  WHEN (OLD.campaign_id IS DISTINCT FROM NEW.campaign_id)
  EXECUTE FUNCTION private.notify_notes_on_character_campaign_change();

CREATE OR REPLACE FUNCTION private.notify_notes_on_campaign_world_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  nid uuid;
BEGIN
  IF OLD.world_id IS NOT NULL THEN
    FOR nid IN SELECT id FROM public.world_notes WHERE world_id = OLD.world_id LOOP
      PERFORM pg_notify('note_access_revoked', 'world-notes/' || nid::text);
    END LOOP;
    PERFORM pg_notify('note_access_revoked', 'world-descriptions/' || OLD.world_id::text);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS campaigns_world_unlink_notify ON public.campaigns;
CREATE TRIGGER campaigns_world_unlink_notify
  AFTER UPDATE OF world_id ON public.campaigns
  FOR EACH ROW
  WHEN (OLD.world_id IS DISTINCT FROM NEW.world_id)
  EXECUTE FUNCTION private.notify_notes_on_campaign_world_change();

DROP TRIGGER IF EXISTS campaigns_delete_world_notify ON public.campaigns;
CREATE TRIGGER campaigns_delete_world_notify
  AFTER DELETE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_notes_on_campaign_world_change();

COMMIT;
