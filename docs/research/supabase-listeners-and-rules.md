# How Supabase replaces Firestore listeners and rules

Research for issue #3, part of map #1. Checked 2026-11-11 against Supabase docs, the `supabase/realtime` source (main), the `supabase/supabase` docker files (master), the `supabase-js` source and the PostgreSQL docs.

Each claim carries a tag:

- **[D]**: documented, stated in the cited source.
- **[I]**: inference, my reasoning from the sources and this codebase.

## Short answer

- **Live updates.** Use **Broadcast from database** for anything shared inside a campaign or world. A trigger calls `realtime.broadcast_changes()` onto private topics such as `campaign:<id>` and `campaign:<id>:gm`, and RLS on `realtime.messages` decides who may join each topic. Supabase docs recommend this "for scalability and security".
- **Postgres Changes** (RLS-filtered row streaming) is simpler. It is fine for rows only their owner sees, such as user settings and your own characters. It has two catches:
  - DELETE events skip RLS.
  - Every change is authorized against every subscriber on a single thread.
- **No initial snapshot.** Neither mechanism has the equivalent of `onSnapshot`'s first snapshot. Every `listenToX` becomes:
  1. subscribe and buffer events;
  2. on `SUBSCRIBED`, run a `select`;
  3. merge the buffered events by primary key;
  4. re-`select` after every reconnect.
- **Delivery.** Delivery is best effort, with no replay of Postgres Changes.
- **Access rules.** They become Postgres RLS policies built on a `campaign_members` table and `security definer` helper functions (`private.is_campaign_member()`, `private.is_campaign_gm()`).
- **GM-only fields.** Keep them in **separate 1:1 tables** (for example `lore` plus `lore_gm_details`) with GM-only RLS, published on a GM-only topic. Don't use column privileges or views.
- **Hidden-from-players flags** (`sharedWithPlayers`, `gmsOnly`, notes `shared`) must move from client-side filters into RLS. The current rules don't enforce them (see "Gaps in today's rules").

## Primary sources

| Key | URL |
| --- | --- |
| PC | https://supabase.com/docs/guides/realtime/postgres-changes |
| SDC | https://supabase.com/docs/guides/realtime/subscribing-to-database-changes |
| BC | https://supabase.com/docs/guides/realtime/broadcast |
| AUTHZ | https://supabase.com/docs/guides/realtime/authorization |
| LIM | https://supabase.com/docs/guides/realtime/limits |
| RLS | https://supabase.com/docs/guides/database/postgres/row-level-security |
| RLSPERF | https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv |
| CLS | https://supabase.com/docs/guides/database/postgres/column-level-security |
| RT | https://github.com/supabase/realtime (README, `ENVS.md`, `config/runtime.exs`, `lib/realtime/api/tenant.ex`, `priv/repo/seeds.exs`, tenant migrations under `lib/realtime/tenants/repo/migrations`) |
| DC | https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml and `docker/volumes/api/kong.yml` |
| RTJS | https://github.com/supabase/supabase-js/tree/master/packages/core/realtime-js (README, `RealtimeClient.ts`) |
| PG | https://www.postgresql.org/docs/current/sql-altertable.html, https://www.postgresql.org/docs/current/sql-createview.html |

## What the app does today

These are read from this repo.

- There are 40 `listenTo*.ts` files under `src/api-calls/`. Each wraps `onSnapshot` and returns an `Unsubscribe`. Zustand slices in `src/stores/` call them from `useEffect` hooks and from `subscribe*` actions, and tear them down on unmount or when an ID changes.
- Most listeners use `snapshot.docChanges()` and map `added`/`modified` to an upsert and `removed` to a delete. Examples: `listenToLoreDocuments`, `listenToLogs`, `listenToUsersCampaigns`. A few take the whole snapshot each time and re-sort on the client (`listenToNotes`).
- Query shapes used:
  - equality `where` (`sharedWithPlayers == true`, `gmsOnly == false`, `shared == true`)
  - `array-contains` (`campaigns.users` contains uid)
  - `orderBy("timestamp","desc") + limit(n)` (game log)
  - single-document listeners (`listenToCharacter`, `listenToLoreGMProperties`)
- GM-only data lives in `private/details` subdocuments under lore, NPCs and locations, and in `private/notes` under sectors. The rules let only the world's `ownerIds` or `campaignGuides` read those. The store only opens the GM-properties listener when the user is a world owner (`lore.slice.ts`, `subscribeToOpenLore`).
- Notes belong to a character or campaign and carry a `shared` flag. Content is kept in a separate `content` document holding Yjs bytes.

