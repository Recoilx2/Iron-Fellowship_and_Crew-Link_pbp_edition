# Private realtime channels need RLS policies on realtime.messages

Every private channel join asks the realtime server to prove the connecting
role may read the topic: it inserts probe rows into `realtime.messages` and
selects them back as that role with `realtime.topic` set to the channel's
sub-topic (`realtime.authorize`). The stock self-hosted tenant ships RLS
enabled on `realtime.messages` with no policies, so every private join fails
with "You do not have permissions to read from this Channel topic".

## Considered options

- **Open the channels as public** (`private: false`): rejected. Database
  broadcasts only reach private topics, and the spec requires broadcasts on
  private topics with access checked by the rules. Public channels would also
  silently receive nothing for broadcasts.
- **One permissive policy for every role and topic**: rejected. It would let
  any signed-in listener join any private topic, weakening the future
  broadcast story (shared campaign data pushed as broadcasts on private
  topics) before it exists.
- **Topic-scoped read policies for the channel families the app opens**
  (chosen): signed-in listeners may read the `broadcast`/`presence`
  extensions on the app's topic families; anonymous listeners only on the
  public homebrew families. Row delivery stays governed by each table's own
  RLS, as before. Server roles keep full access.

## Consequences

- The policies live in `supabase/realtime-auth/`, not `supabase/migrations/`:
  `realtime.messages` is created by the realtime tenant setup at boot, after
  the `migrate` service finishes. A one-shot `realtime-auth` service applies
  them once realtime is healthy, tracking what ran in
  `supabase_migrations.applied` like `migrate` does.
- Topic matching uses `current_setting('realtime.topic', true)` instead of
  `realtime.topic()` so the file parses before the tenant setup creates that
  helper. A missing setting matches nothing: deny by default.
- When database broadcasts arrive (later tickets), delivery to a joined
  subscriber is gated by the same read authorization, so tightening a family
  later is a policy edit, not an app change.
