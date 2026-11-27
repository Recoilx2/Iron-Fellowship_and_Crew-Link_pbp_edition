-- Membership-checked authorization for the private broadcast topics of
-- spec #205/#206 (SHADOW PHASE: no client listener is migrated yet).
--
-- Every private channel join asks realtime.authorize to prove the connecting
-- role may read the topic: it inserts probe rows into realtime.messages and
-- selects them back with realtime.topic set to the channel's sub-topic. The
-- SELECT policies below decide that proof; the INSERT policy lets the same
-- channels publish presence. ADR 0002 requires current_setting('realtime.topic',
-- true) rather than realtime.topic() so the file parses before the tenant
-- setup creates that helper; a missing setting matches nothing (deny by
-- default).
--
-- Canonical topics (clients keep their :sub-<salt>-<n> suffix):
--   campaign-shared:<campaignId>:<family>  -- any campaign member
--   campaign-gm:<campaignId>:<family>      -- campaign GMs only
--   channel-shared:<channelId>             -- roster / public / GM readers
-- The regex guards make a malformed topic fail closed instead of throwing
-- a cast error inside the probe. The generic prefixes keep every existing
-- owner-only listener working; none of them matches the three new families.
--
-- Runs after realtime boots (see supabase/docker-compose.yml, realtime-auth
-- service). Safe to re-run: every policy is dropped before it is created.

BEGIN;

-- Keep the 13 owner-only families exactly as the last allowlist file left
-- them. New families are deliberately NOT added here: they need membership
-- checks, so they have their own policies below.
DROP POLICY IF EXISTS "realtime app channels readable by signed-in listeners" ON realtime.messages;

CREATE POLICY "realtime app channels readable by signed-in listeners"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND current_setting('realtime.topic', true) LIKE ANY (ARRAY[
      'user-%',
      'character%',
      'campaign:%',
      'campaign-notes%',
      'campaign-note-content%',
      'world%',
      'campaign-channels%',
      'campaign-channel-members%',
      'channel-posts%',
      'assistant-conversations%',
      'assistant-messages%',
      'assistant-outline-versions%',
      'homebrew%'
    ])
  );

DROP POLICY IF EXISTS "realtime campaign shared topics readable by members" ON realtime.messages;
CREATE POLICY "realtime campaign shared topics readable by members"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND CASE
      WHEN current_setting('realtime.topic', true) ~ '^campaign-shared:[0-9a-fA-F-]{36}:'
      THEN private.is_campaign_member(
        split_part(current_setting('realtime.topic', true), ':', 2)::uuid
      )
      ELSE false
    END
  );

DROP POLICY IF EXISTS "realtime campaign gm topics readable by gms" ON realtime.messages;
CREATE POLICY "realtime campaign gm topics readable by gms"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND CASE
      WHEN current_setting('realtime.topic', true) ~ '^campaign-gm:[0-9a-fA-F-]{36}:'
      THEN private.is_campaign_gm(
        split_part(current_setting('realtime.topic', true), ':', 2)::uuid
      )
      ELSE false
    END
  );

-- Mirrors private.can_read_channel: public channels belong to every campaign
-- member, private channels to their roster and the campaign's GMs, and DMs
-- to their two members alone (not even a GM who is outside the DM).
DROP POLICY IF EXISTS "realtime channel shared topics readable by channel readers" ON realtime.messages;
CREATE POLICY "realtime channel shared topics readable by channel readers"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND CASE
      WHEN current_setting('realtime.topic', true) ~ '^channel-shared:[0-9a-fA-F-]{36}(:|$)'
      THEN (
        private.is_channel_member(
          split_part(current_setting('realtime.topic', true), ':', 2)::uuid
        )
        OR EXISTS (
          SELECT 1 FROM public.chat_channels AS ch
          WHERE ch.id = split_part(current_setting('realtime.topic', true), ':', 2)::uuid
            AND (
              (ch.visibility = 'public' AND private.is_campaign_member(ch.campaign_id))
              OR (ch.visibility = 'private' AND private.is_campaign_gm(ch.campaign_id))
            )
        )
      )
      ELSE false
    END
  );

-- Presence track() is a WRITE on realtime.messages. Mirror both the old
-- prefixes and the new membership-checked families, or the SDK's track()
-- resolves with 'error' while the channel still reports SUBSCRIBED.
DROP POLICY IF EXISTS "realtime app channels writable by signed-in listeners" ON realtime.messages;

CREATE POLICY "realtime app channels writable by signed-in listeners"
  ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND (
      current_setting('realtime.topic', true) LIKE ANY (ARRAY[
        'user-%',
        'character%',
        'campaign:%',
        'campaign-notes%',
        'campaign-note-content%',
        'world%',
        'campaign-channels%',
        'campaign-channel-members%',
        'channel-posts%',
        'assistant-conversations%',
        'assistant-messages%',
        'assistant-outline-versions%',
        'homebrew%'
      ])
      OR CASE
        WHEN current_setting('realtime.topic', true) ~ '^campaign-shared:[0-9a-fA-F-]{36}:'
        THEN private.is_campaign_member(
          split_part(current_setting('realtime.topic', true), ':', 2)::uuid
        )
        ELSE false
      END
      OR CASE
        WHEN current_setting('realtime.topic', true) ~ '^campaign-gm:[0-9a-fA-F-]{36}:'
        THEN private.is_campaign_gm(
          split_part(current_setting('realtime.topic', true), ':', 2)::uuid
        )
        ELSE false
      END
      OR CASE
        WHEN current_setting('realtime.topic', true) ~ '^channel-shared:[0-9a-fA-F-]{36}(:|$)'
        THEN (
          private.is_channel_member(
            split_part(current_setting('realtime.topic', true), ':', 2)::uuid
          )
          OR EXISTS (
            SELECT 1 FROM public.chat_channels AS ch
            WHERE ch.id = split_part(current_setting('realtime.topic', true), ':', 2)::uuid
              AND (
                (ch.visibility = 'public' AND private.is_campaign_member(ch.campaign_id))
                OR (ch.visibility = 'private' AND private.is_campaign_gm(ch.campaign_id))
              )
          )
        )
        ELSE false
      END
    )
  );

COMMIT;
