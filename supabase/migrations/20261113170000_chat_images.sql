-- Chat images: attachments on posts, held in a private storage bucket,
-- one folder per campaign and post: chat-images/<campaignId>/<postId>/
-- <filename>. Only campaign members read a campaign's chat images, and only
-- members write them; nobody outside the campaign reads anything, so the
-- database -- never the interface -- decides who sees the game.
--
-- Posts carry their attachments as image_paths beside the text (#28): the
-- interface uploads at attach time so sending is instant, and removing an
-- image before posting deletes its upload. Image-only posts are allowed, so
-- the text rule now refuses only posts with neither text nor images.
-- Images are served as uploaded, so the site shrinks large images in the
-- browser before upload (see src/api-calls/storage/shrinkImage.ts); the
-- GIF type skips shrinking so animations survive.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand. It
-- runs after the posts migration, whose table it extends.

BEGIN;

ALTER TABLE public.chat_posts
  ADD COLUMN IF NOT EXISTS image_paths text[] NOT NULL DEFAULT '{}';

-- Posts need text, images, or both: the old rule refused blank text outright.
DROP CONSTRAINT IF EXISTS chat_posts_text_required ON public.chat_posts;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_posts_text_or_images'
  ) THEN
    ALTER TABLE public.chat_posts
      ADD CONSTRAINT chat_posts_text_or_images CHECK (
        char_length(trim(text)) > 0 OR cardinality(image_paths) > 0
      );
  END IF;
END $$;

-- The 10 MB bucket cap is the deployment config for the largest upload; the
-- site's own selection cap matches it
-- (see src/api-calls/chat/chatImageLimits.ts).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-images', 'chat-images', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

-- Extracts the campaign id from a chat-images path, or NULL when the path
-- is not shaped like one, so malformed names fail closed instead of
-- erroring.
CREATE OR REPLACE FUNCTION private.chat_image_campaign(path text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN split_part(path, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN split_part(path, '/', 1)::uuid
    ELSE NULL
  END;
$$;

-- Members read their campaign's chat images; outsiders read nothing.
DROP POLICY IF EXISTS "chat_images_select_members" ON storage.objects;
CREATE POLICY "chat_images_select_members" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'chat-images'
    AND private.is_campaign_member(private.chat_image_campaign(name))
  );

-- Members attach, replace and discard their campaign's chat images.
DROP POLICY IF EXISTS "chat_images_insert_members" ON storage.objects;
CREATE POLICY "chat_images_insert_members" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'chat-images'
    AND private.is_campaign_member(private.chat_image_campaign(name))
  );

DROP POLICY IF EXISTS "chat_images_update_members" ON storage.objects;
CREATE POLICY "chat_images_update_members" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-images'
    AND private.is_campaign_member(private.chat_image_campaign(name))
  )
  WITH CHECK (
    bucket_id = 'chat-images'
    AND private.is_campaign_member(private.chat_image_campaign(name))
  );

DROP POLICY IF EXISTS "chat_images_delete_members" ON storage.objects;
CREATE POLICY "chat_images_delete_members" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'chat-images'
    AND private.is_campaign_member(private.chat_image_campaign(name))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

COMMIT;
