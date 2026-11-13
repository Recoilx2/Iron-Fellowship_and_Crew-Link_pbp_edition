-- Chat channels: one named stream of posts per campaign. Every campaign is
-- born with an in-character channel and an out-of-character channel (both
-- created inside create_campaign below, in the same operation); GMs create,
-- rename and archive more, and the two starting channels can never be
-- archived or deleted.
--
-- Only campaign members read channels; only GMs write them. Nobody outside
-- the campaign reads anything, so the database -- never the interface --
-- decides who sees the game. There is deliberately no DELETE policy:
-- finished scenes archive instead of vanishing, and a missing policy fails
-- closed for everyone.
--
-- Room left for later chat tickets without touching existing data:
-- - threads: posts carry an optional parent post pointer (#26 owns posts)
-- - whispers: posts carry an optional recipient list, honoured by the
--   access rules (#112 owns private channels and direct messages)
-- - reactions: a separate table keyed by post and person
-- - search: a trigram index over post text, added with the posts table
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand. It
-- runs after the campaigns migration, whose create_campaign it extends and
-- whose updated_at trigger it reuses.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'IC' CHECK (kind IN ('IC', 'OOC')),
  is_starting boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_channels_by_campaign
  ON public.chat_channels (campaign_id);

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;

-- Members read every channel of their campaign; outsiders read nothing.
DROP POLICY IF EXISTS "chat_channels_select_members" ON public.chat_channels;
CREATE POLICY "chat_channels_select_members" ON public.chat_channels
  FOR SELECT TO authenticated USING (
    private.is_campaign_member(campaign_id)
  );

-- Only GMs create channels, and created channels are never starting
-- channels: the two starting rows belong to create_campaign alone.
DROP POLICY IF EXISTS "chat_channels_insert_gm" ON public.chat_channels;
CREATE POLICY "chat_channels_insert_gm" ON public.chat_channels
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_gm(campaign_id)
    AND NOT is_starting
  );

-- Only GMs rename and archive channels. Starting channels stay renamable
-- here; the keep_starting_channels trigger below is what refuses to archive,
-- un-start or delete them.
DROP POLICY IF EXISTS "chat_channels_update_gm" ON public.chat_channels;
CREATE POLICY "chat_channels_update_gm" ON public.chat_channels
  FOR UPDATE TO authenticated
  USING (private.is_campaign_gm(campaign_id))
  WITH CHECK (private.is_campaign_gm(campaign_id));

GRANT SELECT, INSERT, UPDATE ON public.chat_channels TO authenticated;

DROP TRIGGER IF EXISTS chat_channels_updated_at ON public.chat_channels;
CREATE TRIGGER chat_channels_updated_at
  BEFORE UPDATE ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

-- The starting channels stay: no archive may retire them, no delete may
-- remove them, and the starting flag itself never flips either way.
-- Renaming stays allowed so a GM can title the opening scene. Inserts
-- already reject starting rows above; this trigger backstops the rest.
CREATE OR REPLACE FUNCTION public.keep_starting_channels()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_starting THEN
      RAISE EXCEPTION 'starting channels cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_starting IS DISTINCT FROM NEW.is_starting THEN
    RAISE EXCEPTION 'starting channels stay starting channels';
  END IF;
  IF OLD.is_starting AND NEW.archived THEN
    RAISE EXCEPTION 'starting channels cannot be archived';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_channels_keep_starting ON public.chat_channels;
CREATE TRIGGER chat_channels_keep_starting
  BEFORE UPDATE OR DELETE ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.keep_starting_channels();

-- Creating a campaign creates its starting channels in the same operation:
-- "In character" (IC) for play, "Out of character" (OOC) for table talk.
-- The founder owns both rows; the channel policies above never see these
-- inserts because create_campaign runs as the database owner.
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
  INSERT INTO public.chat_channels (campaign_id, name, kind, is_starting, created_by)
  VALUES
    (new_id, 'In character', 'IC', true, (select auth.uid())),
    (new_id, 'Out of character', 'OOC', true, (select auth.uid()));
  RETURN new_id;
END;
$$;

ALTER TABLE public.chat_channels REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'chat_channels'
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
