# Smallest self-hosted Supabase stack

Research for issue #2 (part of the map in #1). Researched 2026-11-11.

**Question:** which self-hosted Supabase containers does this app need (magic-link sign-in, Postgres, live updates, image storage, the gateway, and possibly server functions for the GM assistant's AI proxy and homebrew invite keys)? Which can go? How much memory and CPU does the trimmed stack use, and can one host run two copies (one per game system)?

## Short answer

- **Keep 6 containers:** `db` (Postgres), `auth` (GoTrue), `rest` (PostgREST), `realtime`, `storage` and `api-gw` (Envoy).
- **Add a 7th for server code:** `functions` (Edge Runtime) for the LLM proxy. Homebrew invite keys don't need it, because they can be Postgres functions called through PostgREST.
- **Drop:** `studio`, `meta`, `imgproxy`, `supavisor`. Don't add the optional `analytics` (Logflare) and `vector` (log pipeline) overlay either.
- **Footprint:**
  - Supabase publishes no per-service memory figures. Its only official figure is a minimum of **4 GB RAM, 2 cores and 40 GB SSD** for *all* components.
  - The trimmed stack is a subset of that, so it needs less. How much less hasn't been measured (see "Footprint").
  - Measured fact: the trimmed images come to **about 1.25 GB compressed** to download, against about 2.17 GB for the full default set.
- **Two copies:** practical on a small home server or VPS. Nothing in the stack prevents it on resource grounds. The blockers are configuration:
  - the default compose file hard-codes container names and a project name
  - it publishes fixed host ports
  - it gives Edge Runtime a 2 GiB memory ceiling per copy

  The Compose template has to make these settable per copy.

## Sources

Primary sources only, unless marked otherwise:

- [S1] `docker/docker-compose.yml` in supabase/supabase, `master` at commit `189adda9` (2026-11-05): https://github.com/supabase/supabase/blob/189adda99d1b56da55fc5a6ee3f849354aaea92a/docker/docker-compose.yml
- [S2] `docker/README.md` in the same repo: https://github.com/supabase/supabase/blob/master/docker/README.md
- [S3] Self-Hosting with Docker guide: https://supabase.com/docs/guides/self-hosting/docker
- [S4] Self-hosted Edge Functions guide: https://supabase.com/docs/guides/self-hosting/self-hosted-functions
- [S5] `docker/docker-compose.logs.yml` (the Logflare and Vector overlay): https://github.com/supabase/supabase/blob/master/docker/docker-compose.logs.yml
- [S6] Envoy gateway config: `docker/volumes/api/envoy/lds.template.yaml` and `cds.yaml`: https://github.com/supabase/supabase/tree/master/docker/volumes/api/envoy
- [S7] `docker/.env.example`. Only non-secret defaults are quoted here: https://github.com/supabase/supabase/blob/master/docker/.env.example
- [S8] supabase/postgres pinned extension list, `nix/ext/versions.json`: https://github.com/supabase/postgres/blob/develop/nix/ext/versions.json
- [S9] Docker Hub tag API (`hub.docker.com/v2/repositories/<repo>/tags/<tag>`), compressed linux/amd64 image size for the exact tags pinned in [S1], queried 2026-11-11.
- [S10] `docker/CONFIG.md` (environment variable reference): https://github.com/supabase/supabase/blob/master/docker/CONFIG.md

## Changes in the official compose file worth knowing

- **Envoy is now the default gateway**, not Kong [S1, S2]. Kong is an optional override (`sh run.sh config add kong`) [S2]. The `api-gw` service answers to both the `envoy` and `kong` network aliases [S1].
- **Logs and analytics are off by default.** Logflare (`analytics`) and Vector moved to the `docker-compose.logs.yml` overlay [S5]. The docs say: "Logs & Analytics are not included in the default configuration to reduce the memory footprint" [S3]. So the base file already has 11 services, not 13.

## Each service

Sizes are compressed linux/amd64 image sizes from Docker Hub [S9]. They show download and disk cost, not memory.

| Service (container) | Image [S1] | What it does [S2, S3] | Needed here? | Size [S9] |
|---|---|---|---|---|
| `db` (supabase-db) | supabase/postgres:17.6.1.136 | Postgres, with Supabase's extensions and the roles the other services log in as | **Yes.** Everything stores data here. | 367 MB |
| `auth` (supabase-auth) | supabase/gotrue:v2.197.0 | Sign-up, sign-in and sessions using JWTs. Sends the auth emails over SMTP. | **Yes.** Magic links. It reads the `SMTP_*` settings [S1]. | 30 MB |
| `rest` (supabase-rest) | postgrest/postgrest:v14.18 | Turns the Postgres schema into a REST API, which `supabase-js` uses for queries and RPC | **Yes.** All reads and writes, plus calls to Postgres functions. Storage also depends on it (`POSTGREST_URL`, `depends_on: rest`) [S1]. | 6 MB |
| `realtime` (realtime-dev.supabase-realtime) | supabase/realtime:v2.148.3 | Elixir server that streams Postgres changes, broadcast and presence over websockets | **Yes.** Live chat and the app's listener-driven design. | 125 MB |
| `storage` (supabase-storage) | supabase/storage-api:v1.89.12 | File API with permissions checked in Postgres. Uses the local filesystem by default (`STORAGE_BACKEND: file`). | **Yes.** Chat images and portraits. | 257 MB |
| `api-gw` (supabase-envoy) | envoyproxy/envoy:v1.39.6 | Single entry point on port 8000. Routes `/auth/v1`, `/rest/v1`, `/realtime/v1`, `/storage/v1`, `/functions/v1`, `/pg/` and the Studio MCP paths [S6]. | **Yes.** The browser talks only to this. | 72 MB |
| `functions` (supabase-edge-functions) | supabase/edge-runtime:v1.77.9 | Deno server that runs TypeScript functions from `volumes/functions` | **Yes, for the LLM proxy** (or use an alternative, below) | 393 MB |
| `studio` (supabase-studio) | supabase/studio:2026.11.02-sha-a05e7ec | Admin dashboard (Next.js) | No. Admin convenience only. | 356 MB |
| `meta` (supabase-meta) | supabase/postgres-meta:v0.100.0 | REST API for managing Postgres. Studio uses it (`STUDIO_PG_META_URL`). | No. Only Studio needs it. | 114 MB |
| `imgproxy` (supabase-imgproxy) | darthsim/imgproxy:v4.0.21 | Resizes and converts images for Storage's transform endpoint | No. Optional resizing (see "Trade-offs"). | 89 MB |
| `supavisor` (supabase-pooler) | supabase/supavisor:2.9.13 | Postgres connection pooler. Publishes host ports 5432 and 6543. | No. The other services connect to `db` directly (`POSTGRES_HOST=db` [S7]). | 356 MB |
| `analytics` (overlay) | supabase/logflare:1.50.15 | Log management and analytics | No. Not in the base file. | 273 MB |
| `vector` (overlay) | timberio/vector:0.53.0-alpine | Log pipeline that feeds Logflare | No. Not in the base file. | 57 MB |

**Image totals (measured [S9]):**

| Set | Containers | Compressed size |
|---|---|---|
| Default base stack | 11 | ~2,165 MB |
| Trimmed core | 6 | ~857 MB |
| Trimmed core + `functions` | 7 | ~1,250 MB |
| Dropped containers | 4 | ~915 MB |

Two copies on one host that pin the same tags share their image layers, so the download happens once.

## How to drop the optional services

The docs allow removing services. The guide says: "If you don't need specific services, such as Realtime, Storage, imgproxy, or Edge Runtime (`functions`), you can remove the corresponding sections and dependencies from `docker-compose.yml` to reduce resource requirements" [S3]. It gives no guidance on removing Studio or Supavisor [S3], so the steps below come from reading [S1] and [S6].

- **Studio:** `api-gw` has `depends_on: studio: condition: service_healthy` [S1]. Delete that dependency, or the gateway won't start without Studio.
- **meta:** only Studio uses it (`STUDIO_PG_META_URL`). The gateway also routes `/pg/` to it [S6].
- **imgproxy:** `storage` has `depends_on: imgproxy`, `ENABLE_IMAGE_TRANSFORMATION: "true"` and `IMGPROXY_URL` [S1]. Delete the dependency and set transformation to `"false"`.
- **supavisor:** nothing depends on it [S1]. Dropping it also closes host ports 5432 and 6543. If the operator wants to reach Postgres from the host, publish a port on `db` (preferably bound to localhost).
- **Gateway routes to removed services:** Envoy declares `meta`, `studio` and `functions` as `STRICT_DNS` clusters [S6].
  - *Expected but not verified:* Envoy starts anyway and returns 503 on those routes.
  - It's cleaner for the template to remove those routes and clusters from its copy of the Envoy config.

## Footprint

**Documented facts:**

- **Full stack minimum:** "Minimum requirements for running all Supabase components, suitable for development and small to medium production workloads" [S3]:

  | | Minimum | Recommended |
  |---|---|---|
  | RAM | 4 GB | 8 GB+ |
  | CPU | 2 cores | 4 cores+ |
  | Disk | 40 GB SSD | 80 GB+ SSD |

- **Edge Runtime ceiling:** `functions` is the only service with a memory limit: `mem_limit: ${FUNCTIONS_MEMORY_LIMIT:-2g}` [S1], with `FUNCTIONS_MEMORY_LIMIT=2g` in `.env.example` [S7]. This is a ceiling, not a measurement.
- **Edge Runtime per-worker limit:** each function worker defaults to `memoryLimitMb` 256 MiB, set in `volumes/functions/main/index.ts` [S4].
- **No per-service figures:** Supabase publishes no memory or CPU figures per service, and none for a trimmed stack.

**Not measured:** this environment has no Docker, so the trimmed stack's idle and loaded memory hasn't been measured here.

**Estimates (unmeasured, for planning only):**

- The official 4 GB / 2-core minimum covers all components [S3]. The trimmed stack drops two Node.js services (Studio, meta), one Elixir service (Supavisor) and imgproxy, so one copy should fit well under 4 GB.
- **Planning budget: about 2 GB RAM per copy**, so 4 GB for two copies, with Edge Runtime's ceiling lowered (for example `FUNCTIONS_MEMORY_LIMIT=512m`).
- 2 cores is enough for a few play-by-post groups. The load is light and bursty.
- Confirm these by running `docker stats --no-stream` on a running trimmed stack, idle and with a few chat clients connected, before writing hardware guidance into the spec.
- *Community, not primary, unverified:* one VPS vendor guide reports about 2.5–3 GB resident for the *full* stack at idle, and names Studio and Logflare as the largest users. Treat this only as a sanity check.

## Server-side code: options for the LLM proxy and invite keys

| Option | Fits the LLM proxy? | Fits invite keys? | Cost |
|---|---|---|---|
| **Edge Runtime (`functions`)**, the official container | **Yes.** Deno `fetch` to the OpenAI-compatible endpoint can stream the response back. It can check the caller's JWT and GM role by querying Postgres as that user. The key comes from the container's environment or an uncommitted `.env.functions` file; container env vars reach the workers [S4]. | Yes, but overkill | Largest image (393 MB). 2 GiB default memory ceiling, which can be lowered. Already wired into the gateway at `/functions/v1/` [S6]. Note `FUNCTIONS_VERIFY_JWT=false` by default [S7], so each function must check the JWT itself, or the template must turn verification on. |
| **Postgres functions called through PostgREST** (`rpc/…`) | Poor fit. `http` (pgsql-http 1.6.1) and `pg_net` are in the supabase/postgres image [S8]. But `pg_net` is asynchronous, so the result has to be polled; neither streams tokens; and the API key would have to live in the database (Vault). | **Best fit.** A `security definer` function can create or redeem a key in one transaction, and row-level security gates who can call it. No extra container. | None |
| **A tiny separate proxy container** (for example a small Node, Go or Deno service behind Envoy) | **Yes.** It verifies the Supabase JWT, checks GM membership, adds the key and streams. | Possible, but SQL is simpler | Small image and low memory, but it's code we own and maintain. We'd add our own Envoy route and cluster. |

**Recommendation:**

- Put the invite keys and any other small, transactional server logic in **Postgres functions**.
- For the **LLM proxy**, start with **Edge Runtime**: it's first-party, already routed and already has Supabase clients. Set `FUNCTIONS_MEMORY_LIMIT` low in the template.
- If measurement shows Edge Runtime is the heaviest piece and that matters on the target host, swap in a tiny proxy container behind the same `/functions/v1/` route. The browser contract doesn't change.

## Running two copies on one host

Nothing in the trimmed stack is too heavy to run twice. These configuration points in the official file need fixing per copy [S1, S7]:

1. **Project name:** `name: supabase` is fixed. Override it per copy (`docker compose -p ironsworn …` or `COMPOSE_PROJECT_NAME`).
2. **Container names:** every service sets a fixed `container_name`, and container names must be unique on a host.
   - Remove them, or make them per copy.
   - Realtime's odd name (`realtime-dev.supabase-realtime`) matters only because Envoy uses it as the cluster address and sets it as the Host header (`host_rewrite_literal`). Realtime takes its tenant ID from that Host header [S1, S6].
   - Keep that hostname as a **network alias** on the realtime service. Each Compose project has its own network, so the aliases don't collide.
3. **Host ports:**
   - `api-gw` publishes `${API_GW_HTTP_PORT:-8000}`.
   - Supavisor publishes 5432 and 6543. That goes away once Supavisor is dropped.
   - Give each copy its own gateway port, or don't publish one and let a shared reverse proxy (which also does TLS) reach each gateway on the Docker network.
4. **Volumes:** these are relative bind mounts (`./volumes/...`) plus two named volumes, `db-config` and `deno-cache`. Named volumes are already prefixed with the project name. Bind mounts are separate as long as each copy runs from its own directory or uses its own volume path.
5. **Secrets:** each copy needs its own JWT secret, API keys, Postgres password and so on. Stacks are fully separate (ADR 0001).
6. **Memory:** two Postgres instances and two Realtime (BEAM) VMs is the real cost. With Edge Runtime's ceiling lowered, the estimated budget is about 4 GB for both (unmeasured, see "Footprint").

## Trade-offs of dropping things

- **No imgproxy:** Storage's on-the-fly resize endpoint stops working. Images are served as uploaded, so portraits and chat images should be downscaled in the browser before upload. Imgproxy can be added back later.
- **No Studio:** admin work (SQL, users, buckets) happens through migrations, `psql`, or by starting Studio and meta temporarily from an overlay file when needed.
- **No Supavisor:** fine at this scale. Each service keeps its own small connection pool to Postgres.
- **No Logflare or Vector:** use `docker compose logs`.

## Open questions

- **Measure the stack:** run `docker stats` on the trimmed stack, idle and under light chat load, to replace the estimates above before the spec quotes hardware figures.
- **Edge Runtime vs tiny proxy:** decide whether the LLM proxy stays on Edge Runtime or moves to a tiny proxy container, once the memory measurement is in.
- **Admin access:** agree on an admin story without Studio (temporary overlay vs `psql` only).