### Gaps in today's rules [I]

Each gap below comes from `firestore.rules`.

- **Campaigns.** `campaigns/{id}` and every subcollection allow read, write and delete for any signed-in user. Membership is not checked.
- **World lore, NPCs and locations.** The base documents are `allow read: if true`. `sharedWithPlayers` is only a client-side `where`, so anyone can read unshared lore or NPCs by dropping the filter.
- **Game log.** `gmsOnly` rolls are hidden only by a client filter, and `game-log` is world-readable.
- **Notes.** `shared` is only a client filter, so a campaign member can read other members' unshared campaign notes.

The Supabase design should close all four with RLS rather than copy them.

## 1. Subscribing to a query with filters

### Postgres Changes

- **[D]** A subscription names one `schema`/`table`/`event` and an optional `filter`. Operators (PC):
  - `eq`, `neq`, `lt`, `lte`, `gt`, `gte`
  - `in`, max 100 values
  - `like`, `ilike`, `match`, `imatch`, `is`, `isdistinct`
- **[D]** "Combine multiple conditions by separating them with commas." Conditions are AND-ed. "OR is not supported." (PC)
- **[D]** Filtered-out events never leave the database. You can restrict which columns come back. (PC)
- **[D]** One channel can carry several `.on('postgres_changes', …)` listeners for different tables or filters. Tear down with `supabase.removeChannel(channel)` or `removeAllChannels()`. (PC; https://supabase.com/docs/reference/javascript/removechannel)
- **[I]** There are no joins, `orderBy`, `limit` or array-contains. So:
  - `listenToUsersCampaigns` (`users array-contains uid`) cannot be expressed as a filter. Model membership as a `campaign_members` table and either rely on RLS, or subscribe to `campaign_members` with `user_id=eq.<uid>` and then load campaigns.
  - `listenToLogs`' `orderBy … limit n` becomes an initial `select … order by created_at desc limit n`. Live inserts are then placed by sort key on the client, and the client trims the window itself.

### Broadcast from database

- **[D]** The client joins a topic (`supabase.channel('campaign:123', { config: { private: true } })`) and receives whatever the trigger sends to it. There is no server-side row filter beyond the topic. (SDC, BC)
- **[I]** "Filters" therefore become the topic design. One topic per campaign (plus a GM topic) replaces most of the per-area queries. The client routes events by `payload.table`.

### No initial snapshot (both mechanisms) [I]

Neither mechanism documents delivering existing rows on subscribe (PC, BC). So the "subscribe, then load" race has to be handled by hand:

1. Open the channel. Buffer incoming events.
2. On the `SUBSCRIBED` status, run the initial `select`.
3. Apply the select result. Then replay the buffered events, idempotently by primary key; an `updated_at` column lets stale events be dropped.
4. On `CHANNEL_ERROR` / `TIMED_OUT` / re-`SUBSCRIBED`, repeat step 2. Nothing is replayed for you (see section 2). Subscribe status values: https://supabase.com/docs/reference/javascript/subscribe.

**Recommendation [I]:** write this once as a single helper (for example `subscribeToTable({ channel, table, select, onUpsert, onRemove })` returning an unsubscribe). Then each `listenToX` keeps its current shape, and the Zustand slices and hooks barely change.

## 2. Inserts, updates and deletes, and their order

- **[D]** The table must be in the `supabase_realtime` publication: `alter publication supabase_realtime add table …` (PC).
- **[D]** Payloads (realtime migration `20240827160934_filter_delete_postgres_changes`):
  - INSERT/UPDATE carry `record` (supabase-js: `payload.new`).
  - UPDATE/DELETE carry `old_record` (`payload.old`).
  - "By default, only `new` record changes are sent". To get full `old` values, set `REPLICA IDENTITY FULL` (PC). PostgreSQL DEFAULT records only the primary key's old values (PG ALTER TABLE).
- **[D]** "You can only filter Delete events … if the table has the `replica identity` set to `full`." (PC)
- **[D]** "RLS policies are not applied to `DELETE` statements, because there is no way for Postgres to verify that a user has access to a deleted record." (PC) In the source, DELETEs go to every matching subscriber. On RLS-enabled tables, `old_record` is cut to primary-key columns.
- **[I]** With Postgres Changes, a subscriber with SELECT grant on a GM-only table learns that row X was deleted and its ID, even if they could never read X. The content is not exposed, but this is still a reason not to stream GM-only tables over Postgres Changes.
- **[I]** With Postgres Changes, when an UPDATE makes a row **invisible** to a subscriber, they get no event at all, because the RLS check on the new row fails. Examples: lore flipped to not shared, a note un-shared, a member removed. Their client keeps a stale copy. Firestore sends `removed` in that case. Handle it by also emitting a delete on the old topic (Broadcast) or by re-selecting.
- **[D]** Ordering: changes "are also processed on a single thread to preserve their order" (PC). Nothing else is promised.
- **[D]** Delivery: "The server does not guarantee that every message will be delivered to your clients" (RT README).
- **[D]** Broadcast Replay: private channels can replay messages that were sent via Broadcast from database, using `since` and `limit` (max 25). It needs supabase-js 2.74.0+ (BC).
- **[D]** `realtime.messages` is stored in daily partitions. Partitions older than 72 hours are dropped (BC).
- **[I]** Treat delivery as at-most-once. Re-selecting on reconnect is the primary recovery. Replay is a nice-to-have for short gaps in chat.

## 3. Subscription and connection limits (self-hosted)

### Defaults

- **[D]** Self-hosted tenant defaults, set "when creating a tenant for the first time" (RT `ENVS.md`, `config/runtime.exs`):

  | Env var | Default |
  | --- | --- |
  | `TENANT_MAX_CONCURRENT_USERS` | 200 |
  | `TENANT_MAX_EVENTS_PER_SECOND` | 100 |
  | `TENANT_MAX_CHANNELS_PER_CLIENT` | 100 |
  | `TENANT_MAX_JOINS_PER_SECOND` | 100 |
  | `TENANT_MAX_BYTES_PER_SECOND` | 100000 |

  Also `MAX_CONNECTIONS` (16384 sockets) and `DB_POOL_SIZE` (5).
- **[D]** Payload limits:
  - Postgres Changes payloads over 1,024 KB are cut to fields whose values are 64 bytes or less (LIM).
  - The tenant's `max_payload_size_in_kb` defaults to 3000 (RT `tenant.ex`).
- **[D]** Error codes: `too_many_channels`, `too_many_connections`, `too_many_joins`, `tenant_events` (LIM).
- **[D]** Postgres Changes "authorizes every event against each subscriber". It is single-threaded, so more compute does not raise its throughput. Above about 3,000 concurrent subscribers on the same changes, use Broadcast (PC).

### Changing limits on self-hosted

- **[D]** The stock compose sets `SEED_SELF_HOST=true`, `RLIMIT_NOFILE=10000` and no `TENANT_MAX_*` variables (DC).
- **[D]** The seed runs on every start. It deletes and re-creates the `realtime-dev` tenant (RT `run.sh`, `priv/repo/seeds.exs`).
- **[D]** Kong blocks `/realtime/v1/api/tenants` (DC `kong.yml`).
- **[I]** So set limits as `TENANT_MAX_*` env vars on the realtime service in the Compose template. Hand edits to `_realtime.tenants` are lost on restart.

### What this means for the app

- **[I]** A Firestore-style "one channel per `listenToX`" design would open about 10 to 30 channels per client. That is under the 100-channel cap, but every page change costs joins against the 100 joins/s tenant cap.
- **[I]** A few long-lived channels per client (user, campaign, campaign-GM) avoids both limits. The 100 events/s tenant default is the one most likely to bite during busy chat or bulk imports, so the template should raise it.

## 4. How access rules apply to live updates

### Postgres Changes

- **[D]** Records are sent "only to clients who are allowed to read them based on your RLS policies" (AUTHZ).
- **[D]** Realtime stores each subscriber's JWT claims and role. For every change it sets `role` and `request.jwt.claims` and runs a `select` of that row per matching subscriber. The role also needs SELECT on the primary key (RT migration). On a table without RLS, the role gets "unfettered read access" (PC).

### Broadcast and Presence (Realtime Authorization)

- **[D]** Access is governed by RLS on `realtime.messages`, with `extension` set to `broadcast` or `presence`. `realtime.topic()` returns the topic being joined. Clients must pass `config: { private: true }` (AUTHZ).
- **[D]** "Client access policies are cached for the duration of the connection" and re-checked when a new JWT arrives (AUTHZ).
- **[D]** Private and public channels with the same name are separate (https://supabase.com/docs/guides/realtime/concepts).
- **[D]** `realtime.send(payload, event, topic, private DEFAULT true)` (RT migration `20241121104152`).
- **[I]** Realtime Authorization works self-hosted. `realtime.messages`, `realtime.send` and `realtime.broadcast_changes` are created by tenant migrations, and there is no hosted-only note in AUTHZ.
- **[I]** Caveat: the "private channels only" switch is the tenant's `private_only` flag. Because the seed re-creates the tenant on every boot, it resets to false. A client that forgets `private: true` just joins an empty public channel, because database broadcasts are private by default. This fails closed, but the app's helper should always set `private: true`.
- **[I]** Because access is cached per connection, removing someone from a campaign takes effect for Broadcast only when their channel rejoins or their JWT refreshes. Plan a "you were removed" broadcast plus a forced `removeChannel`.

### Token refresh

- **[D]** supabase-js calls `realtime.setAuth()` on `SIGNED_IN` / `TOKEN_REFRESHED`. The `accessToken` callback runs on connect and on every heartbeat (25 s). An expired token closes the channel with no automatic resubscribe (RTJS `RealtimeClient.ts`).
- **[I]** With magic-link sessions this is handled by the stock client. The reconnect path in section 1 covers the edge cases.

### RLS performance (both mechanisms) [D]

From RLSPERF and RLS:

- Index every column a policy filters on.
- Wrap calls as `(select auth.uid())` so they run once per statement. The docs show 179 ms dropping to 9 ms.
- Use `security definer` functions to read membership tables. Put them in a non-exposed schema with `set search_path = ''`.
- Always name the role with `to authenticated`.
- Still add `.eq()` filters in client queries, because RLS is "only for security".

## 5. Broadcast from database, concretely

- **[D]** Signature: `realtime.broadcast_changes(topic_name, event_name, operation, table_name, table_schema, NEW, OLD, level DEFAULT 'ROW')`. It sends `{record, old_record, operation, table, schema}` through `realtime.send` (RT migration `20240919163303`).
- **[D]** It is used from an `after insert or update or delete … for each row` `security definer` trigger (SDC).
- **[I]** The trigger sends the whole row, so the **topic must match the row's visibility**. A private note must never be sent to `campaign:<id>`. On a visibility flip, the trigger should send a delete to the old topic and an upsert to the new one. Where a row mixes public and private columns, use `realtime.send` with a hand-built payload. Better still, keep the split in separate tables (section 6).
- **[I]** Suggested topics and policies:

  | Topic | Who may join (policy on `realtime.messages` using `realtime.topic()`) | Carries |
  | --- | --- | --- |
  | `user:<uid>` | `auth.uid()` = uid | own settings, own characters, private notes, membership changes |
  | `campaign:<id>` | `private.is_campaign_member(id)` | posts in visible channels, shared notes, campaign tracks and assets, player-visible rolls, shared lore and NPCs of the campaign's world |
  | `campaign:<id>:gm` | `private.is_campaign_gm(id)` | `*_gm_details`, GM-only rolls, unshared lore and NPCs, campaign outline, GM assistant drafts |
  | `world:<id>` (optional) | world owner / guide | world editing outside a campaign, if worlds stay standalone |

- **[I]** Topic-level authorization also removes the Postgres Changes DELETE leak. Deletes reach only those allowed on the topic.

## 6. Modelling GM-only fields and rules

### Options

- **[D]** RLS is row-level. It "doesn't give you control over which columns" (CLS).
- **[D]** Column privileges (`revoke` then `grant select (cols)`) are possible, but break `select *` and writes for restricted roles. Supabase says "We do not recommend using column-level privileges for most users" and points to RLS plus separate tables (CLS).
- **[D]** Views bypass RLS unless created with `security_invoker = true` (PG15+) (RLS; PG CREATE VIEW).
- **[I]** Realtime cannot subscribe to a view, so views help only for reads.

### Recommendation [I]

Keep today's public/private split as **separate 1:1 tables**:

```sql
-- shape only, not a migration
create table lore (
  id uuid primary key,
  world_id uuid not null references worlds,
  name text,
  shared_with_players boolean not null default true,
  ...
);
create table lore_gm_details (
  lore_id uuid primary key references lore on delete cascade,
  gm_notes bytea,
  ...
);
-- same for npcs/npc_gm_details, locations/location_gm_details, sectors/sector_gm_notes
```

Policies:

- **`lore`:** read if `private.is_world_gm(world_id)`, or if `shared_with_players and private.can_view_world(world_id)`.
- **`lore_gm_details`:** read and write only if `private.is_world_gm((select world_id from lore where id = lore_id))`, wrapped in a security definer helper.
- **GM-only rolls and posts:** the same two-level pattern. Either a `gms_only` column enforced by RLS, or a GM-only channel row.

Why this shape:

- It is the CLS recommendation.
- It matches the existing listener split (`listenToLore*` vs `listenToLoreGMProperties`), so the stores keep their structure.
- It maps cleanly onto the `campaign:<id>:gm` topic.
- It keeps `select *` working for players.

### Notes (keep private-unless-shared) [I]

- One `notes` table with `owner_id`, `campaign_id` / `character_id`, `shared` and `order`.
- Read policy: `owner_id = (select auth.uid()) or (shared and private.is_campaign_member(campaign_id))`. Write is owner only for now.
- Content stays in a separate `note_content` table under the same policy (through the parent), so lists load without the Yjs bytes. Server-side shared editing is a separate spec item on the map.
- The campaign outline is a GM-only note: a `kind = 'outline'` row whose policy requires `private.is_campaign_gm`, or a `campaign_outlines` table.

### Membership

- `campaign_members(campaign_id, user_id, role check (role in ('gm','player')))`, with an index on `(user_id)` and a primary key of `(campaign_id, user_id)`. It replaces `CampaignDocument.users[]` and `gmIds[]`.
- `private.is_campaign_member(cid)` and `private.is_campaign_gm(cid)` are `security definer stable` functions with `search_path = ''`.
- Characters link to campaigns through a column rather than the `characters[]` array.

## 7. Firestore pattern to Supabase equivalent

| Today (Firestore) | Supabase equivalent | Notes and pitfalls |
| --- | --- | --- |
| `onSnapshot(query)` returning `Unsubscribe` | helper: open channel, buffer, `select` on SUBSCRIBED, merge; returns `() => supabase.removeChannel(ch)` | no initial snapshot; re-select on reconnect [I] |
| `docChanges()` added / modified / removed | `INSERT` / `UPDATE` / `DELETE` (`payload.new`/`payload.old`, or `record`/`old_record` in Broadcast) | `old` is primary key only unless `REPLICA IDENTITY FULL` [D] |
| `where(field, "==", v)` | `filter: 'field=eq.v'` (Postgres Changes), or topic choice (Broadcast) | AND only, `in` max 100 [D] |
| `where(arr, "array-contains", uid)` | membership table plus RLS | no array filter in Realtime [I] |
| `orderBy + limit` | initial `select … order … limit`; client-side insert and trim | Realtime has no order or limit [I] |
| single-doc listener | `filter: 'id=eq.<id>'`, or topic per row | |
| `private/details` subdoc | `*_gm_details` 1:1 table plus GM-only RLS plus `:gm` topic | avoid column privileges and views [D]/[I] |
| client-only `sharedWithPlayers` / `gmsOnly` / `shared` filters | RLS predicates | fixes current leaks [I] |
| `firestore.rules` `get()` lookups (`checkIsOwner`) | `security definer` helpers in a `private` schema | wrap in `(select …)`, index [D] |
| `request.resource.data.diff().affectedKeys().hasOnly([...])` (partial-update rules) | column-specific `grant update (cols)`, a `before update` trigger that rejects other changes, or an RPC function | RLS can't see which columns changed [I] |

## Self-hosted configuration notes

- **[D]** The tenant ID comes from the host name (`realtime-dev.supabase-realtime`). The seed uses `SELF_HOST_TENANT_NAME`, default `realtime-dev` (DC, RT seeds).
- **[D]** By default `DB_ENC_KEY` encrypts tenant secrets in `_realtime.tenants` with AES-128-ECB. `DB_ENC_KEY_GCM` (32 chars) plus `DB_ENC_WRITE_GCM=true` switch to AES-256-GCM (RT `ENVS.md`).
- **[I]** The Compose template should set the GCM pair from a Docker secret and not rely on the ECB default.
- **[D]** Postgres Changes reads the WAL by polling a logical replication slot. The seed sets `poll_interval_ms: 100` (RT seeds and migrations).
- **[I]** That polling adds about 100 ms of latency on top of normal delivery.
- **[I]** Pin the `supabase/realtime` image version (the stock compose uses `v2.148.3` today). Payload shapes and Replay have changed across versions.

## Gaps and open questions

- No primary source gives a minimum Realtime or supabase-js version for Realtime Authorization, apart from Replay (2.74.0+).
- No supported way is documented to keep `private_only` on self-hosted while `SEED_SELF_HOST=true`.
- Presence (for later typing indicators): the tenant has a `presence_enabled` field (default false) whose runtime effect I could not confirm. Test it on the self-hosted build before depending on it.
- Domain question for the human: who counts as a "world GM" once worlds attach to campaigns? Today it is world `ownerIds` plus `campaignGuides`. This decides `private.is_world_gm()` and whether a `world:<id>` topic is needed.
