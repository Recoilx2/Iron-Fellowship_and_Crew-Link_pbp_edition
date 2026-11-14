-- Chat roll posts: rolling from the chat composer (#29).
--
-- A post may now carry a roll beside its text: a move, stat, oracle or
-- custom-dice result in the app's existing roll shape, stored as one JSON
-- document with its timestamp inside, exactly as the campaign roll log
-- stores it. The dice result can never change: a trigger below refuses any
-- update touching the roll or its GM-only flag, so when text edits arrive
-- (#27) only the words around the dice may move. A roll stands in for the
-- words: a roll-only post is a bare result, while a text-only post keeps the
-- old rule, and emptiness of text, roll and images together is still
-- refused (deleted posts keep their cleared row, per #27).
--
-- A GM-only roll post is visible only to GMs: the read and write rules
-- narrow GM-only rows to GMs, enforced by the database -- never by an
-- interface filter -- so GM-only rolls stay hidden over reads and over
-- live updates (`postgres_changes` only sends rows its reader may read).
-- Never hard-delete a GM-only post: deletion would broadcast the row.
--
-- This file sorts last of the same-stamp chat migrations (images, NPC
-- speakers, post edits, private DMs, rolls), so the policies below are the
-- final word: they restate the earlier rules and add the roll narrowing.
-- Post reads go through the private-DM visibility check (#112), so private
-- channels and DMs stay closed; the speaker check keeps the NPC-speaker
-- clause (#108) beside the character one; GM-only rows narrow to GMs on
-- both reads and writes; archived channels stay read-only.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It runs after the posts migration, whose table it extends and whose
-- updated-at trigger it keeps.

BEGIN;

ALTER TABLE public.chat_posts
  ADD COLUMN IF NOT EXISTS roll jsonb NULL;
ALTER TABLE public.chat_posts
  ADD COLUMN IF NOT EXISTS gms_only boolean NOT NULL DEFAULT false;

-- A roll stands in for the words alongside text and images: a live post
-- needs text, a roll, or images, while a soft-deleted post keeps its row
-- with the content cleared (per #27). This replaces the earlier text rules.
ALTER TABLE public.chat_posts
  DROP CONSTRAINT IF EXISTS chat_posts_text_required;
ALTER TABLE public.chat_posts
  DROP CONSTRAINT IF EXISTS chat_posts_text_or_images;
ALTER TABLE public.chat_posts
  DROP CONSTRAINT IF EXISTS chat_posts_text_or_roll_required;
ALTER TABLE public.chat_posts
  ADD CONSTRAINT chat_posts_text_or_roll_required
  CHECK (
    deleted_at IS NOT NULL
    OR char_length(trim(text)) > 0
    OR roll IS NOT NULL
    OR cardinality(image_paths) > 0
  );

-- Members read their campaign's posts through the channel visibility check,
-- except GM-only roll posts, which stay invisible to players.
DROP POLICY IF EXISTS "chat_posts_select_members" ON public.chat_posts;
DROP POLICY IF EXISTS "chat_posts_select_visible" ON public.chat_posts;
CREATE POLICY "chat_posts_select_visible" ON public.chat_posts
  FOR SELECT TO authenticated USING (
    private.can_read_channel(chat_posts.channel_id)
    AND (
      NOT chat_posts.gms_only
      OR EXISTS (
        SELECT 1 FROM public.chat_channels ch
        WHERE ch.id = chat_posts.channel_id
          AND private.is_campaign_gm(ch.campaign_id)
      )
    )
  );

-- Members post into their campaign's open channels as themselves, as one
-- of their characters in that campaign, or -- GMs alone -- as an NPC from
-- the campaign's world. Only GMs may mark a post GM-only; everyone else's
-- GM-only insert fails closed.
DROP POLICY IF EXISTS "chat_posts_insert_members" ON public.chat_posts;
DROP POLICY IF EXISTS "chat_posts_insert_visible" ON public.chat_posts;
CREATE POLICY "chat_posts_insert_visible" ON public.chat_posts
  FOR INSERT TO authenticated WITH CHECK (
    author_id = (select auth.uid())
    AND private.can_read_channel(chat_posts.channel_id)
    AND EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = chat_posts.channel_id
        AND private.is_campaign_member(ch.campaign_id)
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
    AND (
      speaker_npc_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.world_npcs npc
        JOIN public.chat_channels ch ON ch.id = chat_posts.channel_id
        JOIN public.campaigns camp ON camp.id = ch.campaign_id
        WHERE npc.id = chat_posts.speaker_npc_id
          AND camp.world_id IS NOT NULL
          AND npc.world_id = camp.world_id
          AND private.is_campaign_gm(ch.campaign_id)
      )
    )
    AND (
      NOT chat_posts.gms_only
      OR EXISTS (
        SELECT 1 FROM public.chat_channels ch
        WHERE ch.id = chat_posts.channel_id
          AND private.is_campaign_gm(ch.campaign_id)
      )
    )
  );

-- Posted dice never change: the roll and its GM-only flag are frozen at
-- insert, so a later text edit (#27) can only touch the words.
CREATE OR REPLACE FUNCTION public.keep_chat_roll_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.roll IS DISTINCT FROM NEW.roll
    OR OLD.gms_only IS DISTINCT FROM NEW.gms_only THEN
    RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS chat_posts_roll_immutable ON public.chat_posts;
CREATE TRIGGER chat_posts_roll_immutable
  BEFORE UPDATE ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION public.keep_chat_roll_immutable();

COMMIT;
