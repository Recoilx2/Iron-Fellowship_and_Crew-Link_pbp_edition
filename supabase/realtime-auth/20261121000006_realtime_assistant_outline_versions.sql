-- Realtime allowlist for the assistant outline-versions channel family (#133, part of spec #10).
--
-- The listener in src/api-calls/assistant/listenToOutlineVersions.ts opens
-- assistant-outline-versions:<campaignId> so the Outline tab can offer Undo
-- while a version is kept. Like every other family, this topic stays
-- authenticated-only: row delivery stays governed by the versions table's
-- own GM-only access rules, so players and outsiders who somehow join the
-- campaign topic still receive no rows.
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
--   assistant-outline-versions% matches assistant-outline-versions:<campaignId>
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
      'assistant-outline-versions%',
      'homebrew%'
    ])
  );

COMMIT;
