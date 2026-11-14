-- GM assistant data layer: conversations, messages and per-GM settings (#128, part of spec #10).
--
-- Assistant conversations belong to the GM who started them; their messages
-- belong to the conversation. The settings row holds one GM's model choice
-- and saved context choice per campaign. The context choice stores
-- references only (outline flag, lore/NPC/location ids with a GM-parts
-- flag, note ids, channel ids with a post count), never text: a later
-- ticket builds the actual context server-side from these references.
--
-- Only the owning GM reads or writes these rows, and only while still a GM
-- of the campaign: losing GM status or leaving the campaign cuts off
-- access at once, including live updates. Co-GMs of the same campaign read
-- and write nothing (human decision on #7: "each GM instance is all in
-- itself"). The campaign outline is the exception: it is per campaign and
-- shared by that campaign's GMs, and it lives in the notes area, not here.
--
-- Deleting a conversation removes its messages through the cascade below,
-- so the client never deletes messages one by one.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand. It
-- runs after the campaigns and campaign members migrations, whose GM check
-- and updated_at trigger it reuses.

BEGIN;

CREATE TABLE IF NOT EXISTS public.assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_conversations_by_campaign_owner
  ON public.assistant_conversations (campaign_id, owner_id);

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.assistant_conversations (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '',
  stopped_partway boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_messages_content_required CHECK (char_length(trim(content)) > 0)
);

CREATE INDEX IF NOT EXISTS assistant_messages_by_conversation
  ON public.assistant_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.assistant_settings (
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  gm_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  model text NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, gm_id)
);

CREATE INDEX IF NOT EXISTS assistant_settings_by_gm
  ON public.assistant_settings (gm_id);

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_settings ENABLE ROW LEVEL SECURITY;

-- Whether the signed-in person owns this conversation: they started it and
-- are still a GM of its campaign. Messages read through this check, so the
-- messages table never names an owner of its own.
CREATE OR REPLACE FUNCTION private.is_assistant_conversation_owner(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assistant_conversations AS c
    WHERE c.id = cid
      AND c.owner_id = (select auth.uid())
      AND private.is_campaign_gm(c.campaign_id)
  );
$$;

-- The owning GM reads and writes their conversations; co-GMs, players and
-- outsiders read and write nothing. The checks name the row's own columns,
-- never re-querying this table, so update-then-select keeps working (#69).
DROP POLICY IF EXISTS "assistant_conversations_select_owner" ON public.assistant_conversations;
CREATE POLICY "assistant_conversations_select_owner" ON public.assistant_conversations
  FOR SELECT TO authenticated USING (
    owner_id = (select auth.uid())
    AND private.is_campaign_gm(campaign_id)
  );

DROP POLICY IF EXISTS "assistant_conversations_insert_owner" ON public.assistant_conversations;
CREATE POLICY "assistant_conversations_insert_owner" ON public.assistant_conversations
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = (select auth.uid())
    AND private.is_campaign_gm(campaign_id)
  );

DROP POLICY IF EXISTS "assistant_conversations_update_owner" ON public.assistant_conversations;
CREATE POLICY "assistant_conversations_update_owner" ON public.assistant_conversations
  FOR UPDATE TO authenticated
  USING (
    owner_id = (select auth.uid())
    AND private.is_campaign_gm(campaign_id)
  )
  WITH CHECK (
    owner_id = (select auth.uid())
    AND private.is_campaign_gm(campaign_id)
  );

DROP POLICY IF EXISTS "assistant_conversations_delete_owner" ON public.assistant_conversations;
CREATE POLICY "assistant_conversations_delete_owner" ON public.assistant_conversations
  FOR DELETE TO authenticated USING (
    owner_id = (select auth.uid())
    AND private.is_campaign_gm(campaign_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_conversations TO authenticated;

-- Messages follow their conversation: the owning GM reads and writes them
-- (replies stream in as updates), and nobody else sees a row. There is no
-- separate owner column; the conversation's owner is the message's owner.
DROP POLICY IF EXISTS "assistant_messages_select_owner" ON public.assistant_messages;
CREATE POLICY "assistant_messages_select_owner" ON public.assistant_messages
  FOR SELECT TO authenticated USING (
    private.is_assistant_conversation_owner(conversation_id)
  );

DROP POLICY IF EXISTS "assistant_messages_insert_owner" ON public.assistant_messages;
CREATE POLICY "assistant_messages_insert_owner" ON public.assistant_messages
  FOR INSERT TO authenticated WITH CHECK (
    private.is_assistant_conversation_owner(conversation_id)
  );

DROP POLICY IF EXISTS "assistant_messages_update_owner" ON public.assistant_messages;
CREATE POLICY "assistant_messages_update_owner" ON public.assistant_messages
  FOR UPDATE TO authenticated
  USING (private.is_assistant_conversation_owner(conversation_id))
  WITH CHECK (private.is_assistant_conversation_owner(conversation_id));

DROP POLICY IF EXISTS "assistant_messages_delete_owner" ON public.assistant_messages;
CREATE POLICY "assistant_messages_delete_owner" ON public.assistant_messages
  FOR DELETE TO authenticated USING (
    private.is_assistant_conversation_owner(conversation_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_messages TO authenticated;

-- One settings row per (campaign, GM): the GM reads and writes their own
-- row while still a GM of the campaign. Co-GMs keep their own rows beside
-- it, unreadable to each other.
DROP POLICY IF EXISTS "assistant_settings_select_owner" ON public.assistant_settings;
CREATE POLICY "assistant_settings_select_owner" ON public.assistant_settings
  FOR SELECT TO authenticated USING (
    gm_id = (select auth.uid())
    AND private.is_campaign_gm(campaign_id)
  );

DROP POLICY IF EXISTS "assistant_settings_insert_owner" ON public.assistant_settings;
CREATE POLICY "assistant_settings_insert_owner" ON public.assistant_settings
  FOR INSERT TO authenticated WITH CHECK (
    gm_id = (select auth.uid())
    AND private.is_campaign_gm(campaign_id)
  );

DROP POLICY IF EXISTS "assistant_settings_update_owner" ON public.assistant_settings;
CREATE POLICY "assistant_settings_update_owner" ON public.assistant_settings
  FOR UPDATE TO authenticated
  USING (
    gm_id = (select auth.uid())
    AND private.is_campaign_gm(campaign_id)
  )
  WITH CHECK (
    gm_id = (select auth.uid())
    AND private.is_campaign_gm(campaign_id)
  );

DROP POLICY IF EXISTS "assistant_settings_delete_owner" ON public.assistant_settings;
CREATE POLICY "assistant_settings_delete_owner" ON public.assistant_settings
  FOR DELETE TO authenticated USING (
    gm_id = (select auth.uid())
    AND private.is_campaign_gm(campaign_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_settings TO authenticated;

DROP TRIGGER IF EXISTS assistant_conversations_updated_at ON public.assistant_conversations;
CREATE TRIGGER assistant_conversations_updated_at
  BEFORE UPDATE ON public.assistant_conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

DROP TRIGGER IF EXISTS assistant_messages_updated_at ON public.assistant_messages;
CREATE TRIGGER assistant_messages_updated_at
  BEFORE UPDATE ON public.assistant_messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

DROP TRIGGER IF EXISTS assistant_settings_updated_at ON public.assistant_settings;
CREATE TRIGGER assistant_settings_updated_at
  BEFORE UPDATE ON public.assistant_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_updated_at();

ALTER TABLE public.assistant_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.assistant_messages REPLICA IDENTITY FULL;
ALTER TABLE public.assistant_settings REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'assistant_conversations',
    'assistant_messages',
    'assistant_settings'
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
