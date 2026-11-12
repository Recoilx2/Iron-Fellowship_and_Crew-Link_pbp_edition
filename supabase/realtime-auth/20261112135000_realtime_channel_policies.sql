-- Private-channel authorization for live updates.
--
-- Every private channel join asks the realtime server to prove the connecting
-- role may read the topic: it inserts probe rows into realtime.messages and
-- selects them back as that role with realtime.topic set to the channel's
-- sub-topic (see realtime.authorize). The stock tenant ships RLS enabled on
-- realtime.messages with NO policies, so every private join fails with
-- "You do not have permissions to read from this Channel topic", SUBSCRIBED
-- never fires, and listeners stall with no error. These policies authorize
-- exactly the channel families the app opens (all private); row delivery
-- stays governed by each table's own RLS, as before.
--
-- Runs AFTER live updates boots (see supabase/docker-compose.yml,
-- realtime-auth service): realtime.messages is created by the realtime
-- tenant setup at boot, so this cannot run in supabase/migrations/.
-- Safe to re-run: each policy is created only when missing.
--
-- Topic matching uses current_setting('realtime.topic', true) instead of
-- realtime.topic() so this file parses even before the tenant setup creates
-- that helper. A missing setting yields NULL, which never matches: deny.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'realtime app channels readable by signed-in listeners'
  ) THEN
    CREATE POLICY "realtime app channels readable by signed-in listeners"
      ON realtime.messages FOR SELECT TO authenticated
      USING (
        realtime.messages.extension IN ('broadcast', 'presence')
        AND current_setting('realtime.topic', true) LIKE ANY (ARRAY[
          'user-%',
          'character%',
          'campaign:%',
          'homebrew%'
        ])
      );
  END IF;

  -- Homebrew reads are public, so signed-out viewers may listen too.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'realtime public homebrew channels readable anonymously'
  ) THEN
    CREATE POLICY "realtime public homebrew channels readable anonymously"
      ON realtime.messages FOR SELECT TO anon
      USING (
        realtime.messages.extension IN ('broadcast', 'presence')
        AND current_setting('realtime.topic', true) LIKE 'homebrew%'
      );
  END IF;

  -- The realtime server and server-side keys must keep full access to the
  -- messages table regardless of the listener policies above.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'realtime server keeps full access to messages'
  ) THEN
    CREATE POLICY "realtime server keeps full access to messages"
      ON realtime.messages FOR ALL
      TO supabase_admin, supabase_realtime_admin, service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
