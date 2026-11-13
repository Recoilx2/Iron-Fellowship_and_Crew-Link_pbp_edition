-- Chat post edits and soft deletes (#27): authors fix the text of their own
-- posts, which then show as edited, and authors and GMs delete posts.
--
-- A delete is an UPDATE that clears the content and stamps deleted_at,
-- never a SQL DELETE: under postgres_changes a DELETE event bypasses
-- row-level security and carries the row to every subscriber (#104), while
-- an UPDATE is filtered per reader, so the "post deleted" marker stays
-- visible to members and invisible to outsiders like every other post.
-- There is deliberately no DELETE policy: nothing hard-deletes a post, and
-- a missing policy fails closed for everyone.
--
-- The access rules below are coarse on purpose -- the author or a GM of the
-- campaign may UPDATE any post row they can read -- and the
-- enforce_chat_post_edits trigger draws the fine lines: only the author may
-- change the text, only the author or a GM may set the delete marker, the
-- marker clears the content, identity columns never change, and a deleted
-- post stays deleted. updated_at keeps moving through the shared trigger
-- from the posts migration, so the listener's stale-event detection and the
-- live feed need no changes: edits and deletes arrive as UPDATEs.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It runs after the posts migration, whose table and publication it
-- extends.

BEGIN;

ALTER TABLE public.chat_posts
  ADD COLUMN IF NOT EXISTS edited_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- A live post needs real text; a soft-deleted post keeps its row with the
-- content cleared and the marker stamped.
ALTER TABLE public.chat_posts DROP CONSTRAINT IF EXISTS chat_posts_text_required;
ALTER TABLE public.chat_posts
  ADD CONSTRAINT chat_posts_text_required
  CHECK (deleted_at IS NOT NULL OR char_length(trim(text)) > 0);

-- Authors update their own posts in campaigns they belong to. The trigger
-- below narrows this to text edits of live posts and soft deletes of their
-- own rows; everyone else (and outsiders) matches no policy and therefore
-- reads the update as "post not found".
DROP POLICY IF EXISTS "chat_posts_update_author" ON public.chat_posts;
CREATE POLICY "chat_posts_update_author" ON public.chat_posts
  FOR UPDATE TO authenticated
  USING (
    author_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = chat_posts.channel_id
        AND private.is_campaign_member(ch.campaign_id)
    )
  )
  WITH CHECK (
    author_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = chat_posts.channel_id
        AND private.is_campaign_member(ch.campaign_id)
    )
  );

-- GMs moderate their campaign: they may UPDATE any of its posts. The
-- trigger below narrows this to soft deletes -- a GM never rewrites
-- another member's text -- and outsiders match no policy at all.
DROP POLICY IF EXISTS "chat_posts_update_gm" ON public.chat_posts;
CREATE POLICY "chat_posts_update_gm" ON public.chat_posts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = chat_posts.channel_id
        AND private.is_campaign_gm(ch.campaign_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = chat_posts.channel_id
        AND private.is_campaign_gm(ch.campaign_id)
    )
  );

GRANT UPDATE ON public.chat_posts TO authenticated;

CREATE OR REPLACE FUNCTION private.enforce_chat_post_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  editor uuid;
  camp uuid;
  editor_is_gm boolean;
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'deleted posts stay deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.channel_id IS DISTINCT FROM OLD.channel_id
    OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.speaker_character_id IS DISTINCT FROM OLD.speaker_character_id
    OR NEW.speaker_npc_id IS DISTINCT FROM OLD.speaker_npc_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only a post''s text and delete marker may change';
  END IF;
  editor := (select auth.uid());
  SELECT ch.campaign_id INTO camp
  FROM public.chat_channels AS ch
  WHERE ch.id = OLD.channel_id;
  editor_is_gm := private.is_campaign_gm(camp);
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    IF NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'deleted posts stay deleted';
    END IF;
    IF OLD.author_id IS DISTINCT FROM editor AND NOT editor_is_gm THEN
      RAISE EXCEPTION 'only the author or a GM may delete a post';
    END IF;
    NEW.deleted_at := now();
    NEW.text := '';
    NEW.edited_at := OLD.edited_at;
    RETURN NEW;
  END IF;
  IF OLD.author_id IS DISTINCT FROM editor THEN
    RAISE EXCEPTION 'only the author may edit a post';
  END IF;
  NEW.deleted_at := OLD.deleted_at;
  NEW.text := trim(NEW.text);
  IF char_length(NEW.text) = 0 THEN
    RAISE EXCEPTION 'post text is required';
  END IF;
  IF NEW.text IS NOT DISTINCT FROM OLD.text THEN
    NEW.edited_at := OLD.edited_at;
  ELSE
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_posts_enforce_edits ON public.chat_posts;
CREATE TRIGGER chat_posts_enforce_edits
  BEFORE UPDATE ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_chat_post_edits();

COMMIT;
