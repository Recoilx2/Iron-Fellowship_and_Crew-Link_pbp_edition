-- Outbox for chat-post email (ticket #203).
--
-- The AFTER INSERT trigger snapshots one row per eligible reader of a new
-- post, then NOTIFYs the mailer worker. The worker re-checks eligibility
-- before sending (a reader might have opted out or lost channel access in
-- the meantime) and records attempts, so a transient SMTP failure is
-- retried without losing the post. Nothing here is exposed to signed-in
-- users: the outbox holds email addresses and the mailer, not the browser,
-- owns delivery. Service role may read it for the live delivery test.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It runs after the preferences migration that defines the candidate
-- function.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_post_email_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES public.chat_posts (id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- Set with the claim, before any SMTP call. A row with sending_at set is
  -- in flight: the poll never claims it again, so a database failure after
  -- a successful send cannot produce a second email.
  sending_at timestamptz NULL,
  sent_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS chat_post_email_outbox_pending
  ON public.chat_post_email_outbox (next_attempt_at, id)
  WHERE sent_at IS NULL;

ALTER TABLE public.chat_post_email_outbox ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated users: there is deliberately no way to
-- read, insert or change an outbox row through the data API as a member.
REVOKE ALL ON TABLE public.chat_post_email_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON TABLE public.chat_post_email_outbox TO service_role;

-- Runs as the database owner so it can read the candidate function (not
-- granted to authenticated) and write the outbox (not granted either).
CREATE OR REPLACE FUNCTION private.queue_chat_post_emails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post_id uuid;
BEGIN
  v_post_id := NEW.id;
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.chat_post_email_outbox (post_id, recipient_user_id)
  SELECT c.recipient_user_id, v_post_id
  FROM public.chat_post_email_candidates(v_post_id) AS c
  ON CONFLICT (post_id, recipient_user_id) DO NOTHING;

  -- The payload is only an id: no post text, roll or email ever goes over
  -- the notification channel.
  PERFORM pg_notify('chat_post_email', v_post_id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_posts_email_outbox ON public.chat_posts;
CREATE TRIGGER chat_posts_email_outbox
  AFTER INSERT ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION private.queue_chat_post_emails();

COMMIT;
