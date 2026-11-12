-- Worlds and everything that belongs to one world: locations (with maps),
-- lore documents and NPCs, each with GM-only details and shared notes.
--
-- A world is visible to its owners and to the members of every campaign that
-- uses it. The GM-only parts live in separate tables that only the world's
-- GMs may read: the structured fields in one-to-one GM-details tables, and
-- the GM notes in world_notes rows marked gm_only. Players see shared items
-- and their public notes; unshared items and GM details never reach them, in
-- reads or over live updates. Who counts as a world GM (decision #12,
-- recorded here as private.is_world_gm): a world's owners AND the GMs of
-- every campaign linked to it. Unlinking the world or removing a campaign GM
-- ends that access at the database, including live connections.
--
-- World notes (public and GM-only) and the world description are Yjs
-- documents held by the note server (Hocuspocus, ticket #20): one
-- world_notes row per item side, one contents row per note, and the
-- description bytes beside the world row. The server reuses the visibility
-- helpers below, and the database notifies `note_access_revoked` when a
-- note stops being shared so the server closes revoked connections.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand. It runs
-- after the campaigns migration, whose plain-uuid world_id columns gain
-- their references here, and after the shared updated_at trigger exists.
--
-- Notes for later tickets:
-- - Sectors are gone from the app (Starforged locations replaced them), so
--   no sector tables are created; legacy sector cleanup is not needed
--   because Supabase worlds start empty.
-- - Lore's only GM-only datum is its GM notes, held in the gm_only
--   world_notes row: that row IS lore's GM-details table, so no extra
--   one-to-one table is created for lore.
-- - Broadcast topics (world:<id>) are not created here: the migrate service
--   runs before the live-update service boots, so the realtime schema does
--   not exist yet when this file applies. Shared rows stream over plain row
--   changes instead, with the same per-subscriber access checks; the shared
--   listen helper re-fetches on every subscribe.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS public.worlds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  description text NULL,
  new_truths jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Membership checks used by every world access rule. Security definer so the
-- checks run even for people with no direct grant on the tables; the private
-- schema is never exposed through the data API. The empty search path and
-- the (select auth.uid()) subquery follow the database performance guide.
-- A world GM is one of its owners, or a GM of any campaign linked to it
-- (decision #12). A viewer is a world GM or a member of a linked campaign.
CREATE OR REPLACE FUNCTION private.is_world_gm(wid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.worlds w
    WHERE w.id = wid
      AND (
        (select auth.uid()) = ANY (w.owner_ids)
        OR EXISTS (
          SELECT 1 FROM public.campaigns c
          JOIN public.campaign_members m ON m.campaign_id = c.id
          WHERE c.world_id = wid
            AND m.user_id = (select auth.uid())
            AND m.role = 'gm'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.is_world_viewer(wid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_world_gm(wid)
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      JOIN public.campaign_members m ON m.campaign_id = c.id
      WHERE c.world_id = wid
        AND m.user_id = (select auth.uid())
    );
$$;

ALTER TABLE public.worlds ENABLE ROW LEVEL SECURITY;

-- Owners and linked-campaign members read the world; outsiders read nothing.
DROP POLICY IF EXISTS "worlds_select_viewers" ON public.worlds;
CREATE POLICY "worlds_select_viewers" ON public.worlds
  FOR SELECT TO authenticated USING (
    private.is_world_viewer(id)
  );

-- Worlds are created with the caller in their owners; the check below keeps
-- ownerless worlds from ever existing.
DROP POLICY IF EXISTS "worlds_insert_own" ON public.worlds;
CREATE POLICY "worlds_insert_own" ON public.worlds
  FOR INSERT TO authenticated WITH CHECK (
    (select auth.uid()) = ANY (owner_ids)
  );

-- Owners and campaign GMs edit the world itself (decision #12); only owners
-- delete it.
DROP POLICY IF EXISTS "worlds_update_gm" ON public.worlds;
CREATE POLICY "worlds_update_gm" ON public.worlds
  FOR UPDATE TO authenticated
  USING (private.is_world_gm(id))
  WITH CHECK (private.is_world_gm(id));

DROP POLICY IF EXISTS "worlds_delete_owner" ON public.worlds;
CREATE POLICY "worlds_delete_owner" ON public.worlds
  FOR DELETE TO authenticated USING (
    (select auth.uid()) = ANY (owner_ids)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.worlds TO authenticated;

-- One shared updated_at trigger for every world table: the shared listen
-- helper drops buffered events older than the row it already holds.
CREATE OR REPLACE FUNCTION public.handle_world_updated_at()
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

DROP TRIGGER IF EXISTS worlds_updated_at ON public.worlds;
CREATE TRIGGER worlds_updated_at
  BEFORE UPDATE ON public.worlds
  FOR EACH ROW EXECUTE FUNCTION public.handle_world_updated_at();

-- The campaigns and characters links promised by their migrations: pointing
-- a campaign or a character at a world never deletes anything when the
-- world goes; the reference simply clears.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaigns_world_id_fkey'
  ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_world_id_fkey
      FOREIGN KEY (world_id) REFERENCES public.worlds (id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'characters_world_id_fkey'
  ) THEN
    ALTER TABLE public.characters
      ADD CONSTRAINT characters_world_id_fkey
      FOREIGN KEY (world_id) REFERENCES public.worlds (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.world_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES public.worlds (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  parent_location_id uuid NULL REFERENCES public.world_locations (id) ON DELETE SET NULL,
  image_filenames text[] NOT NULL DEFAULT '{}',
  icon jsonb NULL,
  shared_with_players boolean NOT NULL DEFAULT true,
  character_bonds jsonb NOT NULL DEFAULT '{}'::jsonb,
  type text NULL,
  fields jsonb NULL,
  map jsonb NULL,
  map_rows integer NULL,
  map_cols integer NULL,
  map_hex_size integer NULL,
  map_background_image_filename text NULL,
  map_background_image_fit text NULL,
  map_stroke_color text NULL,
  show_map boolean NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS world_locations_by_world
  ON public.world_locations (world_id);

ALTER TABLE public.world_locations ENABLE ROW LEVEL SECURITY;

-- World GMs read every location; other viewers read exactly the shared ones.
DROP POLICY IF EXISTS "world_locations_select_shared_or_gm" ON public.world_locations;
CREATE POLICY "world_locations_select_shared_or_gm" ON public.world_locations
  FOR SELECT TO authenticated USING (
    private.is_world_gm(world_id)
    OR (shared_with_players AND private.is_world_viewer(world_id))
  );

DROP POLICY IF EXISTS "world_locations_insert_gm" ON public.world_locations;
CREATE POLICY "world_locations_insert_gm" ON public.world_locations
  FOR INSERT TO authenticated WITH CHECK (
    private.is_world_gm(world_id)
  );

DROP POLICY IF EXISTS "world_locations_update_gm" ON public.world_locations;
CREATE POLICY "world_locations_update_gm" ON public.world_locations
  FOR UPDATE TO authenticated
  USING (private.is_world_gm(world_id))
  WITH CHECK (private.is_world_gm(world_id));

DROP POLICY IF EXISTS "world_locations_delete_gm" ON public.world_locations;
CREATE POLICY "world_locations_delete_gm" ON public.world_locations
  FOR DELETE TO authenticated USING (
    private.is_world_gm(world_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.world_locations TO authenticated;

DROP TRIGGER IF EXISTS world_locations_updated_at ON public.world_locations;
CREATE TRIGGER world_locations_updated_at
  BEFORE UPDATE ON public.world_locations
  FOR EACH ROW EXECUTE FUNCTION public.handle_world_updated_at();

-- Structured GM-only fields for locations. The GM notes bytes live in the
-- gm_only world_notes row, not here.
CREATE TABLE IF NOT EXISTS public.world_location_gm_details (
  location_id uuid PRIMARY KEY REFERENCES public.world_locations (id) ON DELETE CASCADE,
  fields jsonb NULL,
  descriptor text NULL,
  trouble text NULL,
  location_features text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.world_location_gm_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "world_location_gm_details_select_gm" ON public.world_location_gm_details;
CREATE POLICY "world_location_gm_details_select_gm" ON public.world_location_gm_details
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.world_locations l
      WHERE l.id = location_id AND private.is_world_gm(l.world_id)
    )
  );

DROP POLICY IF EXISTS "world_location_gm_details_insert_gm" ON public.world_location_gm_details;
CREATE POLICY "world_location_gm_details_insert_gm" ON public.world_location_gm_details
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.world_locations l
      WHERE l.id = location_id AND private.is_world_gm(l.world_id)
    )
  );

DROP POLICY IF EXISTS "world_location_gm_details_update_gm" ON public.world_location_gm_details;
CREATE POLICY "world_location_gm_details_update_gm" ON public.world_location_gm_details
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.world_locations l
      WHERE l.id = location_id AND private.is_world_gm(l.world_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.world_locations l
      WHERE l.id = location_id AND private.is_world_gm(l.world_id)
    )
  );

DROP POLICY IF EXISTS "world_location_gm_details_delete_gm" ON public.world_location_gm_details;
CREATE POLICY "world_location_gm_details_delete_gm" ON public.world_location_gm_details
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.world_locations l
      WHERE l.id = location_id AND private.is_world_gm(l.world_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.world_location_gm_details TO authenticated;

DROP TRIGGER IF EXISTS world_location_gm_details_updated_at ON public.world_location_gm_details;
CREATE TRIGGER world_location_gm_details_updated_at
  BEFORE UPDATE ON public.world_location_gm_details
  FOR EACH ROW EXECUTE FUNCTION public.handle_world_updated_at();

CREATE TABLE IF NOT EXISTS public.world_lore (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES public.worlds (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  image_filenames text[] NOT NULL DEFAULT '{}',
  icon jsonb NULL,
  shared_with_players boolean NOT NULL DEFAULT true,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS world_lore_by_world
  ON public.world_lore (world_id);

ALTER TABLE public.world_lore ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "world_lore_select_shared_or_gm" ON public.world_lore;
CREATE POLICY "world_lore_select_shared_or_gm" ON public.world_lore
  FOR SELECT TO authenticated USING (
    private.is_world_gm(world_id)
    OR (shared_with_players AND private.is_world_viewer(world_id))
  );

DROP POLICY IF EXISTS "world_lore_insert_gm" ON public.world_lore;
CREATE POLICY "world_lore_insert_gm" ON public.world_lore
  FOR INSERT TO authenticated WITH CHECK (
    private.is_world_gm(world_id)
  );

DROP POLICY IF EXISTS "world_lore_update_gm" ON public.world_lore;
CREATE POLICY "world_lore_update_gm" ON public.world_lore
  FOR UPDATE TO authenticated
  USING (private.is_world_gm(world_id))
  WITH CHECK (private.is_world_gm(world_id));

DROP POLICY IF EXISTS "world_lore_delete_gm" ON public.world_lore;
CREATE POLICY "world_lore_delete_gm" ON public.world_lore
  FOR DELETE TO authenticated USING (
    private.is_world_gm(world_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.world_lore TO authenticated;

DROP TRIGGER IF EXISTS world_lore_updated_at ON public.world_lore;
CREATE TRIGGER world_lore_updated_at
  BEFORE UPDATE ON public.world_lore
  FOR EACH ROW EXECUTE FUNCTION public.handle_world_updated_at();

CREATE TABLE IF NOT EXISTS public.world_npcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES public.worlds (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  image_filenames text[] NOT NULL DEFAULT '{}',
  icon jsonb NULL,
  shared_with_players boolean NOT NULL DEFAULT true,
  pronouns text NULL,
  species text NULL,
  last_location_id text NULL,
  character_connections jsonb NOT NULL DEFAULT '{}'::jsonb,
  character_bonds jsonb NOT NULL DEFAULT '{}'::jsonb,
  character_bond_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  rank text NULL,
  callsign text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS world_npcs_by_world
  ON public.world_npcs (world_id);

ALTER TABLE public.world_npcs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "world_npcs_select_shared_or_gm" ON public.world_npcs;
CREATE POLICY "world_npcs_select_shared_or_gm" ON public.world_npcs
  FOR SELECT TO authenticated USING (
    private.is_world_gm(world_id)
    OR (shared_with_players AND private.is_world_viewer(world_id))
  );

DROP POLICY IF EXISTS "world_npcs_insert_gm" ON public.world_npcs;
CREATE POLICY "world_npcs_insert_gm" ON public.world_npcs
  FOR INSERT TO authenticated WITH CHECK (
    private.is_world_gm(world_id)
  );

DROP POLICY IF EXISTS "world_npcs_update_gm" ON public.world_npcs;
CREATE POLICY "world_npcs_update_gm" ON public.world_npcs
  FOR UPDATE TO authenticated
  USING (private.is_world_gm(world_id))
  WITH CHECK (private.is_world_gm(world_id));

DROP POLICY IF EXISTS "world_npcs_delete_gm" ON public.world_npcs;
CREATE POLICY "world_npcs_delete_gm" ON public.world_npcs
  FOR DELETE TO authenticated USING (
    private.is_world_gm(world_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.world_npcs TO authenticated;

DROP TRIGGER IF EXISTS world_npcs_updated_at ON public.world_npcs;
CREATE TRIGGER world_npcs_updated_at
  BEFORE UPDATE ON public.world_npcs
  FOR EACH ROW EXECUTE FUNCTION public.handle_world_updated_at();

-- Structured GM-only fields for NPCs. The GM notes bytes live in the
-- gm_only world_notes row, not here.
CREATE TABLE IF NOT EXISTS public.world_npc_gm_details (
  npc_id uuid PRIMARY KEY REFERENCES public.world_npcs (id) ON DELETE CASCADE,
  goal text NULL,
  role text NULL,
  descriptor text NULL,
  disposition text NULL,
  activity text NULL,
  first_look text NULL,
  revealed_aspect text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.world_npc_gm_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "world_npc_gm_details_select_gm" ON public.world_npc_gm_details;
CREATE POLICY "world_npc_gm_details_select_gm" ON public.world_npc_gm_details
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.world_npcs n
      WHERE n.id = npc_id AND private.is_world_gm(n.world_id)
    )
  );

DROP POLICY IF EXISTS "world_npc_gm_details_insert_gm" ON public.world_npc_gm_details;
CREATE POLICY "world_npc_gm_details_insert_gm" ON public.world_npc_gm_details
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.world_npcs n
      WHERE n.id = npc_id AND private.is_world_gm(n.world_id)
    )
  );

DROP POLICY IF EXISTS "world_npc_gm_details_update_gm" ON public.world_npc_gm_details;
CREATE POLICY "world_npc_gm_details_update_gm" ON public.world_npc_gm_details
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.world_npcs n
      WHERE n.id = npc_id AND private.is_world_gm(n.world_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.world_npcs n
      WHERE n.id = npc_id AND private.is_world_gm(n.world_id)
    )
  );

DROP POLICY IF EXISTS "world_npc_gm_details_delete_gm" ON public.world_npc_gm_details;
CREATE POLICY "world_npc_gm_details_delete_gm" ON public.world_npc_gm_details
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.world_npcs n
      WHERE n.id = npc_id AND private.is_world_gm(n.world_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.world_npc_gm_details TO authenticated;

DROP TRIGGER IF EXISTS world_npc_gm_details_updated_at ON public.world_npc_gm_details;
CREATE TRIGGER world_npc_gm_details_updated_at
  BEFORE UPDATE ON public.world_npc_gm_details
  FOR EACH ROW EXECUTE FUNCTION public.handle_world_updated_at();

-- World notes: one row per item side (public notes and GM-only notes for
-- every location, lore document and NPC), each holding one Yjs document on
-- the note server. Exactly one parent link is set; deleting the parent or
-- the world removes the note. Lore's gm_only row is lore's GM-details
-- table: it holds lore's only GM-only datum, its GM notes.
CREATE TABLE IF NOT EXISTS public.world_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES public.worlds (id) ON DELETE CASCADE,
  location_id uuid NULL REFERENCES public.world_locations (id) ON DELETE CASCADE,
  lore_id uuid NULL REFERENCES public.world_lore (id) ON DELETE CASCADE,
  npc_id uuid NULL REFERENCES public.world_npcs (id) ON DELETE CASCADE,
  gm_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(location_id, lore_id, npc_id) = 1)
);

CREATE INDEX IF NOT EXISTS world_notes_by_world
  ON public.world_notes (world_id);
CREATE INDEX IF NOT EXISTS world_notes_by_location
  ON public.world_notes (location_id);
CREATE INDEX IF NOT EXISTS world_notes_by_lore
  ON public.world_notes (lore_id);
CREATE INDEX IF NOT EXISTS world_notes_by_npc
  ON public.world_notes (npc_id);

-- Campaigns are looked up by world on every world access check; index the
-- link the same way the members table is indexed.
CREATE INDEX IF NOT EXISTS campaigns_by_world
  ON public.campaigns (world_id);

-- One public and one GM note per item: the unique indexes use NULLS NOT
-- DISTINCT because plain UNIQUE treats NULL parent links as distinct.
DROP INDEX IF EXISTS world_notes_unique_location;
CREATE UNIQUE INDEX world_notes_unique_location ON public.world_notes
  (location_id NULLS NOT DISTINCT, gm_only)
  WHERE location_id IS NOT NULL;
DROP INDEX IF EXISTS world_notes_unique_lore;
CREATE UNIQUE INDEX world_notes_unique_lore ON public.world_notes
  (lore_id NULLS NOT DISTINCT, gm_only)
  WHERE lore_id IS NOT NULL;
DROP INDEX IF EXISTS world_notes_unique_npc;
CREATE UNIQUE INDEX world_notes_unique_npc ON public.world_notes
  (npc_id NULLS NOT DISTINCT, gm_only)
  WHERE npc_id IS NOT NULL;

-- Note access used by the table policies and the note server alike, so the
-- rule logic lives in exactly one place. World GMs see every note; other
-- viewers see the public notes of shared items; outsiders see nothing.
CREATE OR REPLACE FUNCTION private.is_world_note_visible(nid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.world_notes n
    LEFT JOIN public.world_locations loc ON loc.id = n.location_id
    LEFT JOIN public.world_lore lore ON lore.id = n.lore_id
    LEFT JOIN public.world_npcs npc ON npc.id = n.npc_id
    WHERE n.id = nid
      AND (
        private.is_world_gm(n.world_id)
        OR (
          NOT n.gm_only
          AND COALESCE(loc.shared_with_players, lore.shared_with_players, npc.shared_with_players, false)
          AND private.is_world_viewer(n.world_id)
        )
      )
  );
$$;

-- Only world GMs write world notes, shared or not.
CREATE OR REPLACE FUNCTION private.is_world_note_writable(nid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.world_notes n
    WHERE n.id = nid AND private.is_world_gm(n.world_id)
  );
$$;

ALTER TABLE public.world_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "world_notes_select_visible" ON public.world_notes;
CREATE POLICY "world_notes_select_visible" ON public.world_notes
  FOR SELECT TO authenticated USING (
    private.is_world_note_visible(id)
  );

DROP POLICY IF EXISTS "world_notes_insert_gm" ON public.world_notes;
CREATE POLICY "world_notes_insert_gm" ON public.world_notes
  FOR INSERT TO authenticated WITH CHECK (
    private.is_world_gm(world_id)
  );

DROP POLICY IF EXISTS "world_notes_update_gm" ON public.world_notes;
CREATE POLICY "world_notes_update_gm" ON public.world_notes
  FOR UPDATE TO authenticated
  USING (private.is_world_note_writable(id))
  WITH CHECK (private.is_world_gm(world_id));

DROP POLICY IF EXISTS "world_notes_delete_gm" ON public.world_notes;
CREATE POLICY "world_notes_delete_gm" ON public.world_notes
  FOR DELETE TO authenticated USING (
    private.is_world_note_writable(id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.world_notes TO authenticated;

DROP TRIGGER IF EXISTS world_notes_updated_at ON public.world_notes;
CREATE TRIGGER world_notes_updated_at
  BEFORE UPDATE ON public.world_notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_world_updated_at();

-- One row per world note holding the editor content as base64. The bytes
-- stay opaque to the database; the note server and the client encode and
-- decode them at their edges (see src/api-calls/notes/noteContent.ts).
CREATE TABLE IF NOT EXISTS public.world_note_contents (
  note_id uuid PRIMARY KEY REFERENCES public.world_notes (id) ON DELETE CASCADE,
  content text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.world_note_contents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "world_note_contents_select_visible" ON public.world_note_contents;
CREATE POLICY "world_note_contents_select_visible" ON public.world_note_contents
  FOR SELECT TO authenticated USING (
    private.is_world_note_visible(note_id)
  );

DROP POLICY IF EXISTS "world_note_contents_insert_gm" ON public.world_note_contents;
CREATE POLICY "world_note_contents_insert_gm" ON public.world_note_contents
  FOR INSERT TO authenticated WITH CHECK (
    private.is_world_note_writable(note_id)
  );

DROP POLICY IF EXISTS "world_note_contents_update_gm" ON public.world_note_contents;
CREATE POLICY "world_note_contents_update_gm" ON public.world_note_contents
  FOR UPDATE TO authenticated
  USING (private.is_world_note_writable(note_id))
  WITH CHECK (private.is_world_note_writable(note_id));

DROP POLICY IF EXISTS "world_note_contents_delete_gm" ON public.world_note_contents;
CREATE POLICY "world_note_contents_delete_gm" ON public.world_note_contents
  FOR DELETE TO authenticated USING (
    private.is_world_note_writable(note_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.world_note_contents TO authenticated;

DROP TRIGGER IF EXISTS world_note_contents_updated_at ON public.world_note_contents;
CREATE TRIGGER world_note_contents_updated_at
  BEFORE UPDATE ON public.world_note_contents
  FOR EACH ROW EXECUTE FUNCTION public.handle_world_updated_at();

-- Players toggle their own characters' bonds and connections from the world
-- sheets. Items themselves stay GM-writable, so the toggle goes through this
-- function: world GMs may set any bond, other viewers only their own
-- characters'. The field allowlist keeps the dynamic column fixed.
CREATE OR REPLACE FUNCTION public.set_world_item_bond(
  kind text,
  item_id uuid,
  character_id uuid,
  field text,
  value jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  wid uuid;
BEGIN
  IF kind = 'location' THEN
    IF field <> 'character_bonds' THEN
      RAISE EXCEPTION 'cannot set % on a location', field;
    END IF;
    SELECT world_id INTO wid FROM public.world_locations WHERE id = item_id;
  ELSIF kind = 'npc' THEN
    IF field NOT IN ('character_bonds', 'character_connections', 'character_bond_progress') THEN
      RAISE EXCEPTION 'cannot set % on an npc', field;
    END IF;
    SELECT world_id INTO wid FROM public.world_npcs WHERE id = item_id;
  ELSE
    RAISE EXCEPTION 'unknown world item kind: %', kind;
  END IF;
  IF wid IS NULL THEN
    RAISE EXCEPTION 'world item not found';
  END IF;
  IF NOT (
    private.is_world_gm(wid)
    OR (
      private.is_world_viewer(wid)
      AND EXISTS (
        SELECT 1 FROM public.characters
        WHERE id = character_id AND owner_id = (select auth.uid())
      )
    )
  ) THEN
    RAISE EXCEPTION 'only world GMs and the character owner set bonds' USING ERRCODE = '42501';
  END IF;
  IF kind = 'location' THEN
    UPDATE public.world_locations
    SET character_bonds = COALESCE(character_bonds, '{}'::jsonb) || jsonb_build_object(character_id::text, value)
    WHERE id = item_id;
  ELSE
    EXECUTE format(
      'UPDATE public.world_npcs SET %I = COALESCE(%I, %L::jsonb) || jsonb_build_object($1, $2) WHERE id = $3',
      field, field, '{}'
    ) USING character_id::text, value, item_id;
  END IF;
END;
$$;

-- World guides are extra owners: GMs of the campaigns using the world
-- already manage it through is_world_gm, while guides manage every world
-- they are added to. Only existing world GMs change the list, and the last
-- owner cannot remove themselves.
CREATE OR REPLACE FUNCTION public.add_world_guide(wid uuid, guide_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_world_gm(wid) THEN
    RAISE EXCEPTION 'only world GMs manage guides' USING ERRCODE = '42501';
  END IF;
  UPDATE public.worlds
  SET owner_ids = CASE WHEN guide_id = ANY (owner_ids) THEN owner_ids ELSE owner_ids || guide_id END
  WHERE id = wid;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_world_guide(wid uuid, guide_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_owners uuid[];
BEGIN
  IF NOT private.is_world_gm(wid) THEN
    RAISE EXCEPTION 'only world GMs manage guides' USING ERRCODE = '42501';
  END IF;
  SELECT owner_ids INTO current_owners FROM public.worlds WHERE id = wid;
  IF current_owners IS NULL THEN
    RAISE EXCEPTION 'world not found';
  END IF;
  IF array_length(current_owners, 1) = 1 AND current_owners[1] = guide_id THEN
    RAISE EXCEPTION 'cannot remove the last owner';
  END IF;
  UPDATE public.worlds
  SET owner_ids = array_remove(owner_ids, guide_id)
  WHERE id = wid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_world_item_bond(text, uuid, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_world_guide(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_world_guide(uuid, uuid) TO authenticated;

-- Live revocation for the note server: when an item stops being shared, or a
-- note is deleted, tell the server which document lost readers so it can
-- close the connections of everyone who just lost access. The document name
-- travels as the payload; the server re-checks each connected reader
-- against the same visibility helpers the policies use above.
CREATE OR REPLACE FUNCTION private.notify_world_item_unshared()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  column_name text;
  note_id uuid;
BEGIN
  column_name := CASE TG_TABLE_NAME
    WHEN 'world_locations' THEN 'location_id'
    WHEN 'world_lore' THEN 'lore_id'
    ELSE 'npc_id'
  END;
  EXECUTE format(
    'SELECT id FROM public.world_notes WHERE %I = $1 AND NOT gm_only',
    column_name
  ) USING OLD.id INTO note_id;
  IF note_id IS NOT NULL THEN
    PERFORM pg_notify('note_access_revoked', 'world-notes/' || note_id::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS world_locations_unshare_notify ON public.world_locations;
CREATE TRIGGER world_locations_unshare_notify
  AFTER UPDATE OF shared_with_players ON public.world_locations
  FOR EACH ROW
  WHEN (OLD.shared_with_players AND NOT NEW.shared_with_players)
  EXECUTE FUNCTION private.notify_world_item_unshared();

DROP TRIGGER IF EXISTS world_lore_unshare_notify ON public.world_lore;
CREATE TRIGGER world_lore_unshare_notify
  AFTER UPDATE OF shared_with_players ON public.world_lore
  FOR EACH ROW
  WHEN (OLD.shared_with_players AND NOT NEW.shared_with_players)
  EXECUTE FUNCTION private.notify_world_item_unshared();

DROP TRIGGER IF EXISTS world_npcs_unshare_notify ON public.world_npcs;
CREATE TRIGGER world_npcs_unshare_notify
  AFTER UPDATE OF shared_with_players ON public.world_npcs
  FOR EACH ROW
  WHEN (OLD.shared_with_players AND NOT NEW.shared_with_players)
  EXECUTE FUNCTION private.notify_world_item_unshared();

CREATE OR REPLACE FUNCTION private.notify_world_note_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_notify('note_access_revoked', 'world-notes/' || OLD.id::text);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS world_notes_delete_notify ON public.world_notes;
CREATE TRIGGER world_notes_delete_notify
  AFTER DELETE ON public.world_notes
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_world_note_deleted();

CREATE OR REPLACE FUNCTION private.notify_world_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_notify('note_access_revoked', 'world-descriptions/' || OLD.id::text);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS worlds_delete_notify ON public.worlds;
CREATE TRIGGER worlds_delete_notify
  AFTER DELETE ON public.worlds
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_world_deleted();

-- Location, lore and NPC images (and map backgrounds) live in a private
-- storage bucket, one folder per world item: world-images/<worldId>/
-- <itemId>/<filename>. Only world GMs write; world viewers may read.
-- Images are served as uploaded, so the site shrinks large images in the
-- browser before upload (see src/api-calls/storage/shrinkImage.ts).
INSERT INTO storage.buckets (id, name, public)
VALUES ('world-images', 'world-images', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Extracts the world id from a world-images path, or NULL when the path is
-- not shaped like one, so malformed names fail closed instead of erroring.
CREATE OR REPLACE FUNCTION private.world_image_world(path text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN split_part(path, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN split_part(path, '/', 1)::uuid
    ELSE NULL
  END;
$$;

DROP POLICY IF EXISTS "world_images_select_viewers" ON storage.objects;
CREATE POLICY "world_images_select_viewers" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'world-images'
    AND private.is_world_viewer(private.world_image_world(name))
  );

DROP POLICY IF EXISTS "world_images_insert_gm" ON storage.objects;
CREATE POLICY "world_images_insert_gm" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'world-images'
    AND private.is_world_gm(private.world_image_world(name))
  );

DROP POLICY IF EXISTS "world_images_update_gm" ON storage.objects;
CREATE POLICY "world_images_update_gm" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'world-images'
    AND private.is_world_gm(private.world_image_world(name))
  )
  WITH CHECK (
    bucket_id = 'world-images'
    AND private.is_world_gm(private.world_image_world(name))
  );

DROP POLICY IF EXISTS "world_images_delete_gm" ON storage.objects;
CREATE POLICY "world_images_delete_gm" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'world-images'
    AND private.is_world_gm(private.world_image_world(name))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- Member-visible rows stream as plain row changes: each subscriber's channel
-- is filtered to the rows they may see, and row-level security drops the
-- rest. The migrate service runs before live updates boots, so the
-- publication may not exist yet: create it when missing, and never add the
-- same table twice.
ALTER TABLE public.worlds REPLICA IDENTITY FULL;
ALTER TABLE public.world_locations REPLICA IDENTITY FULL;
ALTER TABLE public.world_location_gm_details REPLICA IDENTITY FULL;
ALTER TABLE public.world_lore REPLICA IDENTITY FULL;
ALTER TABLE public.world_npcs REPLICA IDENTITY FULL;
ALTER TABLE public.world_npc_gm_details REPLICA IDENTITY FULL;
ALTER TABLE public.world_notes REPLICA IDENTITY FULL;
ALTER TABLE public.world_note_contents REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'worlds',
    'world_locations',
    'world_location_gm_details',
    'world_lore',
    'world_npcs',
    'world_npc_gm_details',
    'world_notes',
    'world_note_contents'
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
