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
  any signed-in listener join any private topic, weakening the
  membership-checked broadcast topics the app now uses.
- **Topic-scoped read policies for the channel families the app opens**
  (chosen): signed-in listeners may read the `broadcast`/`presence`
  extensions on the app's topic families; anonymous listeners only on the
  public homebrew families. Row delivery is then governed by the table's own
  RLS on the REST fetch and by the broadcast trigger's payload projection and
  topic choice on the live path. Server roles keep full access.

## Shipped broadcast design (decided 2026-11-27)

The owner chose to schedule database broadcasts in #104; #206 settled the
mechanism; #211 shipped the policies and triggers, and #212 moved the
listeners. The sections below record the design as shipped, not a proposal.

### Topic families and membership checks

Three private topic families carry shared data. Their `SELECT` and `INSERT`
(presence) policies live in `supabase/realtime-auth/` and reuse the app's own
access rules instead of inventing a second set:

| Topic | Join allowed by |
| --- | --- |
| `campaign-shared:<campaignId>:<family>` | `private.is_campaign_member` |
| `campaign-gm:<campaignId>:<family>` | `private.is_campaign_gm` |
| `channel-shared:<channelId>` | `private.can_read_channel` |

`<family>` is one of `notes`, `world`, `locations`, `npcs`, `lore`, `chat`,
`assistant`. Regex guards fail closed on malformed topics. The 13 older
prefixes (`character%`, `campaign:%`, `world%`, ...) remain for owner-only
listeners; none of them matches the three membership-checked families.

`SECURITY DEFINER` triggers publish row changes with
`realtime.broadcast_changes()`. Large content tables publish a refresh-only
signal (`private.broadcast_realtime_refresh`) so row contents never go on the
wire for those families.

**Clients join the exact canonical topic.** Supabase routes a database
broadcast to the topic named by the trigger; there is no fan-out from a base
topic to a suffixed one. `listenToRows` therefore opens one shared, ref-counted
private channel per canonical topic and dispatches each broadcast to every
listener registered on it. The `:sub-<salt>-<n>` suffix remains only for
`postgres_changes` listeners, where it prevents two subscriptions on the same
channel name from colliding (issue #116). Sharing a canonical channel also
avoids calling `.on()` on an already-subscribed realtime channel.

### GM-only rows

Row data a player may not see is never published on a topic a player can
join. Notes, world and assistant GM details publish to `campaign-gm:*` only;
GM-only DELETEs publish just the primary key, so not even the id of a hidden
row reaches a player. The GM topic is bound as `optional`: a player's join is
denied by policy, and that denial must not surface as an error or tear down
their shared-topic subscription.

Chat is the exception that proves the rule: the `channel-shared` trigger
publishes every `chat_posts` row, and channel membership is a broader check
than the post's `gms_only` flag. The REST fetch is RLS-filtered, so the live
listener applies the same filter (`channelPostBroadcastChange`) to inserts,
updates and deletes for non-GMs. Without it, a broadcast would reveal a
GM-only post that the fetch path correctly hides.

### Revocation: explicit refresh, reconcile backstop

Realtime authorization is checked at join time, so removing a membership or
demoting a GM does not by itself stop an already-joined listener. Triggers on
campaign membership, role changes and private-channel roster changes publish
a `refresh` event to every affected canonical topic. `listenToRows` routes
that signal through its pending/queue path, re-fetches through RLS and drops
rows the reader can no longer see. A failed optional join still performs one
fetch and starts the reconcile timer.

The existing 10-second reconcile timer remains as a **dropped-event
backstop**, not as the primary mechanism: spec #205 requires removed rows to
disappear immediately, and the live tests assert convergence in under ten
seconds. Re-fetch on every `SUBSCRIBED`, plus canonical-signature dedup,
prevents duplicate or stale emissions.

### Listener split

Moved to broadcasts: notes, world (including GM details), assistant and
chat (channels, members, posts, roll posts). Kept on `postgres_changes`:
user settings, characters, user campaigns and campaign characters, homebrew,
assets, character settings, tracks, logs and character-note branches. Those
rows are owned by one user or public to everyone, so a membership-checked
topic would add cost without adding protection.

## Consequences

- The policies live in `supabase/realtime-auth/`, not `supabase/migrations/`:
  `realtime.messages` is created by the realtime tenant setup at boot, after
  the `migrate` service finishes. A one-shot `realtime-auth` service applies
  them once realtime is healthy, tracking what ran in
  `supabase_migrations.applied` like `migrate` does.
- Topic matching uses `current_setting('realtime.topic', true)` instead of
  `realtime.topic()` so the file parses before the tenant setup creates that
  helper. A missing setting matches nothing: deny by default.
- Delivery to a joined subscriber is gated by the same read authorization,
  so tightening a family later is a policy edit, not an app change.
- A new topic family needs three coordinated pieces: a membership-checked
  policy, a trigger that publishes to the exact canonical name, and a client
  binding that joins that name. Unit mocks cannot catch a name mismatch —
  only a live test against the stack can.
