-- Portraits live in a private storage bucket, one folder per owner:
-- portraits/<ownerId>/<characterId>/<filename>. Only the owner writes;
-- the owner and the members of the character's campaign may read.
-- Images are served as uploaded, so the site shrinks large images in the
-- browser before upload (see src/api-calls/storage/shrinkImage.ts).
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand. It runs
-- after the characters migration, whose table the read rule joins.

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('portraits', 'portraits', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Reads reach the owner and the character's campaign members, and nobody
-- else. The character id is the middle path segment.
DROP POLICY IF EXISTS "portraits_select_owner_or_members" ON storage.objects;
CREATE POLICY "portraits_select_owner_or_members" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'portraits'
    AND (
      split_part(name, '/', 1) = (select auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.characters c
        WHERE c.id::text = split_part(name, '/', 2)
          AND c.campaign_id IS NOT NULL
          AND private.is_campaign_member(c.campaign_id)
      )
    )
  );

-- Writes stay in the caller's own folder, matching the owning data area.
DROP POLICY IF EXISTS "portraits_insert_own" ON storage.objects;
CREATE POLICY "portraits_insert_own" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'portraits'
    AND split_part(name, '/', 1) = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "portraits_update_own" ON storage.objects;
CREATE POLICY "portraits_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'portraits'
    AND split_part(name, '/', 1) = (select auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'portraits'
    AND split_part(name, '/', 1) = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "portraits_delete_own" ON storage.objects;
CREATE POLICY "portraits_delete_own" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'portraits'
    AND split_part(name, '/', 1) = (select auth.uid())::text
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

COMMIT;
