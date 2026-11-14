-- Chat image access rules (#118, part of spec #9).
--
-- The first chat-images migration scoped every rule to campaign membership:
-- any member could list and download images from direct messages, private
-- channels they are not in, and GM-only roll posts, and any member could
-- upsert over or delete another member's file. Signed links lasted 7 days,
-- and the image-only rule lived in the browser alone.
--
-- Reads now go through the same checks as the posts they belong to: a
-- member reads an attached image exactly when they may read its post --
-- private.can_read_channel for its channel, GMs alone for GM-only roll
-- posts. A file uploaded before its post exists (the composer attaches at
-- once so sending is instant) is readable only by its uploader. Only the
-- uploader overwrites or deletes a file; the author of a post or a GM of
-- its campaign may also remove the post's files when clearing the post
-- (post-delete cleanup itself arrives in #120, which this unblocks).
--
-- The bucket additionally enforces what the composer accepts: PNG, JPEG,
-- GIF and WebP through allowed_mime_types, and the CHAT_IMAGE_MAX_MB
-- deployment setting (default 10 MB, shared with the client cap) through
-- file_size_limit. Signed links stay short-lived on the client
-- (see src/api-calls/chat/chatImages.ts).
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It sorts after every migration on the branch and replaces the
-- four storage rules from 20261113170000_chat_images.sql, which it never
-- edits. It runs after the private-DM migration (private.can_read_channel)
-- and the rolls migration (chat_posts.gms_only), whose rules it restates
-- for stored bytes.
--
-- The psql variable CHAT_IMAGE_MAX_MB arrives from supabase/migrate/apply.sh
-- (deployment config, default 10); referencing it keeps one setting behind
-- both the bucket cap here and the client cap in chatImageLimits.ts.

BEGIN;

-- Extracts the post id from a chat-images path, or NULL when the path is
-- not shaped like one, so malformed names fail closed instead of erroring.
-- Paths look like <campaignId>/<postId>/<filename>.
CREATE OR REPLACE FUNCTION private.chat_image_post(path text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
  WHEN split_part(path, '/', 2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  THEN split_part(path, '/', 2)::uuid
  ELSE NULL
  END;
$$;

-- Whether the signed-in person may read one stored image. Attached files
-- follow their post: the channel visibility check plus the GM-only rule. A
-- file with no post row yet (an upload waiting for its post) -- or with a
-- path no post claims -- is visible only to the member who uploaded it.
-- Security definer so the post lookup sees every row even for readers the
-- post rules would refuse; the empty search path and the
-- (select auth.uid()) subquery follow the database performance guide.
CREATE OR REPLACE FUNCTION private.can_read_chat_image(objname text, objowner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_posts AS p
    JOIN public.chat_channels AS ch ON ch.id = p.channel_id
    WHERE p.id = private.chat_image_post(objname)
      AND ch.campaign_id = private.chat_image_campaign(objname)
      AND objname = ANY (p.image_paths)
      AND private.can_read_channel(p.channel_id)
      AND (NOT p.gms_only OR private.is_campaign_gm(ch.campaign_id))
  )
  OR (
    objowner = (select auth.uid())
    AND private.chat_image_campaign(objname) IS NOT NULL
    AND private.chat_image_post(objname) IS NOT NULL
    AND private.is_campaign_member(private.chat_image_campaign(objname))
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_posts AS q
      WHERE q.id = private.chat_image_post(objname)
    )
  );
$$;

-- Whether the signed-in person may discard one stored image without being
-- its uploader: the author of the post it is attached to, or a GM of that
-- post's campaign clearing the post. Uploaders always remove their own
-- files through the owner rule beside this one.
CREATE OR REPLACE FUNCTION private.can_delete_chat_image(objname text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_posts AS p
    JOIN public.chat_channels AS ch ON ch.id = p.channel_id
    WHERE p.id = private.chat_image_post(objname)
      AND ch.campaign_id = private.chat_image_campaign(objname)
      AND objname = ANY (p.image_paths)
      AND (
        p.author_id = (select auth.uid())
        OR private.is_campaign_gm(ch.campaign_id)
      )
  );
$$;

-- The image types the composer accepts, with the size cap from the
-- deployment config (default 10 MB) shared with the client. When this file
-- runs by hand without the psql variable apply.sh passes, fall back to the
-- same default the example env file ships.
\if :{?CHAT_IMAGE_MAX_MB}
\else
\set CHAT_IMAGE_MAX_MB 10
\endif
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-images', 'chat-images', false, (:'CHAT_IMAGE_MAX_MB')::int * 1048576, ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Attached images read exactly when their post reads: channel members and
-- GMs through the visibility check, GMs alone for GM-only roll posts.
-- Files waiting for a post read only for the member who uploaded them.
DROP POLICY IF EXISTS "chat_images_select_members" ON storage.objects;
CREATE POLICY "chat_images_select_members" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'chat-images'
    AND private.can_read_chat_image(storage.objects.name, storage.objects.owner)
  );

-- Members upload into well-formed folders of campaigns they belong to. The
-- uploader becomes the file's owner; touching another person's file fails
-- on the update and delete rules below.
DROP POLICY IF EXISTS "chat_images_insert_members" ON storage.objects;
CREATE POLICY "chat_images_insert_members" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'chat-images'
    AND private.chat_image_campaign(name) IS NOT NULL
    AND private.chat_image_post(name) IS NOT NULL
    AND private.is_campaign_member(private.chat_image_campaign(name))
  );

-- Only the uploader replaces their file; nobody overwrites another
-- person's image. The composer's upsert keeps working for the uploader's
-- own re-uploads before posting.
DROP POLICY IF EXISTS "chat_images_update_members" ON storage.objects;
CREATE POLICY "chat_images_update_members" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-images'
    AND owner = (select auth.uid())
  )
  WITH CHECK (
    bucket_id = 'chat-images'
    AND owner = (select auth.uid())
  );

-- The uploader discards their own file; the author of its post or a GM of
-- its campaign may also remove attached files when clearing the post.
DROP POLICY IF EXISTS "chat_images_delete_members" ON storage.objects;
CREATE POLICY "chat_images_delete_members" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'chat-images'
    AND (
      owner = (select auth.uid())
      OR private.can_delete_chat_image(storage.objects.name)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

COMMIT;
