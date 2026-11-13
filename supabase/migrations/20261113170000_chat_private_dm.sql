-- Private channels and direct messages (#112, part of spec #9).
--
-- A GM creates a private channel for chosen people -- a side quest for two
-- characters, for example -- and adds or removes people at any time. Only
-- its members and the campaign's GMs see it or its posts; someone removed
-- loses access straight away, including live updates. Any campaign member
-- messages another member directly from the People list: a direct message is
-- visible only to the two people in it, and GMs who are not in it cannot
-- read it or see that it exists.
--
-- The roster lives in the database beside the channels, and the access rules
-- below enforce it on channels, posts, membership rows and live updates, the
-- same as the rest of chat: the two starting channels and other public
-- channels stay visible to every member. Chat images (#28) are not here yet;
-- they reuse private.can_read_channel when they land.
--
-- Writes go through the three functions at the bottom, never through direct
-- row policies, so a missing policy fails closed: GMs create private
-- channels and set their roster, any member opens a DM with another member.
-- A roster change bumps the parent channel, so an open subscription either
-- receives the revoked row at once or drops it on the next reconcile fetch.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand. It
-- runs after the channels and posts migrations, whose policies it replaces
-- and whose updated_at trigger it reuses.

BEGIN;

-- Public, private or DM. Starting channels stay public (guarded below), and
-- a channel never converts afterwards: it is born with its visibility.
ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private', 'dm'));

-- One row per person in a private channel or DM. Public channels need no
-- rows: every campaign member is already in them.
CREATE TABLE IF NOT EXISTS public.chat_channel_members (
  channel_id uuid NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_channel_members_by_user
  ON public.chat_channel_members (user_id);

ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;

-- Whether the signed-in person sits in this channel's roster.
CREATE OR REPLACE FUNCTION private.is_channel_member(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channel_members
    WHERE channel_id = cid AND user_id = (select auth.uid())
  );
$$;

-- The one visibility check every chat policy reads through. Public channels
-- belong to every campaign member; private channels belong to their members
-- and the campaign's GMs; DMs belong to their two members alone, so a GM
-- who is not in one cannot read it or see that it exists.
CREATE OR REPLACE FUNCTION private.can_read_channel(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels AS ch
    WHERE ch.id = cid
      AND (
        (ch.visibility = 'public' AND private.is_campaign_member(ch.campaign_id))
        OR (ch.visibility = 'private' AND (private.is_channel_member(ch.id) OR private.is_campaign_gm(ch.campaign_id)))
        OR (ch.visibility = 'dm' AND private.is_channel_member(ch.id))
      )
  );
$$;

-- Channels read through the visibility check; outsiders read nothing.
DROP POLICY IF EXISTS "chat_channels_select_members" ON public.chat_channels;
DROP POLICY IF EXISTS "chat_channels_select_visible" ON public.chat_channels;
CREATE POLICY "chat_channels_select_visible" ON public.chat_channels
  FOR SELECT TO authenticated USING (
    private.can_read_channel(id)
  );

-- GMs create every kind of channel; starting rows never belong to anyone
-- but create_campaign. Members open DMs through get_or_create_dm_channel
-- below, which inserts as the database owner: there is deliberately no
-- member INSERT policy, so direct row writes fail closed for everyone
-- but GMs.

-- GMs rename and archive, but never a DM they cannot see: blind writes stay
-- refused even for GMs. Conversions stay refused beside the trigger below.
DROP POLICY IF EXISTS "chat_channels_update_gm" ON public.chat_channels;
CREATE POLICY "chat_channels_update_gm" ON public.chat_channels
  FOR UPDATE TO authenticated
  USING (private.is_campaign_gm(campaign_id) AND visibility <> 'dm')
  WITH CHECK (private.is_campaign_gm(campaign_id) AND visibility <> 'dm');

-- Starting channels stay public as well as unarchivable; channels never
-- convert between public, private and DM after they are born.
CREATE OR REPLACE FUNCTION public.keep_channel_visibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    RAISE EXCEPTION 'channels keep their visibility';
  END IF;
  IF OLD.is_starting AND NEW.visibility <> 'public' THEN
    RAISE EXCEPTION 'starting channels stay public';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_channels_keep_visibility ON public.chat_channels;
CREATE TRIGGER chat_channels_keep_visibility
  BEFORE UPDATE ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.keep_channel_visibility();

-- Posts read and post through the same visibility check: members and GMs in
-- private channels, the two members alone in DMs. The speaker, archive and
-- text rules from the posts migration stand unchanged.
DROP POLICY IF EXISTS "chat_posts_select_members" ON public.chat_posts;
DROP POLICY IF EXISTS "chat_posts_select_visible" ON public.chat_posts;
CREATE POLICY "chat_posts_select_visible" ON public.chat_posts
  FOR SELECT TO authenticated USING (
    private.can_read_channel(chat_posts.channel_id)
  );

DROP POLICY IF EXISTS "chat_posts_insert_members" ON public.chat_posts;
DROP POLICY IF EXISTS "chat_posts_insert_visible" ON public.chat_posts;
CREATE POLICY "chat_posts_insert_visible" ON public.chat_posts
  FOR INSERT TO authenticated WITH CHECK (
    author_id = (select auth.uid())
    AND private.can_read_channel(chat_posts.channel_id)
    AND EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = chat_posts.channel_id
        AND NOT ch.archived
    )
    AND (
      speaker_character_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.characters c
        JOIN public.chat_channels ch ON ch.id = chat_posts.channel_id
        WHERE c.id = chat_posts.speaker_character_id
          AND c.owner_id = (select auth.uid())
          AND c.campaign_id = ch.campaign_id
      )
    )
  );

-- The roster reads through the same visibility check, so a GM who is not in
-- a DM sees neither its posts nor its members. There are deliberately no
-- INSERT, UPDATE or DELETE policies: the functions below own every roster
-- write, and a missing policy fails closed for everyone else.
DROP POLICY IF EXISTS "chat_channel_members_select_visible" ON public.chat_channel_members;
CREATE POLICY "chat_channel_members_select_visible" ON public.chat_channel_members
  FOR SELECT TO authenticated USING (
    private.can_read_channel(chat_channel_members.channel_id)
  );

GRANT SELECT ON public.chat_channel_members TO authenticated;

-- A GM's private channel for chosen people, roster and all, in one
-- operation. Everyone named must already belong to the campaign.
CREATE OR REPLACE FUNCTION public.create_private_channel(cid uuid, cname text, ckind text, member_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_id uuid;
  mid uuid;
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'must be logged in to create a private channel' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_campaign_gm(cid) THEN
    RAISE EXCEPTION 'only campaign GMs create private channels' USING ERRCODE = '42501';
  END IF;
  IF ckind NOT IN ('IC', 'OOC') THEN
    RAISE EXCEPTION 'channel kind must be IC or OOC';
  END IF;
  IF cname IS NULL OR length(trim(cname)) = 0 THEN
    RAISE EXCEPTION 'channel name is required';
  END IF;
  new_id := gen_random_uuid();
  INSERT INTO public.chat_channels (id, campaign_id, name, kind, visibility)
  VALUES (new_id, cid, trim(cname), ckind, 'private');
  FOREACH mid IN ARRAY member_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.campaign_members
      WHERE campaign_id = cid AND user_id = mid
    ) THEN
      RAISE EXCEPTION 'every member of a private channel belongs to its campaign' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.chat_channel_members (channel_id, user_id)
    VALUES (new_id, mid)
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN new_id;
END;
$$;

-- A GM's new roster for a private channel, replacing the old one outright.
-- DMs keep their pair and public channels need no roster, so both refuse.
CREATE OR REPLACE FUNCTION public.set_channel_members(chid uuid, member_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cid uuid;
  vis text;
  mid uuid;
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'must be logged in to change a channel roster' USING ERRCODE = '42501';
  END IF;
  SELECT campaign_id, visibility INTO cid, vis
  FROM public.chat_channels WHERE id = chid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel not found' USING ERRCODE = '42501';
  END IF;
  IF vis <> 'private' THEN
    RAISE EXCEPTION 'only private channels have a managed roster' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_campaign_gm(cid) THEN
    RAISE EXCEPTION 'only campaign GMs change a private channel roster' USING ERRCODE = '42501';
  END IF;
  FOREACH mid IN ARRAY member_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.campaign_members
      WHERE campaign_id = cid AND user_id = mid
    ) THEN
      RAISE EXCEPTION 'every member of a private channel belongs to its campaign' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  DELETE FROM public.chat_channel_members
  WHERE channel_id = chid AND NOT (user_id = ANY (member_ids));
  INSERT INTO public.chat_channel_members (channel_id, user_id)
  SELECT chid, unnest(member_ids)
  ON CONFLICT DO NOTHING;
END;
$$;

-- A member's DM with another member: the existing one when the pair already
-- talks, a new one otherwise. Campaign outsiders and talking to oneself
-- both refuse, and a GM gains nothing here they could not already see.
CREATE OR REPLACE FUNCTION public.get_or_create_dm_channel(cid uuid, other_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me uuid;
  existing uuid;
  new_id uuid;
BEGIN
  me := (select auth.uid());
  IF me IS NULL THEN
    RAISE EXCEPTION 'must be logged in to message someone' USING ERRCODE = '42501';
  END IF;
  IF other_id = me THEN
    RAISE EXCEPTION 'cannot message yourself';
  END IF;
  IF NOT private.is_campaign_member(cid) THEN
    RAISE EXCEPTION 'only campaign members start direct messages' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_members
    WHERE campaign_id = cid AND user_id = other_id
  ) THEN
    RAISE EXCEPTION 'direct messages stay inside the campaign' USING ERRCODE = '42501';
  END IF;
  SELECT ch.id INTO existing
  FROM public.chat_channels AS ch
  WHERE ch.campaign_id = cid
    AND ch.visibility = 'dm'
    AND EXISTS (
      SELECT 1 FROM public.chat_channel_members AS m
      WHERE m.channel_id = ch.id AND m.user_id = me
    )
    AND EXISTS (
      SELECT 1 FROM public.chat_channel_members AS m
      WHERE m.channel_id = ch.id AND m.user_id = other_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_channel_members AS m
      WHERE m.channel_id = ch.id AND m.user_id NOT IN (me, other_id)
    )
  LIMIT 1;
  IF FOUND THEN
    RETURN existing;
  END IF;
  new_id := gen_random_uuid();
  INSERT INTO public.chat_channels (id, campaign_id, name, kind, visibility)
  VALUES (new_id, cid, 'Direct message', 'OOC', 'dm');
  INSERT INTO public.chat_channel_members (channel_id, user_id)
  VALUES (new_id, me), (new_id, other_id);
  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_private_channel(uuid, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_channel_members(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm_channel(uuid, uuid) TO authenticated;

-- A roster change bumps the parent channel, so an open subscription either
-- receives the revoked row at once or drops it on the next reconcile fetch.
CREATE OR REPLACE FUNCTION private.touch_channel_on_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.chat_channels AS ch
  SET updated_at = now()
  WHERE ch.id = COALESCE(NEW.channel_id, OLD.channel_id);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_channel_members_touch_channel ON public.chat_channel_members;
CREATE TRIGGER chat_channel_members_touch_channel
  AFTER INSERT OR DELETE ON public.chat_channel_members
  FOR EACH ROW EXECUTE FUNCTION private.touch_channel_on_membership_change();

ALTER TABLE public.chat_channel_members REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'chat_channel_members'
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
