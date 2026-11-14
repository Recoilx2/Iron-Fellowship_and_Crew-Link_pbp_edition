-- Realtime allowlist for chat channel families (spec #9).
--
-- ADR 0002 chose topic-scoped read policies for the channel families the app
-- opens. The allowlist in 20261112135000_realtime_channel_policies.sql
-- (authenticated: user-%, character%, campaign:%, homebrew%) plus
-- 20261113060422_realtime_channel_notes_worlds.sql (campaign-notes%,
-- campaign-note-content%, world%) predates the chat listeners, which open
-- campaign-channels:<campaignId>, campaign-channel-members:<campaignId> and
-- channel-posts:<channelId> (see _getRef.ts, _postRef.ts). LIKE
-- 'campaign:%' never matches 'campaign-channels:...' (dash vs colon), and
-- nothing matched 'channel-posts:...', so private joins for those families
-- failed with "You do not have permissions to read from this Channel
-- topic", SUBSCRIBED never fired, and listeners stalled.
--
-- This file extends the authenticated SELECT policy with campaign-channels%,
-- campaign-channel-members% and channel-posts% (one prefix per family:
-- 'campaign-channels%' never matches the members family, so both are
-- listed). Authenticated-only: these scopes stay member-gated; anon stays
-- homebrew-only. No app change.
--
-- Conventions: never edit an applied file (see supabase/migrations/README.md;
-- realtime-auth uses the same applied tracking via migrate/apply.sh), so this
-- is a new file that replaces the policy on stacks that already ran the
-- earlier files and creates the final policy on fresh stacks (earlier files
-- apply first in filename order, then this drops and recreates it). Follows
-- the #69 policy-fix precedent: transaction with DROP IF EXISTS + CREATE keeps
-- it idempotent and safe to re-run by hand.
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
      'homebrew%'
    ])
  );

COMMIT;
