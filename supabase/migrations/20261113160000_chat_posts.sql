-- Chat posts: text entries in a channel, written as one of the author's
-- campaign characters (in character) or as themselves (out of character).
-- GMs post as themselves, labelled GM by the interface.
--
-- Only campaign members read posts; only members post, and never into an
-- archived channel. The speaker -- when one is named -- must be one of the
-- author's characters in the channel's campaign, so nobody can speak as
-- another player's character. Nobody outside the campaign reads anything,
-- so the database -- never the interface -- decides who sees the game.
-- There is deliberately no UPDATE or DELETE policy yet: edits and soft
-- deletes arrive in a later ticket, and a missing policy fails closed for
-- everyone until then.
--
-- Room left for later chat tickets without touching existing data:
-- - threads: posts carry an optional parent post pointer (#27 owns edits
--   and deletes and adds the pointer beside them)
-- - whispers: posts carry an optional recipient list, honoured by the
--   access rules (#112 owns private channels and direct messages)
-- - rolls: posts carry the roll in its existing shape, dice immutable (#29)
-- - images: posts carry image attachments in the chat storage bucket (#28)
-- - edits: an edited timestamp marks posts changed after posting (#27)
-- - deletes: a soft-delete marker keeps a "post deleted" row in place (#27)
-- - reactions: a separate table keyed by post and person
-- - search: a trigram index over post text, added with the table that
--   introduces full search
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand. It
-- runs after the channels migration, whose updated_at trigger it reuses and
-- whose channels its posts follow.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  speaker_character_id uuid NULL REFERENCES public.characters (id) ON DELETE SET NULL,
  text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_posts_text_required CHECK (char_length(trim(text)) > 0)
);

CREATE INDEX IF NOT EXISTS chat_posts_by_channel
  ON public.chat_posts (channel_id, created_at DESC);

ALTER TABLE public.chat_posts ENABLE ROW LEVEL SECURITY;

-- Members read every post of their campaign's channels; outsiders read
-- nothing. (A later ticket narrows this for GM-only roll posts, which stay
-- invisible to players.)
DROP POLICY IF EXISTS "chat_posts_select_members" ON public.chat_posts;
CREATE POLICY "chat_posts_select_members" ON public.chat_posts
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = chat_posts.channel_id
        AND private.is_campaign_member(ch.campaign_id)
    )
  );

-- Members post into open channels of their campaign as themselves or as one
-- of their characters in that campaign. Archived channels stay read-only.
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
  );

GRANT SELECT, INSERT ON public.chat_posts TO authenticated;

DROP TRIGGER IF EXISTS chat_posts_updated_at ON public.chat_posts;
CREATE TRIGGER chat_posts_updated_at
  BEFORE UPDATE ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

ALTER TABLE public.chat_posts REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'chat_posts'
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
