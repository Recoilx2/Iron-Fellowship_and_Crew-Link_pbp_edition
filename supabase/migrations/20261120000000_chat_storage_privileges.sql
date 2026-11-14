-- Chat storage privileges and own-post upload fix (#125, #118, part of spec #9).
--
-- Two independent failures from run 43545386704 on b1215b14, fixed here:
--
--   1. Momentum burns fail with `permission denied for schema private`.
--      public.keep_chat_roll_immutable() runs as SECURITY INVOKER --
--      fail-closed under RLS, by design (see 20261119000000) -- and its burn
--      check calls private.chat_stat_result(). No migration ever granted
--      USAGE ON SCHEMA private to the app roles (prior private.* sites are
--      owner-parsed RLS policies or run inside SECURITY DEFINER), so the
--      caller's lookup of the helper is refused and every burn -- posted or
--      composer-sent -- fails. The grants below give authenticated USAGE on
--      the private schema and EXECUTE on the burn helpers introduced in
--      20261118000000, matching how earlier migrations grant app-facing
--      rights to authenticated (see 20261113170000_chat_private_dm.sql).
--      Grants only widen: every passing rule keeps passing.
--
--   2. An author's top-up upload into their own existing post folder is
--      refused with a row-level-security violation. Inside the INSERT
--      author-branch EXISTS added in 20261117000000, the bare `name`
--      resolves to chat_channels.name (the channel's display name) instead
--      of storage.objects.name (the file path): the inner query's tables
--      shadow the policy target. chat_image_post()/chat_image_campaign()
--      then parse NULL, so the branch never matches -- nobody tops up
--      anyone's post, including the author. The policy below is the
--      20261117000000 one with every path reference qualified as
--      storage.objects.name, the style 20261114000000 already used.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It sorts after every migration on the branch and only replaces the
-- storage INSERT policy, which it never edits in place.

BEGIN;

-- Fix 1: the invoker burn lock may resolve the private helpers.
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.chat_stat_result(integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.chat_momentum_reset_for(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_chat_roll_burn_on_insert() TO authenticated;
GRANT EXECUTE ON FUNCTION private.apply_chat_roll_burn_reset() TO authenticated;

-- Fix 2: qualify the file path inside the author-branch EXISTS so the
-- channel's display-name column can no longer shadow it. Members upload
-- only into a folder for a post that does not exist yet (the composer's
-- pending upload) or for a post they authored, in a campaign they belong
-- to. The no-post check reads through a security definer helper: row
-- visibility narrows per reader, and a plain NOT EXISTS would mistake
-- another member's hidden post for "not yet posted".
DROP POLICY IF EXISTS "chat_images_insert_members" ON storage.objects;
CREATE POLICY "chat_images_insert_members" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'chat-images'
    AND private.chat_image_campaign(storage.objects.name) IS NOT NULL
    AND private.chat_image_post(storage.objects.name) IS NOT NULL
    AND private.is_campaign_member(private.chat_image_campaign(storage.objects.name))
    AND (
      NOT private.chat_post_exists(private.chat_image_post(storage.objects.name))
      OR EXISTS (
        SELECT 1
        FROM public.chat_posts AS p
        JOIN public.chat_channels AS ch ON ch.id = p.channel_id
        WHERE p.id = private.chat_image_post(storage.objects.name)
          AND ch.campaign_id = private.chat_image_campaign(storage.objects.name)
          AND p.author_id = (select auth.uid())
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

COMMIT;
