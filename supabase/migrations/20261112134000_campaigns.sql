-- Campaigns and everything that belongs to one campaign: the campaign row
-- itself, the roster hook (campaign_members, owned by an earlier ticket),
-- tracks, shared assets, settings and the campaign roll log.
--
-- A campaign is visible only to its members. Members read and change the
-- shared tables; only GMs (and the founding creator) delete the campaign,
-- and only GMs change the roster. GM-only rolls stay in the same log table
-- but are hidden from players by row-level security, so the database --
-- never the interface -- decides who sees them.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand.
--
-- Notes for later tickets:
-- - world_id has no foreign key yet: the worlds table lands in a later
--   ticket, which adds the reference. Until then the link is a plain uuid.
-- - Notes for campaigns stay on Firebase until the notes ticket ports them
--   to server-saved shared editing; deleting a campaign leaves that cleanup
--   to the notes ticket. The campaign game log moves into chat in the chat
--   spec; this ticket ports the solo-style campaign log as-is.
-- - Broadcast topics (campaign:<id>, campaign:<id>:gm) are not created here:
--   the migrate service runs before the live-update service boots, so the
--   realtime schema does not exist yet when this file applies. Shared rows
--   stream over plain row changes instead, with the same per-subscriber
--   access checks; the shared listen helper re-fetches on every subscribe.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  world_id uuid NULL,
  type text NOT NULL DEFAULT 'guided' CHECK (type IN ('solo', 'co-op', 'guided')),
  theme text NULL,
  custom_tracks jsonb NOT NULL DEFAULT '{}'::jsonb,
  condition_meters jsonb NOT NULL DEFAULT '{}'::jsonb,
  special_tracks jsonb NOT NULL DEFAULT '{}'::jsonb,
  expansion_ids text[] NOT NULL DEFAULT '{}',
  hidden_asset_ids text[] NOT NULL DEFAULT '{}',
  hidden_oracle_ids text[] NOT NULL DEFAULT '{}',
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Only members see the campaign; outsiders cannot read it at all.
DROP POLICY IF EXISTS "campaigns_select_members" ON public.campaigns;
CREATE POLICY "campaigns_select_members" ON public.campaigns
  FOR SELECT TO authenticated USING (
    private.is_campaign_member(id)
  );

-- Campaign rows are created through public.create_campaign below, which owns
-- the founder-membership bootstrap, so there is no direct INSERT policy.
-- Members change the shared fields; the roster stays GM-only.
DROP POLICY IF EXISTS "campaigns_update_members" ON public.campaigns;
CREATE POLICY "campaigns_update_members" ON public.campaigns
  FOR UPDATE TO authenticated
  USING (private.is_campaign_member(id))
  WITH CHECK (private.is_campaign_member(id));

-- GMs delete the campaign; the founding creator always can, so solo and
-- guideless campaigns stay removable by the person who started them.
DROP POLICY IF EXISTS "campaigns_delete_gm_or_creator" ON public.campaigns;
CREATE POLICY "campaigns_delete_gm_or_creator" ON public.campaigns
  FOR DELETE TO authenticated USING (
    private.is_campaign_gm(id) OR created_by = (select auth.uid())
  );

GRANT SELECT, UPDATE, DELETE ON public.campaigns TO authenticated;

-- One shared updated_at trigger for every campaign table: the shared listen
-- helper drops buffered events older than the row it already holds.
CREATE OR REPLACE FUNCTION public.handle_campaign_updated_at()
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

DROP TRIGGER IF EXISTS campaigns_updated_at ON public.campaigns;
CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

