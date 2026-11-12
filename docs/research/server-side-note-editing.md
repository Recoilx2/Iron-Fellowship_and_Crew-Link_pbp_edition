# Persisting Yjs note documents in self-hosted Supabase

Researched 2026-11-11. Every **Fact** has a cited source. Each **Inference** is my own reasoning and has no source.

## Question

What is the simplest way to persist Yjs documents in a self-hosted Supabase (Docker Compose) stack so that collaborative note editing works with only one person online and survives reloads? Recommend one option.

## Short answer

Add one small Node container that runs **Hocuspocus v4** with `@hocuspocus/extension-database`. Its `fetch` and `store` hooks read and write one `bytea` row per Yjs document in the stack's Postgres. Its `onAuthenticate` hook verifies the Supabase JWT and checks the user's access to that one document name. The server holds the authoritative doc and stores it on a debounce, so a lone editor is persisted without needing a peer. Access control stays per document, which matches the app's model. The Supabase Realtime options either need clients to write the merged state themselves or depend on an unmaintained alpha provider.

## Current app (repo code)

- **Fact:** The editor uses Tiptap 2, yjs 13 and y-webrtc 10 (repo code: `package.json`, `src/components/shared/RichTextEditor/RtcRichTextEditor.tsx`).
- **Fact:** It signals through `wss://y-webrtc-signalling-server.onrender.com` with a room `password`. See lines 84-85 of `RtcRichTextEditor.tsx` (repo code).
- **Fact:** It saves `Y.encodeStateAsUpdate(doc)` on a 30 s debounce, on unmount, and through a keepalive fetch on `visibilitychange`. It loads with `Y.applyUpdate` (repo code: `RtcRichTextEditor.tsx` lines 49, 71, 125, 140, 151).
- **Fact:** `@hocuspocus/transformer` is used only to extract a title through `TiptapTransformer.fromYdoc` (repo code: `RtcRichTextEditor.tsx` line 174).
- **Fact:** Note content is stored separately from note metadata (repo code: `src/api-calls/notes/`).
- **Fact:** Access control is per Yjs document. Notes are private unless `shared` is set. World lore, NPC and location entries have a public notes doc and a separate owner-only GM notes doc, each edited as its own Yjs room (repo code: `firestore.rules` `public/{notes}` and `private/{gmNotes}` matches; `roomPrefix` values ending `-gmnotes-` in `src/components/features/worlds/`).
- **Inference:** Today every browser is a full replica that writes whole snapshots. Two offline-diverged clients can overwrite each other's snapshot. The last writer wins at the storage layer, even though Yjs would merge the edits.

## Options

### A. Hocuspocus server + database extension (Postgres `bytea`)

