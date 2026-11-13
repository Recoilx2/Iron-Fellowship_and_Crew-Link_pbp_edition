-- GM NPC voices in chat: a post may speak as one of the NPCs in the
-- world the channel's campaign uses, picked from the world's NPC list. Only
-- a campaign GM may post with an NPC speaker, and only an NPC from that
-- campaign's world; players keep posting as one of their characters or as
-- themselves, so the database -- never the interface -- decides who speaks
-- as whom. The feed shows the NPC's name and portrait with a GM tag beside
-- it. NPCs are mostly a reference list, so one voice per post: a post names
-- a character speaker, an NPC speaker, or nobody (itself), never both.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand. It
-- runs after the chat posts migration, whose insert policy it replaces, and
-- after the worlds migration, whose NPC list its speaker follows.

BEGIN;

ALTER TABLE public.chat_posts
  ADD COLUMN IF NOT EXISTS speaker_npc_id uuid NULL REFERENCES public.world_npcs (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_posts_by_speaker_npc
  ON public.chat_posts (speaker_npc_id);

-- One voice per post: a character speaker, an NPC speaker, or nobody.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_posts_single_speaker'
  ) THEN
    ALTER TABLE public.chat_posts
      ADD CONSTRAINT chat_posts_single_speaker
      CHECK (speaker_character_id IS NULL OR speaker_npc_id IS NULL);
  END IF;
END $$;

-- Members post into open channels of their campaign as themselves, as one
-- of their characters in that campaign, or -- GMs alone -- as an NPC from
-- the campaign's world. Archived channels stay read-only.
DROP POLICY IF EXISTS "chat_posts_insert_members" ON public.chat_posts;
CREATE POLICY "chat_posts_insert_members" ON public.chat_posts
  FOR INSERT TO authenticated WITH CHECK (
    author_id = (select auth.uid())
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
  );

COMMIT;