-- The roster follows its campaign: deleting the campaign removes every
-- membership. Promised by the campaign_members migration, which could not
-- add the reference before the campaigns table existed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_members_campaign_id_fkey'
  ) THEN
    ALTER TABLE public.campaign_members
      ADD CONSTRAINT campaign_members_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns (id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Members remove themselves: leaving a campaign deletes their own roster
-- row. Removing anyone else stays GM-only under the earlier policy.
DROP POLICY IF EXISTS "campaign_members_delete_self" ON public.campaign_members;
CREATE POLICY "campaign_members_delete_self" ON public.campaign_members
  FOR DELETE TO authenticated USING (
    user_id = (select auth.uid())
  );

-- Characters unlink instead of vanishing: deleting a campaign must never
-- delete anyone's character. Promised by the characters migration, which
-- could not add the reference before the campaigns table existed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'characters_campaign_id_fkey'
  ) THEN
    ALTER TABLE public.characters
      ADD CONSTRAINT characters_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.campaign_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS campaign_tracks_by_campaign
  ON public.campaign_tracks (campaign_id);

ALTER TABLE public.campaign_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_tracks_select_members" ON public.campaign_tracks;
CREATE POLICY "campaign_tracks_select_members" ON public.campaign_tracks
  FOR SELECT TO authenticated USING (
    private.is_campaign_member(campaign_id)
  );

DROP POLICY IF EXISTS "campaign_tracks_insert_members" ON public.campaign_tracks;
CREATE POLICY "campaign_tracks_insert_members" ON public.campaign_tracks
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_member(campaign_id)
  );