- **Fact:** Hocuspocus is MIT-licensed. The repo had 2,649 stars and its latest push was on 2026-11-11 (https://api.github.com/repos/ueberdosis/hocuspocus).
- **Fact:** `@hocuspocus/server`, `@hocuspocus/provider` and `@hocuspocus/extension-database` are all at **4.8.0**, published 2026-10-28, under MIT (https://registry.npmjs.org/@hocuspocus/server, https://registry.npmjs.org/@hocuspocus/provider, https://registry.npmjs.org/@hocuspocus/extension-database).
- **Fact:** v4 requires Node.js 22 or later (https://tiptap.dev/docs/hocuspocus/getting-started/upgrade; `engines.node >=22` in https://registry.npmjs.org/@hocuspocus/server/latest).
- **Fact:** The wire protocol is backward compatible between v3 and v4 in both directions (https://tiptap.dev/docs/hocuspocus/getting-started/upgrade).
- **Fact:** There is **no** official `@hocuspocus/extension-postgres`. The registry returns "Not found" (https://registry.npmjs.org/@hocuspocus/extension-postgres).
- **Fact:** The official packages are database, logger, redis, s3, sqlite, throttle and webhook, plus server, provider, provider-react, transformer, common and cli (https://github.com/ueberdosis/hocuspocus/tree/main/packages).
- **Fact:** The database extension takes a `fetch` that returns a Yjs-compatible `Uint8Array` (or null) and a `store` that persists the binary state. The docs warn: "return the same Uint8Array that was saved in store(), and do not create a new Ydoc". They also say Postgres works if you return a Promise (https://tiptap.dev/docs/hocuspocus/server/extensions/database).
- **Fact:** `debounce` defaults to 2000 ms and "Debounces the call of the onStoreDocument hook". `maxDebounce` defaults to 10000 ms and "Makes sure to call onStoreDocument at least in the given amount of time" (https://tiptap.dev/docs/hocuspocus/server/configuration).
- **Fact:** `onAuthenticate` receives `token`, `documentName`, `requestHeaders` and `connection`. "Throwing an exception or rejecting the Promise will terminate the connection." Setting `data.connection.readOnly = true` means "changes will not be accepted and synced to other clients". A returned object becomes context for later hooks (https://tiptap.dev/docs/hocuspocus/server/hooks).
- **Fact:** The provider's `token` option "works with strings, functions and Promises". Several providers can share one socket through `websocketProvider` (https://tiptap.dev/docs/hocuspocus/provider/configuration).
- **Fact:** `@hocuspocus/provider` 4.8.0 has no Tiptap peer dependency (only `yjs ^13.6.8` and `y-protocols`).
- **Fact:** Tiptap 2's `@tiptap/extension-collaboration` (latest 2.x: 2.27.3, 2026-09-04) depends on `y-prosemirror`, not on any provider. Tiptap 3's version (3.33.1, 2026-11-10) peers on `@tiptap/y-tiptap` (https://registry.npmjs.org/@hocuspocus/provider, https://registry.npmjs.org/@tiptap/extension-collaboration).
- **Fact:** `@hocuspocus/transformer` 4.8.0 peers on `@tiptap/core ^3.0.1` (https://registry.npmjs.org/@hocuspocus/transformer/latest).
- **Inference:** A v4 provider works with the app's Tiptap 2 `Collaboration` extension because it passes `provider.document`. The client-side transformer must stay on 2.x until Tiptap 3, or the server could extract the title.
- **Inference:** Here is the auth plan. The client passes its Supabase access token as `token`. `onAuthenticate` verifies it with the stack's JWT secret or JWKS, then queries Postgres (or PostgREST with the user's JWT, so RLS decides) to check access to `documentName`. It throws on denial and sets `readOnly` for view-only shares. GM-only docs are just other document names.
- **Gap:** Memory or footprint figures are not documented on the overview page (https://tiptap.dev/docs/hocuspocus/getting-started/overview).
- **Inference:** One Node 22 process holding a few dozen small notes should use tens of MB. Measure it rather than trust this estimate.

### B. Supabase Realtime Broadcast + Postgres table (y-supabase or a custom provider)

- **Fact:** Broadcast relays client messages to subscribers. "By default, broadcast messages are only sent to other clients" (https://supabase.com/docs/guides/realtime/broadcast).
- **Fact:** Only Broadcast-from-Database messages are stored in `realtime.messages` and can be replayed. They are deleted after 3 days, and replay is limited to 25 messages (https://supabase.com/docs/guides/realtime/broadcast).
- **Fact:** Private channels are authorised by RLS policies on `realtime.messages`, using `realtime.topic()` and `extension = 'broadcast'`. Clients set `config.private: true`. "Client access policies are cached for the duration of the connection" (https://supabase.com/docs/guides/realtime/authorization).
- **Fact:** Disabling "Allow public access" rejects non-private joins with `PrivateOnly` (https://supabase.com/docs/guides/realtime/settings).
- **Fact:** For self-hosting, a Supabase maintainer said in January 2025 that you can set the tenant's `private_only` flag in the `_realtime` schema (https://github.com/orgs/supabase/discussions/22484). The self-hosting guide does not cover the feature (https://supabase.com/docs/guides/self-hosting/docker).
- **Fact:** The self-hosted Compose file ships `supabase/realtime:v2.148.3` (https://raw.githubusercontent.com/supabase/supabase/master/docker/docker-compose.yml).
- **Fact:** Hosted Broadcast payload limits are 256 KB on Free and 3,000 KB on Pro. "All limits are configurable per project" (https://supabase.com/docs/guides/realtime/limits). Settings include "Max payload size in KB"; oversized broadcasts are dropped (https://supabase.com/docs/guides/realtime/settings).
- **Fact:** `y-supabase` latest is `0.0.4-7-alpha`, published 2023-02-07 (https://registry.npmjs.org/y-supabase). The repo's last push was 2023-08-17, with 141 stars (https://api.github.com/repos/AlexDunmow/y-supabase). The README says it is "not recommended to use this in a production environment" (https://github.com/AlexDunmow/y-supabase).
- **Fact:** `y-supabase` opens the channel with no `private` option. On every local change, with no debounce, it writes the full `encodeStateAsUpdate` as a number array through `.update()` (https://raw.githubusercontent.com/AlexDunmow/y-supabase/main/src/index.ts).
- **Inference:** No server holds the doc, so each client merges and writes state itself. Concurrent writers race, as they do today. Avoiding this needs an append-only updates table plus client-side compaction with `Y.mergeUpdates`.
- **Fact:** `Y.mergeUpdates` "doesn't garbage-collect deleted content", so "You still need to load the document to a Y.Doc to reduce the document size" (https://docs.yjs.dev/api/document-updates).
- **Inference:** It adds no container. However, you would write and own the provider, the RLS on both `realtime.messages` and the updates table, and the compaction. Tuning the self-hosted private-only setting is also lightly documented.

### C. y-websocket server (`@y/websocket-server`)

- **Fact:** `@y/websocket-server` latest is 0.1.5, published 2026-02-18. It depends on `yjs ^14.0.0-7`, a pre-release; yjs `latest` is 13.6.33 (https://registry.npmjs.org/@y/websocket-server, https://registry.npmjs.org/yjs).
- **Fact:** The repo's last push was 2026-04-17, with 56 stars (https://api.github.com/repos/yjs/y-websocket-server).
- **Fact:** The README presents it as a development server or starting point. It keeps docs in memory by default, persists only through a custom `setPersistence({bindState, writeState})`, and has no built-in auth. For production it recommends YHub, Hocuspocus or another provider (https://raw.githubusercontent.com/yjs/y-websocket-server/main/README.md).
- **Fact:** `y-leveldb` is at 0.2.0, published 2025-04-23 (https://registry.npmjs.org/y-leveldb). `y-postgresql` is at 1.0.1, published 2025-05-29, with 30 stars (https://registry.npmjs.org/y-postgresql, https://api.github.com/repos/MaxNoetzold/y-postgresql).
- **Inference:** It costs the same one container as Hocuspocus, but you would hand-write auth and read-only handling, and the yjs major version is in flux. Option A dominates it.

### D. No live server: y-webrtc plus Postgres snapshots, optionally y-indexeddb

- **Fact:** y-webrtc 10.3.0 was published 2023-12-28 (https://registry.npmjs.org/y-webrtc). It syncs only between connected peers, and its password encrypts signalling traffic (https://raw.githubusercontent.com/yjs/y-webrtc/master/README.md).
- **Fact:** y-indexeddb 9.0.12 was published 2023-11-02 (https://registry.npmjs.org/y-indexeddb). It persists updates in the browser's IndexedDB (https://raw.githubusercontent.com/yjs/yjs/main/README.md).
- **Inference:** It works with one person online and survives a reload, as today, by saving a snapshot through PostgREST under RLS.
- **Inference:** It keeps the snapshot race and the 30 s loss window, and it relies on a third-party signalling server (or adds a signalling container anyway). It also makes clients the only writers of truth. y-indexeddb helps reload survival only on the same device.

## Comparison

| | A. Hocuspocus | B. Realtime + table | C. y-websocket | D. y-webrtc + snapshots |
|---|---|---|---|---|
| One person online | Yes; server stores on 2 s / 10 s max debounce | Yes, if the client writes state | Yes, with custom persistence | Yes (client snapshot) |
| Survives reload | Yes (server-side `bytea`) | Yes, if writes are not lost or raced | Yes, with custom persistence | Yes, but up to 30 s loss and races |
| Per-doc access | `onAuthenticate` + `readOnly` per document | RLS on `realtime.messages` + table; private-only setup self-hosted | Hand-written | RLS on snapshot row; live room only password-gated |
| Extra containers | 1 Node 22 | 0 | 1 Node | 0, or 1 signalling |
| Maintenance (2026-11-11) | 4.8.0, 2026-10-28; active | Realtime active; y-supabase alpha, 2023 | 0.1.5, 2026-02; dev-server status | y-webrtc 2023 |

## Recommendation

**Option A: Hocuspocus v4 plus `@hocuspocus/extension-database` writing one `bytea` row per document.**

- **Inference:** It is the only option where a server holds the merged doc and persists it on a short debounce (facts in A). That fixes single-user persistence and the snapshot race together.
- **Inference:** Its auth model matches the app's per-document access, and GM-only docs need no special case.
- **Inference:** The cost is one small container per stack, with about 50 lines of `fetch`/`store`/`onAuthenticate` code against the existing Postgres.
- **Inference:** Keep Tiptap 2 for now. Swap y-webrtc for `@hocuspocus/provider` and keep transformer 2.x, or upgrade Tiptap 3 separately.

## Open questions

1. How do we verify the JWT? This depends on whether the stack signs with the shared HS256 secret or asymmetric keys. The secret must come from the stack's secret store, not the repo.
2. Should access checks query Postgres directly with a service role, or go through PostgREST with the user's JWT so RLS stays the single source of truth? Access is cached per connection, so we also need to decide how to revoke access live when `shared` is turned off.
3. Where does the title live? We could extract it server-side in `onStoreDocument`, which needs the Tiptap 3 transformer or manual XML parsing, or keep extracting it on the client.
4. The Hocuspocus memory footprint is undocumented, so measure it.
5. Does Supavisor or a direct DB connection suit a long-lived Node pool better?
6. Should y-indexeddb be added for offline edits? It is optional and orthogonal.

## Sources

- https://tiptap.dev/docs/hocuspocus/server/extensions/database
- https://tiptap.dev/docs/hocuspocus/server/configuration
- https://tiptap.dev/docs/hocuspocus/server/hooks
- https://tiptap.dev/docs/hocuspocus/provider/configuration
- https://tiptap.dev/docs/hocuspocus/getting-started/upgrade
- https://tiptap.dev/docs/hocuspocus/getting-started/overview
- https://github.com/ueberdosis/hocuspocus/tree/main/packages
- https://api.github.com/repos/ueberdosis/hocuspocus
- https://registry.npmjs.org/@hocuspocus/server
- https://registry.npmjs.org/@hocuspocus/provider
- https://registry.npmjs.org/@hocuspocus/extension-database
- https://registry.npmjs.org/@hocuspocus/extension-postgres
- https://registry.npmjs.org/@hocuspocus/transformer/latest
- https://registry.npmjs.org/@tiptap/extension-collaboration
- https://supabase.com/docs/guides/realtime/broadcast
- https://supabase.com/docs/guides/realtime/authorization
- https://supabase.com/docs/guides/realtime/settings
- https://supabase.com/docs/guides/realtime/limits
- https://supabase.com/docs/guides/self-hosting/docker
- https://github.com/orgs/supabase/discussions/22484
- https://raw.githubusercontent.com/supabase/supabase/master/docker/docker-compose.yml
- https://github.com/AlexDunmow/y-supabase
- https://raw.githubusercontent.com/AlexDunmow/y-supabase/main/src/index.ts
- https://api.github.com/repos/AlexDunmow/y-supabase
- https://registry.npmjs.org/y-supabase
- https://raw.githubusercontent.com/yjs/y-websocket-server/main/README.md
- https://api.github.com/repos/yjs/y-websocket-server
- https://registry.npmjs.org/@y/websocket-server
- https://registry.npmjs.org/y-leveldb
- https://registry.npmjs.org/y-postgresql
- https://api.github.com/repos/MaxNoetzold/y-postgresql
- https://raw.githubusercontent.com/yjs/y-webrtc/master/README.md
- https://registry.npmjs.org/y-webrtc
- https://registry.npmjs.org/y-indexeddb
- https://registry.npmjs.org/yjs
- https://raw.githubusercontent.com/yjs/yjs/main/README.md
- https://docs.yjs.dev/api/document-updates
