-- Campaign notes, with one content row per note holding the editor bytes.
--
-- Campaign notes are readable by members when shared; unshared notes stay
-- visible to GMs only, so unsharing hides a note from players at the
-- database, not just in the interface. Every member may write the notes of
-- their campaigns. The note server (Hocuspocus, ticket #20) reads and writes
-- the content rows directly and enforces the same checks when someone
-- connects: each Yjs document is one content row.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand. It
-- runs after the campaigns migration, so campaigns, campaign_members and the
-- shared updated_at trigger already exist.
--
-- Notes for later tickets:
-- - World notes stay on Firebase until the worlds ticket ports them onto the
--   same note server; the revoke trigger below already covers character
--   notes so both scopes cut revoked editors live from day one.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- Members read the notes shared with their campaign; GMs read every note,
-- including unshared drafts. Outsiders read nothing.
CREATE OR REPLACE FUNCTION private.is_campaign_note_visible(nid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_notes n
    WHERE n.id = nid
      AND private.is_campaign_member(n.campaign_id)
      AND (n.shared OR private.is_campaign_gm(n.campaign_id))
  );
$$;

-- Any member may write the notes of their campaigns, shared or not.
CREATE OR REPLACE FUNCTION private.is_campaign_note_writable(nid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_notes n
    WHERE n.id = nid
      AND private.is_campaign_member(n.campaign_id)
  );
$$;

CREATE TABLE IF NOT EXISTS public.campaign_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New Page',
  shared boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_notes_by_campaign
  ON public.campaign_notes (campaign_id);

ALTER TABLE public.campaign_notes ENABLE ROW LEVEL SECURITY;

-- Unshared notes stay GM-only; members see exactly the shared ones.
DROP POLICY IF EXISTS "campaign_notes_select_shared_or_gm" ON public.campaign_notes;
CREATE POLICY "campaign_notes_select_shared_or_gm" ON public.campaign_notes
  FOR SELECT TO authenticated USING (
    private.is_campaign_note_visible(id)
  );

DROP POLICY IF EXISTS "campaign_notes_insert_members" ON public.campaign_notes;
CREATE POLICY "campaign_notes_insert_members" ON public.campaign_notes
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_member(campaign_id)
  );

DROP POLICY IF EXISTS "campaign_notes_update_members" ON public.campaign_notes;
CREATE POLICY "campaign_notes_update_members" ON public.campaign_notes
  FOR UPDATE TO authenticated
  USING (private.is_campaign_member(campaign_id))
  WITH CHECK (private.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "campaign_notes_delete_members" ON public.campaign_notes;
CREATE POLICY "campaign_notes_delete_members" ON public.campaign_notes
  FOR DELETE TO authenticated USING (
    private.is_campaign_member(campaign_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_notes TO authenticated;

DROP TRIGGER IF EXISTS campaign_notes_updated_at ON public.campaign_notes;
CREATE TRIGGER campaign_notes_updated_at
  BEFORE UPDATE ON public.campaign_notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

-- One row per campaign note holding the editor content as base64. The bytes
-- stay opaque to the database; the note server and the client encode and
-- decode them at their edges (see src/api-calls/notes/noteContent.ts).
CREATE TABLE IF NOT EXISTS public.campaign_note_contents (
  note_id uuid PRIMARY KEY REFERENCES public.campaign_notes (id) ON DELETE CASCADE,
  content text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_note_contents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_note_contents_select_visible" ON public.campaign_note_contents;
CREATE POLICY "campaign_note_contents_select_visible" ON public.campaign_note_contents
  FOR SELECT TO authenticated USING (
    private.is_campaign_note_visible(note_id)
  );

DROP POLICY IF EXISTS "campaign_note_contents_insert_writable" ON public.campaign_note_contents;
CREATE POLICY "campaign_note_contents_insert_writable" ON public.campaign_note_contents
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_note_writable(note_id)
  );

DROP POLICY IF EXISTS "campaign_note_contents_update_writable" ON public.campaign_note_contents;
CREATE POLICY "campaign_note_contents_update_writable" ON public.campaign_note_contents
  FOR UPDATE TO authenticated
  USING (private.is_campaign_note_writable(note_id))
  WITH CHECK (private.is_campaign_note_writable(note_id));

DROP POLICY IF EXISTS "campaign_note_contents_delete_writable" ON public.campaign_note_contents;
CREATE POLICY "campaign_note_contents_delete_writable" ON public.campaign_note_contents
  FOR DELETE TO authenticated USING (
    private.is_campaign_note_writable(note_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_note_contents TO authenticated;

DROP TRIGGER IF EXISTS campaign_note_contents_updated_at ON public.campaign_note_contents;
CREATE TRIGGER campaign_note_contents_updated_at
  BEFORE UPDATE ON public.campaign_note_contents
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

-- Live revocation for the note server: when a note stops being shared, or is
-- deleted, tell the server which document lost readers so it can close the
-- connections of everyone who just lost access. The document name travels as
-- the payload; the server re-checks each connected reader against the same
-- visibility helpers the policies use above.
CREATE OR REPLACE FUNCTION private.notify_note_access_revoked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  doc text;
BEGIN
  doc := CASE TG_TABLE_NAME
    WHEN 'character_notes' THEN 'character-notes/'
    WHEN 'campaign_notes' THEN 'campaign-notes/'
    ELSE 'notes/'
  END || COALESCE(NEW.id, OLD.id)::text;
  PERFORM pg_notify('note_access_revoked', doc);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS character_notes_revoke_notify ON public.character_notes;
CREATE TRIGGER character_notes_revoke_notify
  AFTER UPDATE OF shared ON public.character_notes
  FOR EACH ROW
  WHEN (OLD.shared AND NOT NEW.shared)
  EXECUTE FUNCTION private.notify_note_access_revoked();

DROP TRIGGER IF EXISTS character_notes_delete_notify ON public.character_notes;
CREATE TRIGGER character_notes_delete_notify
  AFTER DELETE ON public.character_notes
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_note_access_revoked();

DROP TRIGGER IF EXISTS campaign_notes_revoke_notify ON public.campaign_notes;
CREATE TRIGGER campaign_notes_revoke_notify
  AFTER UPDATE OF shared ON public.campaign_notes
  FOR EACH ROW
  WHEN (OLD.shared AND NOT NEW.shared)
  EXECUTE FUNCTION private.notify_note_access_revoked();

DROP TRIGGER IF EXISTS campaign_notes_delete_notify ON public.campaign_notes;
CREATE TRIGGER campaign_notes_delete_notify
  AFTER DELETE ON public.campaign_notes
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_note_access_revoked();

-- Member-visible rows stream as plain row changes: each subscriber's channel
-- is filtered to the rows they may see, and row-level security drops the
-- rest. The migrate service runs before live updates boots, so the
-- publication may not exist yet: create it when missing, and never add the
-- same table twice.
ALTER TABLE public.campaign_notes REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_note_contents REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'campaign_notes',
    'campaign_note_contents'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
