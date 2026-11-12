-- Characters and everything that belongs to one character: assets, tracks,
-- notes (with their contents), settings and the solo roll log.
--
-- A character is owned by one person. The owner and the members of the
-- campaign the character plays in may read it; only the owner may change it.
-- Character notes add one refinement: members only see the notes the owner
-- shared, so unshared notes never leak. The campaign roll log belongs to the
-- chat spec and is out of scope; solo characters keep their own roll log here.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand.
--
-- Notes for later tickets:
-- - campaign_id and world_id have no foreign keys yet: the campaigns and
--   worlds tables land in later tickets, which add the references. Until then
--   the link is a plain uuid checked through campaign_members.
-- - Campaign members read characters through private.is_character_visible();
--   later tickets may move shared campaign data to database broadcasts, but
--   plain row streaming already reaches exactly the people allowed here.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- Visibility checks used by every character access rule. Security definer so
-- the checks run even for people with no direct grant on the tables; the
-- private schema is never exposed through the data API. Created before the
-- table policies below: Postgres resolves the functions a policy calls when
-- the policy is created.
CREATE OR REPLACE FUNCTION private.is_character_owner(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.characters
    WHERE id = cid AND owner_id = (select auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.is_character_visible(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.id = cid
      AND (
        c.owner_id = (select auth.uid())
        OR (
          c.campaign_id IS NOT NULL
          AND private.is_campaign_member(c.campaign_id)
        )
      )
  );
$$;

-- Character notes are shared with the campaign only when the owner marks
-- them shared; unshared notes stay owner-only.
CREATE OR REPLACE FUNCTION private.is_character_note_visible(nid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.character_notes n
    JOIN public.characters c ON c.id = n.character_id
    WHERE n.id = nid
      AND (
        c.owner_id = (select auth.uid())
        OR (
          n.shared
          AND c.campaign_id IS NOT NULL
          AND private.is_campaign_member(c.campaign_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.is_character_note_owner(nid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.character_notes n
    JOIN public.characters c ON c.id = n.character_id
    WHERE n.id = nid AND c.owner_id = (select auth.uid())
  );
$$;

CREATE TABLE IF NOT EXISTS public.characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  campaign_id uuid NULL,
  world_id uuid NULL,
  name text NOT NULL DEFAULT '',
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  condition_meters jsonb NOT NULL DEFAULT '{}'::jsonb,
  initiative_status text NULL,
  momentum integer NOT NULL DEFAULT 2,
  special_tracks jsonb NOT NULL DEFAULT '{}'::jsonb,
  experience jsonb NOT NULL DEFAULT '{}'::jsonb,
  debilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  adds integer NULL,
  profile_image jsonb NULL,
  expansion_ids text[] NOT NULL DEFAULT '{}',
  custom_tracks jsonb NOT NULL DEFAULT '{}'::jsonb,
  theme text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS characters_by_owner
  ON public.characters (owner_id);
CREATE INDEX IF NOT EXISTS characters_by_campaign
  ON public.characters (campaign_id);

ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "characters_select_owner_or_members" ON public.characters;
CREATE POLICY "characters_select_owner_or_members" ON public.characters
  FOR SELECT TO authenticated USING (
    private.is_character_visible(id)
  );

DROP POLICY IF EXISTS "characters_insert_own" ON public.characters;
CREATE POLICY "characters_insert_own" ON public.characters
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "characters_update_owner" ON public.characters;
CREATE POLICY "characters_update_owner" ON public.characters
  FOR UPDATE TO authenticated
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "characters_delete_owner" ON public.characters;
CREATE POLICY "characters_delete_owner" ON public.characters
  FOR DELETE TO authenticated USING (
    owner_id = (select auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.characters TO authenticated;

-- One shared updated_at trigger for every character table: the shared listen
-- helper drops buffered events older than the row it already holds.
CREATE OR REPLACE FUNCTION public.handle_character_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS characters_updated_at ON public.characters;
CREATE TRIGGER characters_updated_at
  BEFORE UPDATE ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.handle_character_updated_at();

CREATE TABLE IF NOT EXISTS public.character_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters (id) ON DELETE CASCADE,
  datasworn_id text NOT NULL DEFAULT '',
  enabled_abilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  option_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  control_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS character_assets_by_character
  ON public.character_assets (character_id);

ALTER TABLE public.character_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "character_assets_select_visible" ON public.character_assets;
CREATE POLICY "character_assets_select_visible" ON public.character_assets
  FOR SELECT TO authenticated USING (
    private.is_character_visible(character_id)
  );

DROP POLICY IF EXISTS "character_assets_insert_owner" ON public.character_assets;
CREATE POLICY "character_assets_insert_owner" ON public.character_assets
  FOR INSERT TO authenticated WITH CHECK (
    private.is_character_owner(character_id)
  );

DROP POLICY IF EXISTS "character_assets_update_owner" ON public.character_assets;
CREATE POLICY "character_assets_update_owner" ON public.character_assets
  FOR UPDATE TO authenticated
  USING (private.is_character_owner(character_id))
  WITH CHECK (private.is_character_owner(character_id));

DROP POLICY IF EXISTS "character_assets_delete_owner" ON public.character_assets;
CREATE POLICY "character_assets_delete_owner" ON public.character_assets
  FOR DELETE TO authenticated USING (
    private.is_character_owner(character_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.character_assets TO authenticated;

DROP TRIGGER IF EXISTS character_assets_updated_at ON public.character_assets;
CREATE TRIGGER character_assets_updated_at
  BEFORE UPDATE ON public.character_assets
  FOR EACH ROW EXECUTE FUNCTION public.handle_character_updated_at();

CREATE TABLE IF NOT EXISTS public.character_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters (id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'vow',
  description text NOT NULL DEFAULT '',
  value integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  difficulty text NULL,
  segments integer NULL,
  segments_filled integer NULL,
  oracle_key text NULL,
  created_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS character_tracks_by_character
  ON public.character_tracks (character_id);

ALTER TABLE public.character_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "character_tracks_select_visible" ON public.character_tracks;
CREATE POLICY "character_tracks_select_visible" ON public.character_tracks
  FOR SELECT TO authenticated USING (
    private.is_character_visible(character_id)
  );

DROP POLICY IF EXISTS "character_tracks_insert_owner" ON public.character_tracks;
CREATE POLICY "character_tracks_insert_owner" ON public.character_tracks
  FOR INSERT TO authenticated WITH CHECK (
    private.is_character_owner(character_id)
  );

DROP POLICY IF EXISTS "character_tracks_update_owner" ON public.character_tracks;
CREATE POLICY "character_tracks_update_owner" ON public.character_tracks
  FOR UPDATE TO authenticated
  USING (private.is_character_owner(character_id))
  WITH CHECK (private.is_character_owner(character_id));

DROP POLICY IF EXISTS "character_tracks_delete_owner" ON public.character_tracks;
CREATE POLICY "character_tracks_delete_owner" ON public.character_tracks
  FOR DELETE TO authenticated USING (
    private.is_character_owner(character_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.character_tracks TO authenticated;

DROP TRIGGER IF EXISTS character_tracks_updated_at ON public.character_tracks;
CREATE TRIGGER character_tracks_updated_at
  BEFORE UPDATE ON public.character_tracks
  FOR EACH ROW EXECUTE FUNCTION public.handle_character_updated_at();

CREATE TABLE IF NOT EXISTS public.character_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New Page',
  shared boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS character_notes_by_character
  ON public.character_notes (character_id);

ALTER TABLE public.character_notes ENABLE ROW LEVEL SECURITY;

-- Members see only the notes the owner shared; unshared notes never leak.
DROP POLICY IF EXISTS "character_notes_select_shared" ON public.character_notes;
CREATE POLICY "character_notes_select_shared" ON public.character_notes
  FOR SELECT TO authenticated USING (
    private.is_character_note_visible(id)
  );

DROP POLICY IF EXISTS "character_notes_insert_owner" ON public.character_notes;
CREATE POLICY "character_notes_insert_owner" ON public.character_notes
  FOR INSERT TO authenticated WITH CHECK (
    private.is_character_owner(character_id)
  );

DROP POLICY IF EXISTS "character_notes_update_owner" ON public.character_notes;
CREATE POLICY "character_notes_update_owner" ON public.character_notes
  FOR UPDATE TO authenticated
  USING (private.is_character_owner(character_id))
  WITH CHECK (private.is_character_owner(character_id));

DROP POLICY IF EXISTS "character_notes_delete_owner" ON public.character_notes;
CREATE POLICY "character_notes_delete_owner" ON public.character_notes
  FOR DELETE TO authenticated USING (
    private.is_character_owner(character_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.character_notes TO authenticated;

DROP TRIGGER IF EXISTS character_notes_updated_at ON public.character_notes;
CREATE TRIGGER character_notes_updated_at
  BEFORE UPDATE ON public.character_notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_character_updated_at();

-- One row per character note holding the editor content as base64. The bytes
-- stay opaque to the database; the client encodes and decodes them at its
-- edge (see src/api-calls/notes/noteContent.ts). Server-saved shared editing
-- (Hocuspocus, ticket #20) reuses this one-row-per-note shape.
CREATE TABLE IF NOT EXISTS public.character_note_contents (
  note_id uuid PRIMARY KEY REFERENCES public.character_notes (id) ON DELETE CASCADE,
  content text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.character_note_contents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "character_note_contents_select_shared" ON public.character_note_contents;
CREATE POLICY "character_note_contents_select_shared" ON public.character_note_contents
  FOR SELECT TO authenticated USING (
    private.is_character_note_visible(note_id)
  );

DROP POLICY IF EXISTS "character_note_contents_insert_owner" ON public.character_note_contents;
CREATE POLICY "character_note_contents_insert_owner" ON public.character_note_contents
  FOR INSERT TO authenticated WITH CHECK (
    private.is_character_note_owner(note_id)
  );

DROP POLICY IF EXISTS "character_note_contents_update_owner" ON public.character_note_contents;
CREATE POLICY "character_note_contents_update_owner" ON public.character_note_contents
  FOR UPDATE TO authenticated
  USING (private.is_character_note_owner(note_id))
  WITH CHECK (private.is_character_note_owner(note_id));

DROP POLICY IF EXISTS "character_note_contents_delete_owner" ON public.character_note_contents;
CREATE POLICY "character_note_contents_delete_owner" ON public.character_note_contents
  FOR DELETE TO authenticated USING (
    private.is_character_note_owner(note_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.character_note_contents TO authenticated;

DROP TRIGGER IF EXISTS character_note_contents_updated_at ON public.character_note_contents;
CREATE TRIGGER character_note_contents_updated_at
  BEFORE UPDATE ON public.character_note_contents
  FOR EACH ROW EXECUTE FUNCTION public.handle_character_updated_at();

CREATE TABLE IF NOT EXISTS public.character_settings (
  character_id uuid PRIMARY KEY REFERENCES public.characters (id) ON DELETE CASCADE,
  custom_stats text[] NOT NULL DEFAULT '{}',
  custom_tracks jsonb NOT NULL DEFAULT '{}'::jsonb,
  hidden_custom_oracle_ids text[] NOT NULL DEFAULT '{}',
  hidden_custom_move_ids text[] NOT NULL DEFAULT '{}',
  hide_delve_moves boolean NOT NULL DEFAULT false,
  hide_delve_oracles boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.character_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "character_settings_select_visible" ON public.character_settings;
CREATE POLICY "character_settings_select_visible" ON public.character_settings
  FOR SELECT TO authenticated USING (
    private.is_character_visible(character_id)
  );

DROP POLICY IF EXISTS "character_settings_insert_owner" ON public.character_settings;
CREATE POLICY "character_settings_insert_owner" ON public.character_settings
  FOR INSERT TO authenticated WITH CHECK (
    private.is_character_owner(character_id)
  );

DROP POLICY IF EXISTS "character_settings_update_owner" ON public.character_settings;
CREATE POLICY "character_settings_update_owner" ON public.character_settings
  FOR UPDATE TO authenticated
  USING (private.is_character_owner(character_id))
  WITH CHECK (private.is_character_owner(character_id));

DROP POLICY IF EXISTS "character_settings_delete_owner" ON public.character_settings;
CREATE POLICY "character_settings_delete_owner" ON public.character_settings
  FOR DELETE TO authenticated USING (
    private.is_character_owner(character_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.character_settings TO authenticated;

DROP TRIGGER IF EXISTS character_settings_updated_at ON public.character_settings;
CREATE TRIGGER character_settings_updated_at
  BEFORE UPDATE ON public.character_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_character_updated_at();

-- The solo roll log: rolls made outside a campaign. The whole roll travels
-- as one JSON document with its timestamp inside; created_at orders the log
-- and gms_only stays for forward compatibility (solo owners see everything).
CREATE TABLE IF NOT EXISTS public.character_rolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters (id) ON DELETE CASCADE,
  roll jsonb NOT NULL,
  gms_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS character_rolls_by_character
  ON public.character_rolls (character_id);

ALTER TABLE public.character_rolls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "character_rolls_select_visible" ON public.character_rolls;
CREATE POLICY "character_rolls_select_visible" ON public.character_rolls
  FOR SELECT TO authenticated USING (
    private.is_character_visible(character_id)
  );

DROP POLICY IF EXISTS "character_rolls_insert_owner" ON public.character_rolls;
CREATE POLICY "character_rolls_insert_owner" ON public.character_rolls
  FOR INSERT TO authenticated WITH CHECK (
    private.is_character_owner(character_id)
  );

DROP POLICY IF EXISTS "character_rolls_update_owner" ON public.character_rolls;
CREATE POLICY "character_rolls_update_owner" ON public.character_rolls
  FOR UPDATE TO authenticated
  USING (private.is_character_owner(character_id))
  WITH CHECK (private.is_character_owner(character_id));

DROP POLICY IF EXISTS "character_rolls_delete_owner" ON public.character_rolls;
CREATE POLICY "character_rolls_delete_owner" ON public.character_rolls
  FOR DELETE TO authenticated USING (
    private.is_character_owner(character_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.character_rolls TO authenticated;

DROP TRIGGER IF EXISTS character_rolls_updated_at ON public.character_rolls;
CREATE TRIGGER character_rolls_updated_at
  BEFORE UPDATE ON public.character_rolls
  FOR EACH ROW EXECUTE FUNCTION public.handle_character_updated_at();

-- Owner-visible rows stream as plain row changes: each subscriber's channel
-- is filtered to the rows they may see, and row-level security drops the
-- rest. The migrate service runs before live updates boots, so the
-- publication may not exist yet: create it when missing, and never add the
-- same table twice.
ALTER TABLE public.characters REPLICA IDENTITY FULL;
ALTER TABLE public.character_assets REPLICA IDENTITY FULL;
ALTER TABLE public.character_tracks REPLICA IDENTITY FULL;
ALTER TABLE public.character_notes REPLICA IDENTITY FULL;
ALTER TABLE public.character_note_contents REPLICA IDENTITY FULL;
ALTER TABLE public.character_settings REPLICA IDENTITY FULL;
ALTER TABLE public.character_rolls REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'characters',
    'character_assets',
    'character_tracks',
    'character_notes',
    'character_note_contents',
    'character_settings',
    'character_rolls'
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