DROP POLICY IF EXISTS "campaign_tracks_update_members" ON public.campaign_tracks;
CREATE POLICY "campaign_tracks_update_members" ON public.campaign_tracks
  FOR UPDATE TO authenticated
  USING (private.is_campaign_member(campaign_id))
  WITH CHECK (private.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "campaign_tracks_delete_members" ON public.campaign_tracks;
CREATE POLICY "campaign_tracks_delete_members" ON public.campaign_tracks
  FOR DELETE TO authenticated USING (
    private.is_campaign_member(campaign_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_tracks TO authenticated;

DROP TRIGGER IF EXISTS campaign_tracks_updated_at ON public.campaign_tracks;
CREATE TRIGGER campaign_tracks_updated_at
  BEFORE UPDATE ON public.campaign_tracks
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

CREATE TABLE IF NOT EXISTS public.campaign_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  datasworn_id text NOT NULL DEFAULT '',
  enabled_abilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  option_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  control_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_assets_by_campaign
  ON public.campaign_assets (campaign_id);

ALTER TABLE public.campaign_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_assets_select_members" ON public.campaign_assets;
CREATE POLICY "campaign_assets_select_members" ON public.campaign_assets
  FOR SELECT TO authenticated USING (
    private.is_campaign_member(campaign_id)
  );

DROP POLICY IF EXISTS "campaign_assets_insert_members" ON public.campaign_assets;
CREATE POLICY "campaign_assets_insert_members" ON public.campaign_assets
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_member(campaign_id)
  );

DROP POLICY IF EXISTS "campaign_assets_update_members" ON public.campaign_assets;
CREATE POLICY "campaign_assets_update_members" ON public.campaign_assets
  FOR UPDATE TO authenticated
  USING (private.is_campaign_member(campaign_id))
  WITH CHECK (private.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "campaign_assets_delete_members" ON public.campaign_assets;
CREATE POLICY "campaign_assets_delete_members" ON public.campaign_assets
  FOR DELETE TO authenticated USING (
    private.is_campaign_member(campaign_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_assets TO authenticated;

DROP TRIGGER IF EXISTS campaign_assets_updated_at ON public.campaign_assets;
CREATE TRIGGER campaign_assets_updated_at
  BEFORE UPDATE ON public.campaign_assets
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

CREATE TABLE IF NOT EXISTS public.campaign_settings (
  campaign_id uuid PRIMARY KEY REFERENCES public.campaigns (id) ON DELETE CASCADE,
  custom_stats text[] NOT NULL DEFAULT '{}',
  custom_tracks jsonb NOT NULL DEFAULT '{}'::jsonb,
  hidden_custom_oracle_ids text[] NOT NULL DEFAULT '{}',
  hidden_custom_move_ids text[] NOT NULL DEFAULT '{}',
  hide_delve_moves boolean NOT NULL DEFAULT false,
  hide_delve_oracles boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_settings_select_members" ON public.campaign_settings;
CREATE POLICY "campaign_settings_select_members" ON public.campaign_settings
  FOR SELECT TO authenticated USING (
    private.is_campaign_member(campaign_id)
  );

DROP POLICY IF EXISTS "campaign_settings_insert_members" ON public.campaign_settings;
CREATE POLICY "campaign_settings_insert_members" ON public.campaign_settings
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_member(campaign_id)
  );

DROP POLICY IF EXISTS "campaign_settings_update_members" ON public.campaign_settings;
CREATE POLICY "campaign_settings_update_members" ON public.campaign_settings
  FOR UPDATE TO authenticated
  USING (private.is_campaign_member(campaign_id))
  WITH CHECK (private.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "campaign_settings_delete_members" ON public.campaign_settings;
CREATE POLICY "campaign_settings_delete_members" ON public.campaign_settings
  FOR DELETE TO authenticated USING (
    private.is_campaign_member(campaign_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_settings TO authenticated;

DROP TRIGGER IF EXISTS campaign_settings_updated_at ON public.campaign_settings;
CREATE TRIGGER campaign_settings_updated_at
  BEFORE UPDATE ON public.campaign_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

-- The campaign roll log. The whole roll travels as one JSON document with
-- its timestamp inside; created_at orders the log. GM-only rolls are hidden
-- from players by this policy, not by an interface filter: players never
-- receive those rows, over reads or over live updates. Changes are limited
-- to GMs and the person who rolled, checked against the roll itself.
CREATE TABLE IF NOT EXISTS public.campaign_rolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  roll jsonb NOT NULL,
  gms_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_rolls_by_campaign
  ON public.campaign_rolls (campaign_id);

ALTER TABLE public.campaign_rolls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_rolls_select_members" ON public.campaign_rolls;
CREATE POLICY "campaign_rolls_select_members" ON public.campaign_rolls
  FOR SELECT TO authenticated USING (
    private.is_campaign_member(campaign_id)
    AND (NOT gms_only OR private.is_campaign_gm(campaign_id))
  );

DROP POLICY IF EXISTS "campaign_rolls_insert_members" ON public.campaign_rolls;
CREATE POLICY "campaign_rolls_insert_members" ON public.campaign_rolls
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_member(campaign_id)
    AND (NOT gms_only OR private.is_campaign_gm(campaign_id))
  );

DROP POLICY IF EXISTS "campaign_rolls_update_author_or_gm" ON public.campaign_rolls;
CREATE POLICY "campaign_rolls_update_author_or_gm" ON public.campaign_rolls
  FOR UPDATE TO authenticated
  USING (
    private.is_campaign_gm(campaign_id)
    OR (roll ->> 'uid') = (select auth.uid())::text
  )
  WITH CHECK (
    private.is_campaign_member(campaign_id)
    AND (NOT gms_only OR private.is_campaign_gm(campaign_id))
  );

DROP POLICY IF EXISTS "campaign_rolls_delete_author_or_gm" ON public.campaign_rolls;
CREATE POLICY "campaign_rolls_delete_author_or_gm" ON public.campaign_rolls
  FOR DELETE TO authenticated USING (
    private.is_campaign_gm(campaign_id)
    OR (roll ->> 'uid') = (select auth.uid())::text
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_rolls TO authenticated;

DROP TRIGGER IF EXISTS campaign_rolls_updated_at ON public.campaign_rolls;
CREATE TRIGGER campaign_rolls_updated_at
  BEFORE UPDATE ON public.campaign_rolls
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

-- Creating a campaign bootstraps its roster: the members table only lets
-- existing GMs insert, so the founding membership cannot go through the
-- client. Co-op founders start as GMs; solo and guided founders start as
-- players, matching the previous document shape.
CREATE OR REPLACE FUNCTION public.create_campaign(cname text, ctype text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_id uuid;
  new_role text;
BEGIN
  IF ctype NOT IN ('solo', 'co-op', 'guided') THEN
    RAISE EXCEPTION 'unknown campaign type: %', ctype;
  END IF;
  IF cname IS NULL OR length(trim(cname)) = 0 THEN
    RAISE EXCEPTION 'campaign name is required';
  END IF;
  new_role := CASE WHEN ctype = 'co-op' THEN 'gm' ELSE 'player' END;
  INSERT INTO public.campaigns (name, type, created_by)
  VALUES (cname, ctype, (select auth.uid()))
  RETURNING id INTO new_id;
  INSERT INTO public.campaign_members (campaign_id, user_id, role)
  VALUES (new_id, (select auth.uid()), new_role);
  RETURN new_id;
END;
$$;

-- Joining from an invite link adds the caller as a player. The link carries
-- the campaign id, so anyone holding it may join -- exactly what the link
-- means -- while the tables themselves stay members-only. Rejoining is a
-- no-op. The returned name lets the join screen greet the newcomer.
CREATE OR REPLACE FUNCTION public.join_campaign(cid uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.campaigns AS c WHERE c.id = cid) THEN
    RAISE EXCEPTION 'campaign not found';
  END IF;
  INSERT INTO public.campaign_members (campaign_id, user_id, role)
  VALUES (cid, (select auth.uid()), 'player')
  ON CONFLICT (campaign_id, user_id) DO NOTHING;
  RETURN QUERY SELECT c.id, c.name FROM public.campaigns AS c WHERE c.id = cid;
END;
$$;

-- Reading a campaign name before joining, so the invite screen can show
-- which campaign the link points at without opening the campaign itself.
CREATE OR REPLACE FUNCTION public.preview_campaign(cid uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.id, c.name FROM public.campaigns AS c WHERE c.id = cid;
$$;

-- Leaving, and GMs removing someone else: unlink their characters from the
-- campaign, then drop the roster row. Anyone may leave themselves; only GMs
-- may remove other members.
CREATE OR REPLACE FUNCTION public.remove_campaign_member(cid uuid, target_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid;
BEGIN
  caller := (select auth.uid());
  IF target_uid IS DISTINCT FROM caller AND NOT private.is_campaign_gm(cid) THEN
    RAISE EXCEPTION 'only GMs remove other members' USING ERRCODE = '42501';
  END IF;
  UPDATE public.characters SET campaign_id = NULL
  WHERE campaign_id = cid AND owner_id = target_uid;
  DELETE FROM public.campaign_members
  WHERE campaign_id = cid AND user_id = target_uid;
END;
$$;

-- Taking one character out of a campaign without deleting it. The owner may
-- always unlink their own character; anyone else must GM the campaign.
CREATE OR REPLACE FUNCTION public.unlink_campaign_character(char_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid;
  camp uuid;
BEGIN
  caller := (select auth.uid());
  SELECT campaign_id INTO camp FROM public.characters WHERE id = char_id;
  IF camp IS NULL THEN
    RETURN;
  END IF;
  IF NOT (
    private.is_campaign_gm(camp)
    OR EXISTS (
      SELECT 1 FROM public.characters
      WHERE id = char_id AND owner_id = caller
    )
  ) THEN
    RAISE EXCEPTION 'only the owner or a GM removes a character' USING ERRCODE = '42501';
  END IF;
  UPDATE public.characters SET campaign_id = NULL WHERE id = char_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_campaign(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_campaign_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_campaign_character(uuid) TO authenticated;

-- Member-visible rows stream as plain row changes: each subscriber's channel
-- is filtered to the rows they may see, and row-level security drops the
-- rest. The roster joins the publication here: it predates the campaigns
-- table, so it could not be published before. The migrate service runs
-- before live updates boots, so the publication may not exist yet: create
-- it when missing, and never add the same table twice.
ALTER TABLE public.campaigns REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_members REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_tracks REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_assets REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_settings REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_rolls REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'campaigns',
    'campaign_members',
    'campaign_tracks',
    'campaign_assets',
    'campaign_settings',
    'campaign_rolls'
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
