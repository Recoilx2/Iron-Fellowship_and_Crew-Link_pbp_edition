-- Fix-up for 20261112133000_character_portraits.sql: qualify the object
-- path in the portraits member-read rule. Never edit an applied migration
-- (see supabase/migrations/README.md); this new file re-applies the
-- corrected policy on stacks that already ran the original.
--
-- Inside EXISTS (SELECT 1 FROM public.characters c ...), the bare
-- split_part(name, '/', 2) bound to c.name (the character's display name),
-- so campaign members could never match. split_part(storage.objects.name,
-- '/', 2) reads the object path (<ownerId>/<characterId>/<filename>)
-- instead. Covered live by the member-download case in
-- src/api-calls/character/portraits.live.test.ts.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; DROP POLICY IF EXISTS plus the transaction
-- keep it idempotent and safe to re-run by hand. It sorts after
-- 20261112132000_characters.sql (table, private.is_campaign_member) and
-- 20261112133000_character_portraits.sql (the policy it replaces); no new
-- helpers or tables are created here, so the helpers-before-tables
-- ordering holds trivially.

BEGIN;

DROP POLICY IF EXISTS "portraits_select_owner_or_members" ON storage.objects;
CREATE POLICY "portraits_select_owner_or_members" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'portraits'
    AND (
      split_part(name, '/', 1) = (select auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.characters c
        WHERE c.id::text = split_part(storage.objects.name, '/', 2)
          AND c.campaign_id IS NOT NULL
          AND private.is_campaign_member(c.campaign_id)
      )
    )
  );

COMMIT;
