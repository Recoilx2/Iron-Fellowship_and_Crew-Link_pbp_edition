-- Private broadcast triggers for shared campaign data (spec #205, #206):
-- SHADOW PHASE. No client listener is migrated by this ticket: every listener
-- still uses postgres_changes. These triggers only publish to the new private
-- topics; the matching RLS policies live in
-- realtime-auth/20261127200000_realtime_shared_broadcasts.sql, applied after
-- the realtime tenant (and its broadcast_changes function) boots.
--
-- Topic families (canonical, before the client's :sub-<salt>-<n> suffix):
--   campaign-shared:<campaignId>:<family>  -- any campaign member
--   campaign-gm:<campaignId>:<family>      -- campaign GMs only
--   channel-shared:<channelId>             -- whoever can read the channel
-- GM-only rows never appear on a shared topic. GM-only DELETEs publish only
-- a key on campaign-gm:*, so no GM-only row ID or content reaches a player.
--
-- The helpers are SECURITY DEFINER with an empty search_path: the database
-- owner can read every roster and write every realtime.messages probe, while
-- an authenticated caller could not run these triggers directly. Failures
-- inside realtime.send are warnings (see the tenant function), so a missing
-- or lagging realtime service never aborts a user's write.
--
-- Conventions: see supabase/migrations/README.md. Never edit an applied
-- migration; this file runs once against an empty database and its DROP
-- IF EXISTS / CREATE OR REPLACE guards keep it safe to re-run by hand.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- The explicit-person roster check ships with #216's chat_email_prefs
-- migration as private.is_channel_member_as(cid, uid). Keep the existing
-- one-argument helper delegating to that shared rule: redefining the
-- two-argument form here would duplicate it and could drift from the
-- campaign-membership gate the shipped helpers use.
CREATE OR REPLACE FUNCTION private.is_channel_member(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_channel_member_as(cid, (select auth.uid()));
$$;

-- A refresh carries no row data: open listeners re-fetch through their
-- queue, so a removed member stops receiving rows on the next REST call.
CREATE OR REPLACE FUNCTION private.broadcast_realtime_refresh(
  topic text, scope jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('kind', 'refresh') || COALESCE(scope, '{}'::jsonb),
    'refresh',
    topic,
    true
  );
END;
$$;

-- Only the key of a deleted row is safe on a GM topic: broadcast_changes
-- would send the whole old record, including GM-only content.
CREATE OR REPLACE FUNCTION private.broadcast_realtime_key_delete(
  topic text, key_name text, key_value jsonb, table_name text, table_schema text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'id', key_value,
      'operation', 'DELETE',
      'key', key_name,
      'table', table_name,
      'schema', table_schema
    ),
    'DELETE',
    topic,
    true
  );
END;
$$;

-- Membership loss is a JOIN-time decision in Realtime: an already joined
-- socket keeps receiving broadcasts. Publishing a refresh on every canonical
-- topic of the campaign makes the listener re-fetch immediately instead of
-- waiting for the 10 s reconcile backstop.
CREATE OR REPLACE FUNCTION private.broadcast_membership_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cid uuid;
  family text;
  ch record;
BEGIN
  cid := OLD.campaign_id;
  FOREACH family IN ARRAY ARRAY[
    'notes', 'world', 'locations', 'npcs', 'lore', 'chat', 'assistant'
  ] LOOP
    PERFORM private.broadcast_realtime_refresh(
      'campaign-shared:' || cid || ':' || family,
      jsonb_build_object('campaign_id', cid)
    );
    PERFORM private.broadcast_realtime_refresh(
      'campaign-gm:' || cid || ':' || family,
      jsonb_build_object('campaign_id', cid)
    );
  END LOOP;
  FOR ch IN SELECT id FROM public.chat_channels WHERE campaign_id = cid LOOP
    PERFORM private.broadcast_realtime_refresh(
      'channel-shared:' || ch.id, jsonb_build_object('campaign_id', cid)
    );
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Losing a private-channel roster entry is the same kind of immediate
-- revoke; the channel topic is the one its listener actually joined.
CREATE OR REPLACE FUNCTION private.broadcast_channel_roster_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  chid uuid;
  cid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    chid := OLD.channel_id;
  ELSE
    chid := NEW.channel_id;
  END IF;
  SELECT campaign_id INTO cid FROM public.chat_channels WHERE id = chid;
  PERFORM private.broadcast_realtime_refresh(
    'channel-shared:' || chid,
    jsonb_build_object('campaign_id', cid)
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Campaign notes (including GM-only drafts and the outline). A note that
-- was shared and becomes unshared is announced on the shared topic as a
-- key-only delete so players drop the row they can no longer read.
CREATE OR REPLACE FUNCTION private.broadcast_campaign_note_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cid uuid;
  was_visible boolean;
  is_visible boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    cid := (to_jsonb(OLD) ->> 'campaign_id')::uuid;
    was_visible := (to_jsonb(OLD) ->> 'shared')::boolean;
    is_visible := false;
  ELSE
    cid := (to_jsonb(NEW) ->> 'campaign_id')::uuid;
    was_visible := (to_jsonb(NEW) ->> 'shared')::boolean;
    is_visible := was_visible;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF was_visible THEN
      PERFORM realtime.broadcast_changes(
        'campaign-shared:' || cid || ':notes', TG_OP, TG_OP,
        TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD, TG_LEVEL
      );
    END IF;
    PERFORM private.broadcast_realtime_key_delete(
      'campaign-gm:' || cid || ':notes', 'id', to_jsonb(OLD) -> 'id',
      TG_TABLE_NAME, TG_TABLE_SCHEMA
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND was_visible AND NOT is_visible THEN
    PERFORM private.broadcast_realtime_key_delete(
      'campaign-shared:' || cid || ':notes', 'id', to_jsonb(OLD) -> 'id',
      TG_TABLE_NAME, TG_TABLE_SCHEMA
    );
  END IF;

  IF is_visible THEN
    PERFORM realtime.broadcast_changes(
      'campaign-shared:' || cid || ':notes', TG_OP, TG_OP,
      TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD, TG_LEVEL
    );
  ELSE
    PERFORM realtime.broadcast_changes(
      'campaign-gm:' || cid || ':notes', TG_OP, TG_OP,
      TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD, TG_LEVEL
    );
  END IF;
  RETURN NEW;
END;
$$;

-- World data can be linked to several campaigns. Rows hidden from players
-- (or the world's GM-only notes/details) only ever reach campaign-gm:*.
CREATE OR REPLACE FUNCTION private.broadcast_world_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  wid uuid;
  cid uuid;
  family text;
  was_visible boolean;
  is_visible boolean;
BEGIN
  family := CASE TG_TABLE_NAME
    WHEN 'worlds' THEN 'world'
    WHEN 'world_locations' THEN 'locations'
    WHEN 'world_lore' THEN 'lore'
    WHEN 'world_npcs' THEN 'npcs'
    WHEN 'world_notes' THEN 'world'
    ELSE 'world'
  END;

  IF TG_OP = 'DELETE' THEN
    wid := COALESCE(
      (to_jsonb(OLD) ->> 'world_id')::uuid,
      (to_jsonb(OLD) ->> 'id')::uuid
    );
    was_visible := COALESCE(
      (to_jsonb(OLD) ->> 'shared_with_players')::boolean,
      NOT COALESCE((to_jsonb(OLD) ->> 'gm_only')::boolean, false),
      true
    );
    is_visible := false;
  ELSE
    wid := COALESCE(
      (to_jsonb(NEW) ->> 'world_id')::uuid,
      (to_jsonb(NEW) ->> 'id')::uuid
    );
    was_visible := COALESCE(
      (to_jsonb(NEW) ->> 'shared_with_players')::boolean,
      NOT COALESCE((to_jsonb(NEW) ->> 'gm_only')::boolean, false),
      true
    );
    is_visible := was_visible;
  END IF;

  FOR cid IN SELECT id FROM public.campaigns WHERE world_id = wid LOOP
    IF TG_OP = 'DELETE' THEN
      IF was_visible THEN
        PERFORM realtime.broadcast_changes(
          'campaign-shared:' || cid || ':' || family, TG_OP, TG_OP,
          TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD, TG_LEVEL
        );
      END IF;
      -- Key only, GM topic only: even a hidden row's id stays with GMs.
      PERFORM private.broadcast_realtime_key_delete(
        'campaign-gm:' || cid || ':' || family, 'id',
        to_jsonb(OLD) -> 'id', TG_TABLE_NAME, TG_TABLE_SCHEMA
      );
    ELSIF is_visible THEN
      PERFORM realtime.broadcast_changes(
        'campaign-shared:' || cid || ':' || family, TG_OP, TG_OP,
        TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD, TG_LEVEL
      );
    ELSE
      PERFORM realtime.broadcast_changes(
        'campaign-gm:' || cid || ':' || family, TG_OP, TG_OP,
        TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD, TG_LEVEL
      );
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- GM-only tables: no shared topic is ever passed to broadcast_changes, and
-- their DELETEs send just the key on campaign-gm:*.
CREATE OR REPLACE FUNCTION private.broadcast_gm_only_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cid uuid;
  wid uuid;
  family text := 'assistant';
  key_name text := 'id';
  key_value jsonb;
  row_data jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
  ELSE
    row_data := to_jsonb(NEW);
  END IF;
  key_value := row_data -> key_name;

  IF TG_TABLE_NAME IN ('assistant_conversations', 'assistant_outline_versions') THEN
    cid := (row_data ->> 'campaign_id')::uuid;
    key_name := 'id';
    key_value := row_data -> 'id';
  ELSIF TG_TABLE_NAME = 'assistant_messages' THEN
    SELECT campaign_id INTO cid FROM public.assistant_conversations
    WHERE id = (row_data ->> 'conversation_id')::uuid;
    key_name := 'id';
    key_value := row_data -> 'id';
  ELSIF TG_TABLE_NAME = 'world_location_gm_details' THEN
    SELECT world_id INTO wid FROM public.world_locations
    WHERE id = (row_data ->> 'location_id')::uuid;
    key_name := 'location_id';
    key_value := row_data -> 'location_id';
    family := 'world';
  ELSIF TG_TABLE_NAME = 'world_npc_gm_details' THEN
    SELECT world_id INTO wid FROM public.world_npcs
    WHERE id = (row_data ->> 'npc_id')::uuid;
    key_name := 'npc_id';
    key_value := row_data -> 'npc_id';
    family := 'world';
  ELSE
    cid := NULL;
  END IF;

  FOR cid IN
    SELECT c.id FROM public.campaigns AS c
    WHERE (cid IS NOT NULL AND c.id = cid)
       OR (wid IS NOT NULL AND c.world_id = wid)
  LOOP
    IF TG_OP = 'DELETE' THEN
      PERFORM private.broadcast_realtime_key_delete(
        'campaign-gm:' || cid || ':' || family, key_name, key_value,
        TG_TABLE_NAME, TG_TABLE_SCHEMA
      );
    ELSE
      PERFORM realtime.broadcast_changes(
        'campaign-gm:' || cid || ':' || family, TG_OP, TG_OP,
        TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD, TG_LEVEL
      );
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Chat rows live on the per-channel topic. can_read_channel (and therefore
-- private.is_channel_member) already decides who may join that topic.
CREATE OR REPLACE FUNCTION private.broadcast_chat_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  chid uuid;
  row_data jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
  ELSE
    row_data := to_jsonb(NEW);
  END IF;
  IF TG_TABLE_NAME = 'chat_channels' THEN
    chid := (row_data ->> 'id')::uuid;
  ELSE
    chid := (row_data ->> 'channel_id')::uuid;
  END IF;
  PERFORM realtime.broadcast_changes(
    'channel-shared:' || chid, TG_OP, TG_OP,
    TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD, TG_LEVEL
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Large Yjs content rows are opaque blobs; a refresh keeps payloads small
-- and makes listeners read the current bytes through their normal fetch.
CREATE OR REPLACE FUNCTION private.broadcast_content_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  nid uuid;
  cid uuid;
  wid uuid;
  visible boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    nid := (to_jsonb(OLD) ->> 'note_id')::uuid;
  ELSE
    nid := (to_jsonb(NEW) ->> 'note_id')::uuid;
  END IF;
  IF TG_TABLE_NAME = 'campaign_note_contents' THEN
    SELECT campaign_id, shared INTO cid, visible
    FROM public.campaign_notes WHERE id = nid;
    IF cid IS NOT NULL THEN
      PERFORM private.broadcast_realtime_refresh(
        CASE WHEN COALESCE(visible, false)
          THEN 'campaign-shared:' || cid || ':notes'
          ELSE 'campaign-gm:' || cid || ':notes' END,
        jsonb_build_object('id', nid)
      );
    END IF;
  ELSE
    SELECT n.world_id, NOT n.gm_only INTO wid, visible
    FROM public.world_notes n WHERE n.id = nid;
    FOR cid IN SELECT id FROM public.campaigns WHERE world_id = wid LOOP
      PERFORM private.broadcast_realtime_refresh(
        CASE WHEN COALESCE(visible, false)
          THEN 'campaign-shared:' || cid || ':world'
          ELSE 'campaign-gm:' || cid || ':world' END,
        jsonb_build_object('id', nid)
      );
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- One trigger per table, all AFTER FOR EACH ROW so the row is committed and
-- the helper sees the final values. Names are prefixed so a later ticket
-- can drop just these when it flips a listener to broadcasts.
DROP TRIGGER IF EXISTS realtime_broadcast_campaign_notes ON public.campaign_notes;
CREATE TRIGGER realtime_broadcast_campaign_notes
  AFTER INSERT OR UPDATE OR DELETE ON public.campaign_notes
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_campaign_note_change();

DROP TRIGGER IF EXISTS realtime_refresh_campaign_note_content ON public.campaign_note_contents;
CREATE TRIGGER realtime_refresh_campaign_note_content
  AFTER INSERT OR UPDATE OR DELETE ON public.campaign_note_contents
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_content_refresh();

DROP TRIGGER IF EXISTS realtime_broadcast_worlds ON public.worlds;
CREATE TRIGGER realtime_broadcast_worlds
  AFTER INSERT OR UPDATE OR DELETE ON public.worlds
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_world_change();

DROP TRIGGER IF EXISTS realtime_broadcast_world_locations ON public.world_locations;
CREATE TRIGGER realtime_broadcast_world_locations
  AFTER INSERT OR UPDATE OR DELETE ON public.world_locations
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_world_change();

DROP TRIGGER IF EXISTS realtime_broadcast_world_lore ON public.world_lore;
CREATE TRIGGER realtime_broadcast_world_lore
  AFTER INSERT OR UPDATE OR DELETE ON public.world_lore
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_world_change();

DROP TRIGGER IF EXISTS realtime_broadcast_world_npcs ON public.world_npcs;
CREATE TRIGGER realtime_broadcast_world_npcs
  AFTER INSERT OR UPDATE OR DELETE ON public.world_npcs
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_world_change();

DROP TRIGGER IF EXISTS realtime_broadcast_world_notes ON public.world_notes;
CREATE TRIGGER realtime_broadcast_world_notes
  AFTER INSERT OR UPDATE OR DELETE ON public.world_notes
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_world_change();

DROP TRIGGER IF EXISTS realtime_refresh_world_note_content ON public.world_note_contents;
CREATE TRIGGER realtime_refresh_world_note_content
  AFTER INSERT OR UPDATE OR DELETE ON public.world_note_contents
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_content_refresh();

DROP TRIGGER IF EXISTS realtime_broadcast_world_location_gm_details ON public.world_location_gm_details;
CREATE TRIGGER realtime_broadcast_world_location_gm_details
  AFTER INSERT OR UPDATE OR DELETE ON public.world_location_gm_details
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_gm_only_change();

DROP TRIGGER IF EXISTS realtime_broadcast_world_npc_gm_details ON public.world_npc_gm_details;
CREATE TRIGGER realtime_broadcast_world_npc_gm_details
  AFTER INSERT OR UPDATE OR DELETE ON public.world_npc_gm_details
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_gm_only_change();

DROP TRIGGER IF EXISTS realtime_broadcast_chat_channels ON public.chat_channels;
CREATE TRIGGER realtime_broadcast_chat_channels
  AFTER INSERT OR UPDATE OR DELETE ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_chat_change();

DROP TRIGGER IF EXISTS realtime_broadcast_chat_channel_members ON public.chat_channel_members;
CREATE TRIGGER realtime_broadcast_chat_channel_members
  AFTER INSERT OR UPDATE OR DELETE ON public.chat_channel_members
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_chat_change();

DROP TRIGGER IF EXISTS realtime_broadcast_chat_posts ON public.chat_posts;
CREATE TRIGGER realtime_broadcast_chat_posts
  AFTER INSERT OR UPDATE OR DELETE ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_chat_change();

DROP TRIGGER IF EXISTS realtime_broadcast_assistant_conversations ON public.assistant_conversations;
CREATE TRIGGER realtime_broadcast_assistant_conversations
  AFTER INSERT OR UPDATE OR DELETE ON public.assistant_conversations
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_gm_only_change();

DROP TRIGGER IF EXISTS realtime_broadcast_assistant_messages ON public.assistant_messages;
CREATE TRIGGER realtime_broadcast_assistant_messages
  AFTER INSERT OR UPDATE OR DELETE ON public.assistant_messages
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_gm_only_change();

DROP TRIGGER IF EXISTS realtime_broadcast_assistant_outline_versions ON public.assistant_outline_versions;
CREATE TRIGGER realtime_broadcast_assistant_outline_versions
  AFTER INSERT OR UPDATE OR DELETE ON public.assistant_outline_versions
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_gm_only_change();

DROP TRIGGER IF EXISTS realtime_refresh_on_campaign_membership ON public.campaign_members;
CREATE TRIGGER realtime_refresh_on_campaign_membership
  AFTER DELETE OR UPDATE OF role ON public.campaign_members
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_membership_refresh();

DROP TRIGGER IF EXISTS realtime_refresh_on_channel_membership ON public.chat_channel_members;
CREATE TRIGGER realtime_refresh_on_channel_membership
  AFTER INSERT OR DELETE ON public.chat_channel_members
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_channel_roster_refresh();

COMMIT;
