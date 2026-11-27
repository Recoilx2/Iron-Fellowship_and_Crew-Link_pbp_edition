-- Presence writes on private realtime topics.
--
-- A private-channel JOIN is authorized by a SELECT probe on realtime.messages
-- (see the channel policies applied by earlier files). Presence `track()` is
-- a separate WRITE on realtime.messages and needs its own INSERT policy:
-- without one, realtime.authorize denies the write and the SDK's track()
-- resolves with 'error' while the channel still reports SUBSCRIBED. The
-- self-hosted stack therefore accepted listeners but never delivered a
-- presence state to other members.
--
-- The topic families mirror the SELECT policy so the same channels can both
-- listen and publish presence. Safe to re-run.

BEGIN;

DROP POLICY IF EXISTS "realtime app channels writable by signed-in listeners" ON realtime.messages;

CREATE POLICY "realtime app channels writable by signed-in listeners"
  ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (
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

COMMIT;
