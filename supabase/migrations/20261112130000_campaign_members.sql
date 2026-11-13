-- Campaign membership: who belongs to each campaign, and in which role.
-- Every later data area hangs its access rules off this table through the
-- private.is_campaign_member() / private.is_campaign_gm() helpers below, so
-- GMs keep control of their campaigns and outsiders see nothing.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand.
--
-- Notes for later tickets:
-- - campaign_id has no foreign key yet: the campaigns table lands in a later
--   ticket, which adds the reference. Rows are created with the service key
--   (or a definer function) until campaign creation exists.
-- - The first member of a campaign (its founding GM) is inserted with the
--   service key: the INSERT policy needs an existing GM, so bootstrapping
--   cannot go through the client. Campaign creation will own that step.

BEGIN;

-- Membership checks used by every later access rule. Security definer so the
-- checks run even for people with no direct grant on the members table; the
-- private schema is never exposed through the data API. The empty search path
-- and the (select auth.uid()) subquery follow the database performance guide:
-- the planner evaluates the caller's identity once per statement, and the
-- (campaign_id, user_id) primary key serves the lookup.
CREATE SCHEMA IF NOT EXISTS private;

-- The roster table comes before the helpers: Postgres validates the body of
-- a SQL-language function when it is created, so the table must exist first.
-- The helpers still precede the table policies below, which resolve the
-- functions they call when each policy is created.
CREATE TABLE IF NOT EXISTS public.campaign_members (
  campaign_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('gm', 'player')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS campaign_members_by_user
  ON public.campaign_members (user_id);

CREATE OR REPLACE FUNCTION private.is_campaign_member(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_members
    WHERE campaign_id = cid AND user_id = (select auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.is_campaign_gm(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_members
    WHERE campaign_id = cid AND user_id = (select auth.uid()) AND role = 'gm'
  );
$$;

ALTER TABLE public.campaign_members ENABLE ROW LEVEL SECURITY;

-- The roster is visible to members of the campaign, and nobody else.
DROP POLICY IF EXISTS "campaign_members_select_members" ON public.campaign_members;
CREATE POLICY "campaign_members_select_members" ON public.campaign_members
  FOR SELECT TO authenticated USING (
    private.is_campaign_member(campaign_id)
  );

-- Only GMs change the roster: they add and remove players and fellow GMs.
-- Each operation re-checks GM status, so a demoted GM loses access at once.
DROP POLICY IF EXISTS "campaign_members_insert_gm" ON public.campaign_members;
CREATE POLICY "campaign_members_insert_gm" ON public.campaign_members
  FOR INSERT TO authenticated WITH CHECK (
    private.is_campaign_gm(campaign_id)
  );

DROP POLICY IF EXISTS "campaign_members_update_gm" ON public.campaign_members;
CREATE POLICY "campaign_members_update_gm" ON public.campaign_members
  FOR UPDATE TO authenticated
  USING (private.is_campaign_gm(campaign_id))
  WITH CHECK (private.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "campaign_members_delete_gm" ON public.campaign_members;
CREATE POLICY "campaign_members_delete_gm" ON public.campaign_members
  FOR DELETE TO authenticated USING (
    private.is_campaign_gm(campaign_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_members TO authenticated;

COMMIT;
