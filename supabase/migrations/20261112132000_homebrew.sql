-- Homebrew: author-owned collections of custom rules content (stats,
-- condition meters, impacts, legacy tracks, move categories and moves, oracle
-- collections and tables, asset collections and assets). Authors collaborate
-- through single-use invite keys, which replace the Firebase cloud functions
-- as Postgres functions below.
--
-- Reads stay public (as in the old rules: every collection and content row
-- readable by anyone) so shared homebrew keeps working in character sheets
-- and shared links. Writes are restricted to collection editors; editors,
-- viewers and invite keys change only through the database functions, never
-- by direct table access.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand.
--
-- Notes for later tickets:
-- - deleteHomebrewExpansion used to detach the collection from characters
--   and campaigns; those tables do not exist yet, so deletion only removes
--   the collection and everything under it. Character/campaign tickets own
--   their expansion references.

BEGIN;

-- The private schema is never exposed through the data API.
CREATE SCHEMA IF NOT EXISTS private;

-- Collections: the top-level container. The `slug` column carries the
-- datasworn package id (the `id` field of the document); the row id is the
-- internal key used in URLs and by every child row.
CREATE TABLE IF NOT EXISTS public.homebrew_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'expansion' CHECK (type IN ('expansion')),
  slug text NOT NULL,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  creator uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  ruleset_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Editors and viewers live in join tables (never editable columns), so only
-- the database functions below can change who edits a collection. Deleting a
-- person or a collection cleans up both sides at once.
CREATE TABLE IF NOT EXISTS public.homebrew_editors (
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, user_id)
);

-- Editor check used by every homebrew write rule. Security definer so the
-- check runs even though nobody has a direct grant on the editors table.
-- Follows the same conventions as private.is_campaign_member: empty search
-- path, and the (select auth.uid()) subquery so the planner evaluates the
-- caller once. Defined after the editors table because Postgres validates a
-- SQL-language function body when the function is created; the check still
-- precedes the policies that call it.
CREATE OR REPLACE FUNCTION private.is_homebrew_editor(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.homebrew_editors
    WHERE collection_id = cid AND user_id = (select auth.uid())
  );
$$;

CREATE TABLE IF NOT EXISTS public.homebrew_viewers (
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, user_id)
);

