-- Opt-in email notifications for new chat posts (ticket #203).
--
-- Two preferences decide whether a person gets a post by email: a global
-- switch on their user_settings row and a per-channel row. There is no
-- pre-seeded opt-in: an absent chat_channel_email_prefs row means no email,
-- and a global opt-out wins even when a channel row is opted in. The mailer
-- reads both flags from chat_post_email_candidates and re-checks them at
-- send time, so a change made after a post lands is honoured.
--
-- Candidate readers are resolved here, with the same access helpers the
-- channel, post, roster and image policies use. The _as variants take an
-- explicit user id: the caller of the candidate function is the mailer, not
-- the reader whose access is being tested. The old one-argument helpers
-- delegate to them with auth.uid(), so every existing policy keeps its
-- current meaning. A GM-only post is never a candidate for a player, and a
-- DM or private channel is never a candidate for someone outside its
-- roster: the email path cannot widen what the reader could see in chat.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It runs after every chat migration, including the roll and edit
-- migrations whose columns the candidate function reads.

BEGIN;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.chat_channel_email_prefs (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  opted_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

ALTER TABLE public.chat_channel_email_prefs ENABLE ROW LEVEL SECURITY;

-- Only the owner reads and changes their own channel choices. There are no
-- GM or service policies: the mailer reads through the security-definer
-- candidate function below, not through this table's RLS.
DROP POLICY IF EXISTS "chat_channel_email_prefs_select_own" ON public.chat_channel_email_prefs;
CREATE POLICY "chat_channel_email_prefs_select_own" ON public.chat_channel_email_prefs
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "chat_channel_email_prefs_insert_own" ON public.chat_channel_email_prefs;
CREATE POLICY "chat_channel_email_prefs_insert_own" ON public.chat_channel_email_prefs
  FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "chat_channel_email_prefs_update_own" ON public.chat_channel_email_prefs;
CREATE POLICY "chat_channel_email_prefs_update_own" ON public.chat_channel_email_prefs
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "chat_channel_email_prefs_delete_own" ON public.chat_channel_email_prefs;
CREATE POLICY "chat_channel_email_prefs_delete_own" ON public.chat_channel_email_prefs
  FOR DELETE TO authenticated USING (user_id = (select auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_channel_email_prefs TO authenticated;

-- Keep updated_at fresh on preference changes (the same convention as user
-- settings; the shared listener compares timestamps on reconcile).
CREATE OR REPLACE FUNCTION public.handle_chat_channel_email_prefs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_channel_email_prefs_updated_at ON public.chat_channel_email_prefs;
CREATE TRIGGER chat_channel_email_prefs_updated_at
  BEFORE UPDATE ON public.chat_channel_email_prefs
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_channel_email_prefs_updated_at();

-- Access checks for an explicit person. Define the _as variants first:
-- Postgres validates a SQL function body when it is created, and the old
-- helpers below now delegate to them.
CREATE OR REPLACE FUNCTION private.is_campaign_member_as(cid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_members
    WHERE campaign_id = cid AND user_id = uid
  );
$$;

CREATE OR REPLACE FUNCTION private.is_campaign_member(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_campaign_member_as(cid, (select auth.uid()));
$$;

CREATE OR REPLACE FUNCTION private.is_campaign_gm_as(cid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_members
    WHERE campaign_id = cid AND user_id = uid AND role = 'gm'
  );
$$;

CREATE OR REPLACE FUNCTION private.is_campaign_gm(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_campaign_gm_as(cid, (select auth.uid()));
$$;

CREATE OR REPLACE FUNCTION private.is_channel_member_as(cid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channel_members
    WHERE channel_id = cid AND user_id = uid
  );
$$;

CREATE OR REPLACE FUNCTION private.is_channel_member(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_channel_member_as(cid, (select auth.uid()));
$$;

-- The channel visibility rule, over an explicit person. Public channels
-- belong to campaign members, private ones to their roster plus the GMs,
-- and DMs to their two members alone -- a GM outside a DM sees nothing.
CREATE OR REPLACE FUNCTION private.can_read_channel_as(cid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels AS ch
    WHERE ch.id = cid
      AND (
        (ch.visibility = 'public' AND private.is_campaign_member_as(ch.campaign_id, uid))
        OR (ch.visibility = 'private' AND (
          private.is_channel_member_as(ch.id, uid)
          OR private.is_campaign_gm_as(ch.campaign_id, uid)
        ))
        OR (ch.visibility = 'dm' AND private.is_channel_member_as(ch.id, uid))
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.can_read_channel(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.can_read_channel_as(cid, (select auth.uid()));
$$;

-- Every access-eligible reader of one post, with both preference flags.
-- Flags are returned even when the person has opted out: the mailer's pure
-- shouldEmail check decides, and a unit test can pin the precedence. The
-- function is NOT granted to authenticated users -- it exposes post text,
-- rolls and email addresses -- so only the database owner (the outbox
-- trigger) and the service role (operator/live tests) may execute it.
CREATE OR REPLACE FUNCTION public.chat_post_email_candidates(p_post_id uuid)
RETURNS TABLE (
  recipient_user_id uuid,
  recipient_email text,
  recipient_display_name text,
  post_channel_id uuid,
  channel_name text,
  post_campaign_id uuid,
  campaign_name text,
  post_id uuid,
  post_text text,
  was_gms_only boolean,
  post_roll jsonb,
  global_opt_in boolean,
  channel_opt_in boolean,
  is_author boolean,
  is_gm boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    m.user_id,
    u.email,
    COALESCE(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)),
    ch.id,
    ch.name,
    ch.campaign_id,
    camp.name,
    p.id,
    p.text,
    p.gms_only,
    p.roll,
    COALESCE(
      (SELECT s.email_notifications_enabled FROM public.user_settings AS s
       WHERE s.user_id = m.user_id),
      true
    ),
    (SELECT pref.opted_in FROM public.chat_channel_email_prefs AS pref
     WHERE pref.user_id = m.user_id AND pref.channel_id = ch.id),
    m.user_id = p.author_id,
    private.is_campaign_gm_as(ch.campaign_id, m.user_id)
  FROM public.chat_posts AS p
  JOIN public.chat_channels AS ch ON ch.id = p.channel_id
  JOIN public.campaigns AS camp ON camp.id = ch.campaign_id
  JOIN public.campaign_members AS m ON m.campaign_id = ch.campaign_id
  JOIN auth.users AS u ON u.id = m.user_id
  WHERE p.id = p_post_id
    AND p.deleted_at IS NULL
    AND m.user_id <> p.author_id
    AND private.can_read_channel_as(ch.id, m.user_id)
    AND (NOT p.gms_only OR private.is_campaign_gm_as(ch.campaign_id, m.user_id));
$$;

REVOKE ALL ON FUNCTION public.chat_post_email_candidates(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_post_email_candidates(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_post_email_candidates(uuid) TO service_role;

COMMIT;
