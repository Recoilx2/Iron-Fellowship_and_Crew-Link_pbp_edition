-- Realtime allowlist fix for campaign-notes/world families (#75, part of #11).
--
-- ADR 0002 chose topic-scoped read policies for the channel families the app
-- opens. The initial allowlist in
-- 20261112135000_realtime_channel_policies.sql (authenticated: user-%,
-- character%, campaign:%, homebrew%) predates #20/#21, which added
-- campaign-notes:<campaignId>, campaign-note-content:<noteId>, world:<worldId>,
-- world-note-ids:<kind>:<itemId> and world-note-content:<noteId> (plus
-- world-lore/world-npcs/world-locations/world-location/world-npc siblings).
-- LIKE 'campaign:%' never matches 'campaign-notes:...' (dash vs colon), and
-- nothing matched 'world%...', so private joins for those families failed
-- with "You do not have permissions to read from this Channel topic",
-- SUBSCRIBED never fired, and listeners stalled (campaignNotes.live 4/4 fail).
--
-- This file extends the authenticated SELECT policy with campaign-notes%,
-- campaign-note-content% and world% (one prefix covers world:,
-- world-note-ids:, world-note-content: and the other world-* families).
-- Authenticated-only: these scopes stay member-gated; anon stays
-- homebrew-only. No app change.
--
-- Conventions: never edit an applied file (see supabase/migrations/README.md;
-- realtime-auth uses the same applied tracking via migrate/apply.sh), so this
-- is a new file that replaces the policy on stacks that already ran the
-- original and creates the final policy on fresh stacks (original applies
-- first in filename order, then this drops and recreates it). Follows the
-- #69 policy-fix precedent: transaction with DROP IF EXISTS + CREATE keeps
-- it idempotent and safe to re-run by hand.
--
-- Static coverage proof (all construct*ChannelName formats in src at e312):
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
      'homebrew%'
    ])
  );

COMMIT;
