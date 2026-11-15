-- Assistant outline versions: previous outline texts kept for Undo (#133, part of spec #10).
--
-- Every "Apply to outline" stores the replaced outline text here before
-- replacing it, so the GM can undo from the reply or the Outline tab. The
-- assistant itself never writes: only the GM's Apply (and Undo) touch the
-- outline and its versions, through the same GM-only rules as the outline
-- itself.
--
-- Versions belong to the campaign and are shared by its GMs, exactly like
-- the outline: only GMs of the campaign read or write them, and players
-- and outsiders get nothing. Losing GM status or leaving the campaign cuts
-- off access at once, including live updates. Deleting the campaign
-- removes its versions through the cascade below.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand. It
-- runs after the campaigns and campaign members migrations, whose GM check
-- it reuses. Never edit an applied migration; add a new file instead.

BEGIN;

CREATE TABLE IF NOT EXISTS public.assistant_outline_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_outline_versions_content_required CHECK (char_length(trim(content)) > 0)
);

CREATE INDEX IF NOT EXISTS assistant_outline_versions_by_campaign
  ON public.assistant_outline_versions (campaign_id, created_at DESC);

ALTER TABLE public.assistant_outline_versions ENABLE ROW LEVEL SECURITY;

-- The campaign's GMs read and write every version of its outline; players
-- and outsiders read and write nothing. The checks name the row's own
-- campaign, never re-querying this table, so version writes keep working
-- (#69). Inserts additionally carry the saving GM, like outline rows do.
DROP POLICY IF EXISTS "assistant_outline_versions_select_gm" ON public.assistant_outline_versions;
CREATE POLICY "assistant_outline_versions_select_gm" ON public.assistant_outline_versions
  FOR SELECT TO authenticated USING (
    private.is_campaign_gm(campaign_id)
  );

DROP POLICY IF EXISTS "assistant_outline_versions_insert_gm" ON public.assistant_outline_versions;
CREATE POLICY "assistant_outline_versions_insert_gm" ON public.assistant_outline_versions
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_gm(campaign_id)
    AND created_by = (select auth.uid())
  );

DROP POLICY IF EXISTS "assistant_outline_versions_update_gm" ON public.assistant_outline_versions;
CREATE POLICY "assistant_outline_versions_update_gm" ON public.assistant_outline_versions
  FOR UPDATE TO authenticated
  USING (
    private.is_campaign_gm(campaign_id)
  )
  WITH CHECK (
    private.is_campaign_gm(campaign_id)
  );

DROP POLICY IF EXISTS "assistant_outline_versions_delete_gm" ON public.assistant_outline_versions;
CREATE POLICY "assistant_outline_versions_delete_gm" ON public.assistant_outline_versions
  FOR DELETE TO authenticated USING (
    private.is_campaign_gm(campaign_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_outline_versions TO authenticated;

ALTER TABLE public.assistant_outline_versions REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'assistant_outline_versions'
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
