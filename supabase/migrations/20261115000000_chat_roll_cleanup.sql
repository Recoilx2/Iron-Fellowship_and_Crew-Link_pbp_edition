-- Deleted-post cleanup and roll forgery fix (#120, part of spec #9).
--
-- A soft delete now clears everything readable: the delete branch of the
-- edits trigger wipes the text, the image paths and the roll, so anyone who
-- may read the channel keeps only the "post deleted" marker (#27). The
-- roll lock below still pins posted dice, but it lets a delete clear the
-- roll: the edits trigger runs first (triggers fire alphabetically) and a
-- cleared roll with the marker stamped is the only change it waves through,
-- so text edits still cannot touch the dice (#29). Clearing the roll is
-- also what drops a deleted roll post from the campaign roll log, whose
-- readers only take live posts carrying a roll (#30).
--
-- The image bytes themselves are removed by the delete wrapper
-- (see src/api-calls/chat/deletePost.ts), which deletes the post's files
-- before clearing the row: the storage rules attribute a file to its post
-- (#118), so the files must go while the row still names them -- a GM
-- clearing another member's post could not remove them afterwards.
--
-- Rolls can no longer be forged for another character: a post's roll must
-- match the post on insert -- the roll's uid must be the post's author,
-- and its characterId the post's speaker character, or empty when posting
-- as oneself or as an NPC. Rolls are set once at insert and the roll lock
-- refuses every later change but the delete above, so the insert check is
-- the whole forgery story. Readers name the roller from the post's author
-- and speaker columns (see listenToCampaignRollPosts), never from the roll.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It sorts after every migration on the branch and only replaces
-- trigger functions, which it never edits in place.

BEGIN;

-- A delete is still an UPDATE that stamps the marker, never a SQL DELETE:
-- under postgres_changes a DELETE event bypasses row-level security, while
-- an UPDATE stays filtered per reader. The marker now clears the text, the
-- image paths and the roll, and a deleted post stays deleted.
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
    NEW.image_paths := '{}';
    NEW.roll := NULL;
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

-- Posted dice never change, except on soft delete: the edits trigger above
-- runs first and clears the roll beside the text and images, so a cleared
-- roll with the delete marker stamped is the only change waved through.
-- The GM-only flag stays pinned always.
CREATE OR REPLACE FUNCTION public.keep_chat_roll_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.roll IS DISTINCT FROM NEW.roll
    OR OLD.gms_only IS DISTINCT FROM NEW.gms_only THEN
    IF OLD.deleted_at IS NULL
      AND NEW.deleted_at IS NOT NULL
      AND NEW.roll IS NULL
      AND OLD.gms_only IS NOT DISTINCT FROM NEW.gms_only THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS chat_posts_roll_immutable ON public.chat_posts;
CREATE TRIGGER chat_posts_roll_immutable
  BEFORE UPDATE ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION public.keep_chat_roll_immutable();

-- A posted roll must be the post's own: the roll's uid is the post's
-- author, and its characterId is the post's speaker character -- or empty
-- when posting as oneself or as an NPC. Rolls are set once at insert (the
-- lock above refuses every later change but the delete), so this check
-- closes forgery: no player may file dice under another character's name,
-- and the roll log names the roller from the post's columns regardless.
CREATE OR REPLACE FUNCTION private.enforce_chat_roll_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  roll_uid text;
  roll_character text;
BEGIN
  IF NEW.roll IS NULL THEN
    RETURN NEW;
  END IF;
  roll_uid := NULLIF(NEW.roll ->> 'uid', '');
  IF roll_uid IS DISTINCT FROM NEW.author_id::text THEN
    RAISE EXCEPTION 'a posted roll must carry the author''s uid';
  END IF;
  roll_character := NULLIF(NEW.roll ->> 'characterId', '');
  IF NEW.speaker_character_id IS NULL THEN
    IF roll_character IS NOT NULL THEN
      RAISE EXCEPTION 'a roll posted as yourself or as an NPC names no character';
    END IF;
  ELSIF roll_character IS DISTINCT FROM NEW.speaker_character_id::text THEN
    RAISE EXCEPTION 'a posted roll must name the post''s speaker character';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_posts_enforce_roll_identity ON public.chat_posts;
CREATE TRIGGER chat_posts_enforce_roll_identity
  BEFORE INSERT ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_chat_roll_identity();

COMMIT;
