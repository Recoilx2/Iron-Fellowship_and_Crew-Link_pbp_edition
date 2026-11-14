-- Realtime allowlist for the GM assistant channel families (#128, part of spec #10).
--
-- The listeners in src/api-calls/assistant/listenToConversations.ts and
-- listenToMessages.ts open assistant-conversations:<campaignId> and
-- assistant-messages:<conversationId> (settings read once through REST, so
-- assistant-settings needs no live channel, but it is listed here beside
-- its family for the settings listener a later ticket may add). Like every
-- other family, these topics stay authenticated-only: row delivery stays
-- governed by each table's own owner-GM access rules, so a co-GM who joins
-- the campaign topic still receives none of another GM's rows.
--
-- Conventions: never edit an applied file (see supabase/migrations/README.md;
-- realtime-auth uses the same applied tracking via migrate/apply.sh), so this
-- is a new file that replaces the policy on stacks that already ran the
-- earlier files and creates the final policy on fresh stacks (earlier files
-- apply first in filename order, then this drops and recreates it).
--
-- Static coverage proof (all construct*ChannelName formats in src):
--   user-%                matches user-settings:*, user-worlds:*,
--                         user-campaigns:*, user-campaign-members:*,
--                         user-campaign-characters:*
--   character%            matches character:*, characters:*,
--                         character-notes:*, character-note-content:*,
--                         character-rolls:*, character-tracks:*,
--                         character-assets:*, character-settings:*
--   campaign:%            matches campaign:<id>:rolls/tracks/assets/settings
--   campaign-notes%       matches campaign-notes:<campaignId>
--   campaign-note-content% matches campaign-note-content:<noteId>
--   world%                matches world:<worldId>, world-note-ids:*:*,
--                         world-note-content:*, world-lore:*, world-npcs:*,
--                         world-npc:*, world-locations:*, world-location:*
--   campaign-channels%    matches campaign-channels:<campaignId>
--   campaign-channel-members% matches campaign-channel-members:<campaignId>
--   channel-posts%        matches channel-posts:<channelId>
--   assistant-conversations% matches assistant-conversations:<campaignId>
--   assistant-messages%   matches assistant-messages:<conversationId>
--   assistant-settings%   matches assistant-settings:<campaignId>
--   homebrew%             matches homebrew-*:*, homebrew-collections:*,
--                         homebrew-collection:*

BEGIN;

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
      'assistant-settings%',
      'homebrew%'
    ])
  );

COMMIT;
