-- Chat image hardening (#118 points 1-3, part of spec #9).
--
-- Point 2: images in a sent post cannot change without an edited marker.
-- The post edit branch never locked image_paths, so the author could swap
-- attachments silently, and the owner's storage UPDATE rule let them
-- replace the bytes of an image that is already sent. #27 lets authors
-- edit only the text, so the edit trigger below pins image_paths on the
-- edit path -- a delete still clears them -- and the storage UPDATE rule
-- refuses files a sent post claims.
--
-- Point 3: uploads are limited to the uploader's own posts. Any member
-- could upload into any post's folder. The INSERT rule now allows uploads
-- only into a folder for a post that does not exist yet (the composer
-- attaches before sending, so the pending upload has no post row) or for
-- a post the uploader authored; the campaign-membership check stays.
--
-- Point 1 (bucket cap on every deploy, Storage FILE_SIZE_LIMIT, and the
-- bucket/client agreement check) lives in supabase/migrate/apply.sh,
-- supabase/docker-compose.yml and supabase/bin/gen-env.py, which one
-- deployment setting -- CHAT_IMAGE_MAX_MB -- drives; the bucket row keeps
-- the allowed types and the cap from 20261114000000_chat_image_access.sql
-- here, so this file only replaces rules and the edit trigger.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It sorts after every migration on the branch and only replaces
-- policies and trigger functions, which it never edits in place. It runs
-- after the momentum-burn migration (20261116000000), whose edit trigger
-- it replaces with the image pin added.

BEGIN;

-- Whether a stored file belongs to a sent post: some post row claims the
-- path in its image_paths. Fail-closed: any claim locks the bytes, so an
-- owner keeps replacing their own pending uploads but never a sent image.
-- Whether a post row exists at all, regardless of who asks: post row
-- visibility narrows per reader (GM-only posts, private channels), so the
-- upload rule below must not learn "no post" from a row it cannot see --
-- that would open another member's hidden post folder as "not yet posted".
-- Both helpers are security definer so the lookups see every row; the
-- empty search path and the (select auth.uid()) subquery follow the
-- database guide.
CREATE OR REPLACE FUNCTION private.chat_image_is_posted(objname text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_posts AS p
    WHERE p.id = private.chat_image_post(objname)
      AND objname = ANY (p.image_paths)
  );
$$;

CREATE OR REPLACE FUNCTION private.chat_post_exists(pid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_posts AS p
    WHERE p.id = pid
  );
$$;

-- Members upload only into a folder for a post that does not exist yet
-- (the composer's pending upload) or for a post they authored, in a
-- campaign they belong to. The no-post check reads through a security
-- definer helper: row visibility narrows per reader, and a plain NOT
-- EXISTS would mistake another member's hidden post for "not yet posted".
-- Nobody tops up another person's post.
DROP POLICY IF EXISTS "chat_images_insert_members" ON storage.objects;
CREATE POLICY "chat_images_insert_members" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'chat-images'
    AND private.chat_image_campaign(name) IS NOT NULL
    AND private.chat_image_post(name) IS NOT NULL
    AND private.is_campaign_member(private.chat_image_campaign(name))
    AND (
      NOT private.chat_post_exists(private.chat_image_post(name))
      OR EXISTS (
        SELECT 1
        FROM public.chat_posts AS p
        JOIN public.chat_channels AS ch ON ch.id = p.channel_id
        WHERE p.id = private.chat_image_post(name)
          AND ch.campaign_id = private.chat_image_campaign(name)
          AND p.author_id = (select auth.uid())
      )
    )
  );

-- The uploader replaces only their own pending file: once a sent post
-- claims the path, nobody overwrites its bytes -- edits change the text,
-- never the images (#27). The composer's upsert keeps working for the
-- uploader's own re-uploads before posting.
DROP POLICY IF EXISTS "chat_images_update_members" ON storage.objects;
CREATE POLICY "chat_images_update_members" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-images'
    AND owner = (select auth.uid())
    AND NOT private.chat_image_is_posted(name)
  )
  WITH CHECK (
    bucket_id = 'chat-images'
    AND owner = (select auth.uid())
    AND NOT private.chat_image_is_posted(name)
  );

-- A live post still needs text, images or a roll, and a soft delete still
-- clears the row and stays final; the edit path below additionally pins
-- the image paths, so attachments stay as posted unless the post is
-- deleted (the delete path returns above, and the client sends the cleared
-- images with the delete itself).
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
  IF NEW.image_paths IS DISTINCT FROM OLD.image_paths THEN
    RAISE EXCEPTION 'only a post''s text and delete marker may change';
  END IF;
  NEW.deleted_at := OLD.deleted_at;
  NEW.text := trim(NEW.text);
  IF char_length(NEW.text) = 0
    AND NEW.roll IS NULL
    AND cardinality(NEW.image_paths) = 0 THEN
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

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

COMMIT;