-- Single-use invite keys: accepting an invite deletes the key, so it cannot
-- be reused. Keys are never readable through the data API.
CREATE TABLE IF NOT EXISTS public.homebrew_invite_keys (
  key text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One content table per collection type. Documents vary too much (move
-- variants, nested impact contents, oracle rows) to model column by column,
-- so each row carries its `collection_id` for ownership and live updates plus
-- a `data` payload holding the document fields.
CREATE TABLE IF NOT EXISTS public.homebrew_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homebrew_condition_meters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homebrew_non_linear_meters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homebrew_impact_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homebrew_legacy_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homebrew_move_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homebrew_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homebrew_oracle_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homebrew_oracle_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homebrew_asset_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homebrew_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.homebrew_collections (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS homebrew_stats_by_collection
  ON public.homebrew_stats (collection_id);
CREATE INDEX IF NOT EXISTS homebrew_condition_meters_by_collection
  ON public.homebrew_condition_meters (collection_id);
CREATE INDEX IF NOT EXISTS homebrew_non_linear_meters_by_collection
  ON public.homebrew_non_linear_meters (collection_id);
CREATE INDEX IF NOT EXISTS homebrew_impact_categories_by_collection
  ON public.homebrew_impact_categories (collection_id);
CREATE INDEX IF NOT EXISTS homebrew_legacy_tracks_by_collection
  ON public.homebrew_legacy_tracks (collection_id);
CREATE INDEX IF NOT EXISTS homebrew_move_categories_by_collection
  ON public.homebrew_move_categories (collection_id);
CREATE INDEX IF NOT EXISTS homebrew_moves_by_collection
  ON public.homebrew_moves (collection_id);
CREATE INDEX IF NOT EXISTS homebrew_oracle_collections_by_collection
  ON public.homebrew_oracle_collections (collection_id);
CREATE INDEX IF NOT EXISTS homebrew_oracle_tables_by_collection
  ON public.homebrew_oracle_tables (collection_id);
CREATE INDEX IF NOT EXISTS homebrew_asset_collections_by_collection
  ON public.homebrew_asset_collections (collection_id);
CREATE INDEX IF NOT EXISTS homebrew_assets_by_collection
  ON public.homebrew_assets (collection_id);

ALTER TABLE public.homebrew_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_editors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_invite_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_condition_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_non_linear_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_impact_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_legacy_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_move_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_oracle_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_oracle_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_asset_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homebrew_assets ENABLE ROW LEVEL SECURITY;

-- Collections read publicly; anyone signed in can create one they own;
-- editors change titles and descriptions; only the creator deletes. The
-- trigger below keeps `creator` immutable, so editors can never steal a
-- collection and then delete it.
DROP POLICY IF EXISTS "homebrew_collections_select_public" ON public.homebrew_collections;
CREATE POLICY "homebrew_collections_select_public" ON public.homebrew_collections
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "homebrew_collections_insert_creator" ON public.homebrew_collections;
CREATE POLICY "homebrew_collections_insert_creator" ON public.homebrew_collections
  FOR INSERT TO authenticated WITH CHECK (creator = (select auth.uid()));

DROP POLICY IF EXISTS "homebrew_collections_update_editor" ON public.homebrew_collections;
CREATE POLICY "homebrew_collections_update_editor" ON public.homebrew_collections
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(id))
  WITH CHECK (private.is_homebrew_editor(id));

DROP POLICY IF EXISTS "homebrew_collections_delete_creator" ON public.homebrew_collections;
CREATE POLICY "homebrew_collections_delete_creator" ON public.homebrew_collections
  FOR DELETE TO authenticated USING (creator = (select auth.uid()));

GRANT SELECT ON public.homebrew_collections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_collections TO authenticated;

-- Editors and viewers are publicly listed (as the old collection documents
-- were) but change only through the database functions below: no write
-- policies, so direct inserts, updates and deletes fail.
DROP POLICY IF EXISTS "homebrew_editors_select_public" ON public.homebrew_editors;
CREATE POLICY "homebrew_editors_select_public" ON public.homebrew_editors
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "homebrew_viewers_select_public" ON public.homebrew_viewers;
CREATE POLICY "homebrew_viewers_select_public" ON public.homebrew_viewers
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.homebrew_editors TO anon, authenticated;
GRANT SELECT ON public.homebrew_viewers TO anon, authenticated;

-- Content rows read publicly; only editors of the owning collection write.
DROP POLICY IF EXISTS "homebrew_stats_select_public" ON public.homebrew_stats;
CREATE POLICY "homebrew_stats_select_public" ON public.homebrew_stats
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_stats_insert_editor" ON public.homebrew_stats;
CREATE POLICY "homebrew_stats_insert_editor" ON public.homebrew_stats
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_stats_update_editor" ON public.homebrew_stats;
CREATE POLICY "homebrew_stats_update_editor" ON public.homebrew_stats
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_stats_delete_editor" ON public.homebrew_stats;
CREATE POLICY "homebrew_stats_delete_editor" ON public.homebrew_stats
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

DROP POLICY IF EXISTS "homebrew_condition_meters_select_public" ON public.homebrew_condition_meters;
CREATE POLICY "homebrew_condition_meters_select_public" ON public.homebrew_condition_meters
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_condition_meters_insert_editor" ON public.homebrew_condition_meters;
CREATE POLICY "homebrew_condition_meters_insert_editor" ON public.homebrew_condition_meters
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_condition_meters_update_editor" ON public.homebrew_condition_meters;
CREATE POLICY "homebrew_condition_meters_update_editor" ON public.homebrew_condition_meters
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_condition_meters_delete_editor" ON public.homebrew_condition_meters;
CREATE POLICY "homebrew_condition_meters_delete_editor" ON public.homebrew_condition_meters
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

DROP POLICY IF EXISTS "homebrew_non_linear_meters_select_public" ON public.homebrew_non_linear_meters;
CREATE POLICY "homebrew_non_linear_meters_select_public" ON public.homebrew_non_linear_meters
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_non_linear_meters_insert_editor" ON public.homebrew_non_linear_meters;
CREATE POLICY "homebrew_non_linear_meters_insert_editor" ON public.homebrew_non_linear_meters
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_non_linear_meters_update_editor" ON public.homebrew_non_linear_meters;
CREATE POLICY "homebrew_non_linear_meters_update_editor" ON public.homebrew_non_linear_meters
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_non_linear_meters_delete_editor" ON public.homebrew_non_linear_meters;
CREATE POLICY "homebrew_non_linear_meters_delete_editor" ON public.homebrew_non_linear_meters
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

DROP POLICY IF EXISTS "homebrew_impact_categories_select_public" ON public.homebrew_impact_categories;
CREATE POLICY "homebrew_impact_categories_select_public" ON public.homebrew_impact_categories
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_impact_categories_insert_editor" ON public.homebrew_impact_categories;
CREATE POLICY "homebrew_impact_categories_insert_editor" ON public.homebrew_impact_categories
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_impact_categories_update_editor" ON public.homebrew_impact_categories;
CREATE POLICY "homebrew_impact_categories_update_editor" ON public.homebrew_impact_categories
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_impact_categories_delete_editor" ON public.homebrew_impact_categories;
CREATE POLICY "homebrew_impact_categories_delete_editor" ON public.homebrew_impact_categories
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

DROP POLICY IF EXISTS "homebrew_legacy_tracks_select_public" ON public.homebrew_legacy_tracks;
CREATE POLICY "homebrew_legacy_tracks_select_public" ON public.homebrew_legacy_tracks
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_legacy_tracks_insert_editor" ON public.homebrew_legacy_tracks;
CREATE POLICY "homebrew_legacy_tracks_insert_editor" ON public.homebrew_legacy_tracks
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_legacy_tracks_update_editor" ON public.homebrew_legacy_tracks;
CREATE POLICY "homebrew_legacy_tracks_update_editor" ON public.homebrew_legacy_tracks
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_legacy_tracks_delete_editor" ON public.homebrew_legacy_tracks;
CREATE POLICY "homebrew_legacy_tracks_delete_editor" ON public.homebrew_legacy_tracks
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

DROP POLICY IF EXISTS "homebrew_move_categories_select_public" ON public.homebrew_move_categories;
CREATE POLICY "homebrew_move_categories_select_public" ON public.homebrew_move_categories
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_move_categories_insert_editor" ON public.homebrew_move_categories;
CREATE POLICY "homebrew_move_categories_insert_editor" ON public.homebrew_move_categories
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_move_categories_update_editor" ON public.homebrew_move_categories;
CREATE POLICY "homebrew_move_categories_update_editor" ON public.homebrew_move_categories
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_move_categories_delete_editor" ON public.homebrew_move_categories;
CREATE POLICY "homebrew_move_categories_delete_editor" ON public.homebrew_move_categories
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

DROP POLICY IF EXISTS "homebrew_moves_select_public" ON public.homebrew_moves;
CREATE POLICY "homebrew_moves_select_public" ON public.homebrew_moves
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_moves_insert_editor" ON public.homebrew_moves;
CREATE POLICY "homebrew_moves_insert_editor" ON public.homebrew_moves
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_moves_update_editor" ON public.homebrew_moves;
CREATE POLICY "homebrew_moves_update_editor" ON public.homebrew_moves
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_moves_delete_editor" ON public.homebrew_moves;
CREATE POLICY "homebrew_moves_delete_editor" ON public.homebrew_moves
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

DROP POLICY IF EXISTS "homebrew_oracle_collections_select_public" ON public.homebrew_oracle_collections;
CREATE POLICY "homebrew_oracle_collections_select_public" ON public.homebrew_oracle_collections
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_oracle_collections_insert_editor" ON public.homebrew_oracle_collections;
CREATE POLICY "homebrew_oracle_collections_insert_editor" ON public.homebrew_oracle_collections
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_oracle_collections_update_editor" ON public.homebrew_oracle_collections;
CREATE POLICY "homebrew_oracle_collections_update_editor" ON public.homebrew_oracle_collections
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_oracle_collections_delete_editor" ON public.homebrew_oracle_collections;
CREATE POLICY "homebrew_oracle_collections_delete_editor" ON public.homebrew_oracle_collections
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

DROP POLICY IF EXISTS "homebrew_oracle_tables_select_public" ON public.homebrew_oracle_tables;
CREATE POLICY "homebrew_oracle_tables_select_public" ON public.homebrew_oracle_tables
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_oracle_tables_insert_editor" ON public.homebrew_oracle_tables;
CREATE POLICY "homebrew_oracle_tables_insert_editor" ON public.homebrew_oracle_tables
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_oracle_tables_update_editor" ON public.homebrew_oracle_tables;
CREATE POLICY "homebrew_oracle_tables_update_editor" ON public.homebrew_oracle_tables
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_oracle_tables_delete_editor" ON public.homebrew_oracle_tables;
CREATE POLICY "homebrew_oracle_tables_delete_editor" ON public.homebrew_oracle_tables
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

DROP POLICY IF EXISTS "homebrew_asset_collections_select_public" ON public.homebrew_asset_collections;
CREATE POLICY "homebrew_asset_collections_select_public" ON public.homebrew_asset_collections
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_asset_collections_insert_editor" ON public.homebrew_asset_collections;
CREATE POLICY "homebrew_asset_collections_insert_editor" ON public.homebrew_asset_collections
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_asset_collections_update_editor" ON public.homebrew_asset_collections;
CREATE POLICY "homebrew_asset_collections_update_editor" ON public.homebrew_asset_collections
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_asset_collections_delete_editor" ON public.homebrew_asset_collections;
CREATE POLICY "homebrew_asset_collections_delete_editor" ON public.homebrew_asset_collections
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

DROP POLICY IF EXISTS "homebrew_assets_select_public" ON public.homebrew_assets;
CREATE POLICY "homebrew_assets_select_public" ON public.homebrew_assets
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "homebrew_assets_insert_editor" ON public.homebrew_assets;
CREATE POLICY "homebrew_assets_insert_editor" ON public.homebrew_assets
  FOR INSERT TO authenticated WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_assets_update_editor" ON public.homebrew_assets;
CREATE POLICY "homebrew_assets_update_editor" ON public.homebrew_assets
  FOR UPDATE TO authenticated
  USING (private.is_homebrew_editor(collection_id))
  WITH CHECK (private.is_homebrew_editor(collection_id));
DROP POLICY IF EXISTS "homebrew_assets_delete_editor" ON public.homebrew_assets;
CREATE POLICY "homebrew_assets_delete_editor" ON public.homebrew_assets
  FOR DELETE TO authenticated USING (private.is_homebrew_editor(collection_id));

GRANT SELECT ON public.homebrew_stats TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_stats TO authenticated;
GRANT SELECT ON public.homebrew_condition_meters TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_condition_meters TO authenticated;
GRANT SELECT ON public.homebrew_non_linear_meters TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_non_linear_meters TO authenticated;
GRANT SELECT ON public.homebrew_impact_categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_impact_categories TO authenticated;
GRANT SELECT ON public.homebrew_legacy_tracks TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_legacy_tracks TO authenticated;
GRANT SELECT ON public.homebrew_move_categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_move_categories TO authenticated;
GRANT SELECT ON public.homebrew_moves TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_moves TO authenticated;
GRANT SELECT ON public.homebrew_oracle_collections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_oracle_collections TO authenticated;
GRANT SELECT ON public.homebrew_oracle_tables TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_oracle_tables TO authenticated;
GRANT SELECT ON public.homebrew_asset_collections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_asset_collections TO authenticated;
GRANT SELECT ON public.homebrew_assets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homebrew_assets TO authenticated;

-- Invite keys replace the old cloud functions. Accepting spends the key, so a
-- key cannot be reused once spent. Editors manage editors; anyone signed in
-- can hold a key, and only someone holding the matching key joins.
CREATE OR REPLACE FUNCTION public.homebrew_create_invite_key(p_collection_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_key text;
  new_key text;
BEGIN
  IF NOT private.is_homebrew_editor(p_collection_id) THEN
    RAISE EXCEPTION 'not a collection editor';
  END IF;
  SELECT key INTO existing_key FROM public.homebrew_invite_keys
    WHERE collection_id = p_collection_id
    ORDER BY created_at DESC
    LIMIT 1;
  IF existing_key IS NOT NULL THEN
    RETURN existing_key;
  END IF;
  INSERT INTO public.homebrew_invite_keys (collection_id, created_by)
    VALUES (p_collection_id, (select auth.uid()))
    RETURNING key INTO new_key;
  RETURN new_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.homebrew_collection_id_from_key(p_key text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  found_id uuid;
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT collection_id INTO found_id FROM public.homebrew_invite_keys
    WHERE key = p_key;
  RETURN found_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.homebrew_accept_invite(p_collection_id uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid;
  key_collection_id uuid;
BEGIN
  caller := (select auth.uid());
  IF caller IS NULL THEN
    RETURN false;
  END IF;
  SELECT collection_id INTO key_collection_id FROM public.homebrew_invite_keys
    WHERE key = p_key FOR UPDATE;
  -- The lock serializes concurrent accepts: the loser blocks until the
  -- winner's delete commits, then sees no key and fails closed.
  IF key_collection_id IS NULL OR key_collection_id <> p_collection_id THEN
    RETURN false;
  END IF;
  INSERT INTO public.homebrew_editors (collection_id, user_id)
    VALUES (p_collection_id, caller)
    ON CONFLICT (collection_id, user_id) DO NOTHING;
  DELETE FROM public.homebrew_invite_keys WHERE key = p_key;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.homebrew_remove_editor(p_collection_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid;
  target uuid;
BEGIN
  caller := (select auth.uid());
  IF caller IS NULL THEN
    RETURN false;
  END IF;
  IF NOT private.is_homebrew_editor(p_collection_id) THEN
    RETURN false;
  END IF;
  target := COALESCE(p_user_id, caller);
  DELETE FROM public.homebrew_editors
    WHERE collection_id = p_collection_id AND user_id = target;
  RETURN true;
END;
$$;

-- Viewers change only through these functions: anyone signed in can add
-- themselves (as the old rules allowed), while adding or removing anyone
-- else needs an editor.
CREATE OR REPLACE FUNCTION public.homebrew_add_viewer(p_collection_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid;
BEGIN
  caller := (select auth.uid());
  IF caller IS NULL THEN
    RETURN false;
  END IF;
  IF p_user_id <> caller AND NOT private.is_homebrew_editor(p_collection_id) THEN
    RETURN false;
  END IF;
  INSERT INTO public.homebrew_viewers (collection_id, user_id)
    VALUES (p_collection_id, p_user_id)
    ON CONFLICT (collection_id, user_id) DO NOTHING;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.homebrew_remove_viewer(p_collection_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid;
BEGIN
  caller := (select auth.uid());
  IF caller IS NULL THEN
    RETURN false;
  END IF;
  IF p_user_id <> caller AND NOT private.is_homebrew_editor(p_collection_id) THEN
    RETURN false;
  END IF;
  DELETE FROM public.homebrew_viewers
    WHERE collection_id = p_collection_id AND user_id = p_user_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.homebrew_create_invite_key(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homebrew_collection_id_from_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homebrew_accept_invite(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homebrew_remove_editor(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homebrew_add_viewer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homebrew_remove_viewer(uuid, uuid) TO authenticated;

-- The creator becomes an editor at once, so their first write succeeds.
CREATE OR REPLACE FUNCTION public.handle_homebrew_collection_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.homebrew_editors (collection_id, user_id)
    VALUES (NEW.id, NEW.creator)
    ON CONFLICT (collection_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS homebrew_collections_bootstrap_editor ON public.homebrew_collections;
CREATE TRIGGER homebrew_collections_bootstrap_editor
  AFTER INSERT ON public.homebrew_collections
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_collection_creator();

-- Ownership never moves through the data API: the editors function is the
-- only writer of the editors table, and this trigger guards the creator.
CREATE OR REPLACE FUNCTION public.handle_homebrew_collection_immutable_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.creator IS DISTINCT FROM OLD.creator THEN
    RAISE EXCEPTION 'homebrew collection creator cannot change';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS homebrew_collections_immutable_creator ON public.homebrew_collections;
CREATE TRIGGER homebrew_collections_immutable_creator
  BEFORE UPDATE ON public.homebrew_collections
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_collection_immutable_creator();

-- Keep updated_at fresh on every change: the shared listen helper drops
-- buffered events older than the row it already holds.
CREATE OR REPLACE FUNCTION public.handle_homebrew_updated_at()
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

DROP TRIGGER IF EXISTS homebrew_collections_updated_at ON public.homebrew_collections;
CREATE TRIGGER homebrew_collections_updated_at
  BEFORE UPDATE ON public.homebrew_collections
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_stats_updated_at ON public.homebrew_stats;
CREATE TRIGGER homebrew_stats_updated_at
  BEFORE UPDATE ON public.homebrew_stats
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_condition_meters_updated_at ON public.homebrew_condition_meters;
CREATE TRIGGER homebrew_condition_meters_updated_at
  BEFORE UPDATE ON public.homebrew_condition_meters
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_non_linear_meters_updated_at ON public.homebrew_non_linear_meters;
CREATE TRIGGER homebrew_non_linear_meters_updated_at
  BEFORE UPDATE ON public.homebrew_non_linear_meters
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_impact_categories_updated_at ON public.homebrew_impact_categories;
CREATE TRIGGER homebrew_impact_categories_updated_at
  BEFORE UPDATE ON public.homebrew_impact_categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_legacy_tracks_updated_at ON public.homebrew_legacy_tracks;
CREATE TRIGGER homebrew_legacy_tracks_updated_at
  BEFORE UPDATE ON public.homebrew_legacy_tracks
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_move_categories_updated_at ON public.homebrew_move_categories;
CREATE TRIGGER homebrew_move_categories_updated_at
  BEFORE UPDATE ON public.homebrew_move_categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_moves_updated_at ON public.homebrew_moves;
CREATE TRIGGER homebrew_moves_updated_at
  BEFORE UPDATE ON public.homebrew_moves
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_oracle_collections_updated_at ON public.homebrew_oracle_collections;
CREATE TRIGGER homebrew_oracle_collections_updated_at
  BEFORE UPDATE ON public.homebrew_oracle_collections
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_oracle_tables_updated_at ON public.homebrew_oracle_tables;
CREATE TRIGGER homebrew_oracle_tables_updated_at
  BEFORE UPDATE ON public.homebrew_oracle_tables
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_asset_collections_updated_at ON public.homebrew_asset_collections;
CREATE TRIGGER homebrew_asset_collections_updated_at
  BEFORE UPDATE ON public.homebrew_asset_collections
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();
DROP TRIGGER IF EXISTS homebrew_assets_updated_at ON public.homebrew_assets;
CREATE TRIGGER homebrew_assets_updated_at
  BEFORE UPDATE ON public.homebrew_assets
  FOR EACH ROW EXECUTE FUNCTION public.handle_homebrew_updated_at();

-- Live updates stream as plain row changes: everything here reads publicly,
-- so no broadcast topics are needed. The migrate service runs before live
-- updates boots, so the publication may not exist yet: create it when
-- missing, and never add the same table twice.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'homebrew_collections',
    'homebrew_editors',
    'homebrew_viewers',
    'homebrew_stats',
    'homebrew_condition_meters',
    'homebrew_non_linear_meters',
    'homebrew_impact_categories',
    'homebrew_legacy_tracks',
    'homebrew_move_categories',
    'homebrew_moves',
    'homebrew_oracle_collections',
    'homebrew_oracle_tables',
    'homebrew_asset_collections',
    'homebrew_assets'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
      CREATE PUBLICATION supabase_realtime;
    END IF;
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

-- Homebrew images live in a guarded bucket: anyone reads them, only
-- signed-in people upload or manage them, and files stay under 5MB like the
-- old rules required. The storage service creates its schema on first boot,
-- which runs after these migrations, so the bucket and its access rules are
-- created idempotently by this function: the data layer calls it before the
-- first upload, and the migration calls it too for stacks where storage is
-- already up.
CREATE OR REPLACE FUNCTION public.homebrew_ensure_image_bucket()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('homebrew-images', 'homebrew-images', true, 5242880)
    ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'homebrew_images_select_public'
  ) THEN
    CREATE POLICY "homebrew_images_select_public" ON storage.objects
      FOR SELECT TO anon, authenticated USING (bucket_id = 'homebrew-images');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'homebrew_images_insert_signed_in'
  ) THEN
    CREATE POLICY "homebrew_images_insert_signed_in" ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'homebrew-images');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'homebrew_images_update_signed_in'
  ) THEN
    CREATE POLICY "homebrew_images_update_signed_in" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'homebrew-images')
      WITH CHECK (bucket_id = 'homebrew-images');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'homebrew_images_delete_signed_in'
  ) THEN
    CREATE POLICY "homebrew_images_delete_signed_in" ON storage.objects
      FOR DELETE TO authenticated USING (bucket_id = 'homebrew-images');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.homebrew_ensure_image_bucket() TO authenticated;

DO $$
BEGIN
  PERFORM public.homebrew_ensure_image_bucket();
END $$;

COMMIT;
