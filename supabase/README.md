# Self-hosted Supabase stack (one copy per game system)

This directory is the Compose template from spec #11: Postgres, sign-in
(magic links over your own mail server), the data API, live updates, file
storage, the API gateway and the server-functions runtime. Start it once per
game system. The two copies (Ironsworn, Starforged) are fully separate: their
own data, accounts, ports and volumes.

No Firebase or Google dependency remains. If you only want the app's
dev workflow, see `SETUP.md` at the repo root; this file is for operators.

## Files

| Path | What it is |
|---|---|
| `docker-compose.yml` | The template. No fixed container or project names; everything per-copy comes from the env file. |
| `.env.example` | Every variable the template uses, with blank secrets. Copy to `.env.ironsworn` / `.env.starforged` (git-ignored, never commit them) or generate them: `python3 bin/gen-env.py --copy ironsworn --port 8000`. |
| `bin/gen-env.py` | Generates a filled per-copy env file: random passwords/keys, an RSA-3072 signing key pair (node does the crypto; see `bin/gen-keys.mjs`), RS256-minted API keys, per-copy ports. |
| `envoy/` | Gateway config: static bootstrap, cluster table, and the route template rendered at boot. Studio/MCP/postgres-meta routes are removed (those services are dropped). |
| `db-init/` | First-boot database setup (roles, realtime schema, webhooks), vendored from upstream. Runs once per fresh volume. |
| `migrations/` | Your schema migrations; applied automatically on every start (see below). First schema: `profiles` (display names, owner-only access rules). |
| `migrate/apply.sh` | Applies `migrations/*.sql` in order, exactly once each. |
| `site/` | The site container: builds the site for the copy's `GAME_SYSTEM` (branding and theme baked in) and serves it. |
| `functions/` | Server functions for the Edge Runtime. Placeholder 404 until later tickets add real functions. |
| `studio.docker-compose.yml` | Optional add-on: the admin dashboard + its metadata service, started temporarily (see Admin). |
| `tests/smoke.sh` | Starts both copies side by side and checks every gateway plus both sites (each serving its own system's branding). Also runs in CI on every pull request. |

## Start and stop

Run everything from this directory. One copy:

```sh
cp .env.example .env.ironsworn   # then fill in every blank value
ENV_FILE=.env.ironsworn docker compose -p ironsworn --env-file .env.ironsworn up -d
```

Both copies side by side (different project, env file, secrets and port):

```sh
python3 bin/gen-env.py --copy starforged --port 8001 --out .env.starforged
ENV_FILE=.env.starforged docker compose -p starforged --env-file .env.starforged up -d
```

Check: `docker compose -p ironsworn ps`, gateway at `http://localhost:8000`
(Ironsworn) and `http://localhost:8001` (Starforged), site at
`http://localhost:8080` (Ironsworn) and `http://localhost:8081`
(Starforged). Stop one copy:
`ENV_FILE=.env.ironsworn docker compose -p ironsworn down` (volumes stay, so
data survives restarts and upgrades). The site image bakes in its game system
and branding, so after pulling site changes rebuild it:
`docker compose -p ironsworn --env-file .env.ironsworn build site`.

Mail server settings (`SMTP_*`), the site URL players return to (`SITE_URL`)
and the gateway's public URL live in the same env file; magic links are
constructed from `API_EXTERNAL_URL`, which must be reachable by players'
browsers. To sign in from a local dev server (`npm run dev`), add its origin
to `ADDITIONAL_REDIRECT_URLS` (e.g. `http://localhost:5173`) and restart.

## Secrets

Every secret comes from the uncommitted per-copy env files: Postgres password,
the JWT signing key pair (`GOTRUE_JWT_KEYS` holds the private half; GoTrue alone
signs with it) and the API keys minted from it, Storage's static secret,
the realtime GCM key and (for the dashboard add-on) the meta crypto key.
`.env.example` ships with all of them blank. Realtime encrypts its stored
secrets with AES-256-GCM (`DB_ENC_KEY_GCM` + `DB_ENC_WRITE_GCM=true`); the
legacy ECB key is not set, so ECB is never used. Rotate a secret by editing
the env file and restarting (`up -d` recreates what changed); regenerating
the JWT key pair signs everyone out once.

## Migrations

`migrations/*.sql` run automatically on every start, in filename order, each
exactly once (tracked in `supabase_migrations.applied`), before the data
services boot. A failed file aborts the run so services never boot on a
half-migrated database. Upgrading is pulling and restarting. Name files
`<UTC timestamp>_<short-name>.sql` and never edit one that has already run;
see `migrations/README.md`.

## Shared note editing

One Hocuspocus container per copy (`hocuspocus/`, reached through the
gateway at `/hocuspocus/`) holds the live Yjs documents for shared notes.
Each document is one content row beside its note; the server reads the row
on first connect and writes it back within seconds, so solo edits survive
restarts. Connections carry the person's Supabase access token and are
checked against that note; unsharing (or deleting) a note closes the
connections of everyone who just lost access. See `hocuspocus/README.md`.
Memory is capped with `HOCUSPOCUS_MEMORY_LIMIT` (default 256m).

## GM assistant model proxy

The GM assistant (spec #10) reaches the model through the `gm-assistant`
server function, which proxies to one operator-configured OpenAI-compatible
endpoint and streams the reply back. Browsers never see the key: the function
holds it server-side, talks to the database only with the caller's own
access token, and every failure the browser sees is a generic message plus a
reference code (the detail stays in the function logs, never with the key).
CORS answers only the copy's own `SITE_URL` origin, and the system prompt
names the copy's `GAME_SYSTEM`.

Configure it in the copy's env file (all four live beside the other
assistant settings in `.env.example`):

| Variable | What it is |
|---|---|
| `GM_ASSISTANT_ENDPOINT` | Base URL of the chat-completions API, e.g. `https://api.openai.com/v1`. Blank (the default) disables the assistant: it reports "not set up on this server". |
| `GM_ASSISTANT_API_KEY` | Server-side key, sent only to the endpoint. Never commit it, never log it. |
| `GM_ASSISTANT_ALLOWED_MODELS` | Optional comma-separated allow-list of model ids; blank means every model the endpoint lists. |
| `GM_ASSISTANT_CONTEXT_TOKENS` | Fallback context size for models whose listing reports none (OpenRouter reports `context_length` per model); blank means 8192. The settings screen uses these sizes for its too-big warning. |

After changing any of these, restart the copy (`up -d`) so the functions
container picks them up.

Examples:

- **OpenAI:** endpoint `https://api.openai.com/v1`, key `sk-...`, allow-list
  e.g. `gpt-4o-mini`.
- **OpenRouter:** endpoint `https://openrouter.ai/api/v1`, key `sk-or-v1-...`.
  Model ids are the OpenRouter slugs, and each model reports its own context
  size.
- **Local Ollama:** run `ollama serve` on the host and pull a model
  (`ollama pull llama3.1`), then set the endpoint to
  `http://host.docker.internal:11434/v1`; no key is needed (the proxy sends
  no credentials when the key is blank). Model ids are the Ollama names
  (`llama3.1`), and they use the fallback context size above because
  Ollama's model list reports none.

## Backup and restore

Back up one copy at a time (example: Ironsworn):

```sh
# Full database dump (schema, auth users, storage metadata, app data):
ENV_FILE=.env.ironsworn docker compose -p ironsworn exec -T db \
  pg_dump -U postgres postgres > ironsworn-$(date +%F).sql

# Uploaded files live in the named volume ironsworn_storage-data:
docker run --rm -v ironsworn_storage-data:/data -v "$PWD":/backup \
  alpine tar czf /backup/ironsworn-storage-$(date +%F).tgz -C /data .
```

Restore into a fresh copy (down first so nothing writes mid-restore):

```sh
ENV_FILE=.env.ironsworn docker compose -p ironsworn down
docker volume rm ironsworn_db-data ironsworn_storage-data
ENV_FILE=.env.ironsworn docker compose -p ironsworn up -d db
cat ironsworn-2026-11-12.sql | \
  ENV_FILE=.env.ironsworn docker compose -p ironsworn exec -T db \
  psql -U postgres postgres
docker run --rm -v ironsworn_storage-data:/data -v "$PWD":/backup \
  alpine tar xzf /backup/ironsworn-storage-2026-11-12.tgz -C /data
ENV_FILE=.env.ironsworn docker compose -p ironsworn up -d
```

Keep all three env files with the backup (the main one, the GoTrue-only
one, the Storage-only one): without the same private JWT signing
key (`GOTRUE_JWT_KEYS`, in the GoTrue-only file) old session tokens stop
verifying — a re-generated key pair signs everyone out once — and without
`REALTIME_DB_ENC_KEY_GCM` realtime cannot decrypt its stored secrets.

## Admin without the dashboard

The base stack has no admin UI. For SQL and user work, open `psql` on a copy:

```sh
ENV_FILE=.env.ironsworn docker compose -p ironsworn exec db psql -U postgres
```

For a visual UI, start the dashboard temporarily from the add-on file (needs
`PG_META_CRYPTO_KEY` set in the env file):

```sh
ENV_FILE=.env.ironsworn docker compose -p ironsworn --env-file .env.ironsworn \
  -f docker-compose.yml -f studio.docker-compose.yml up -d studio
# browse http://localhost:3000, then stop it again:
ENV_FILE=.env.ironsworn docker compose -p ironsworn --env-file .env.ironsworn \
  -f docker-compose.yml -f studio.docker-compose.yml stop studio meta
```

Use `STUDIO_HTTP_PORT=3001` in the second copy's env file so both dashboards
can run at once. Logs: `docker compose -p ironsworn logs -f <service>`.

## Resources

Planning budget is about 2 GB RAM per copy (two Postgres instances and two
realtime servers dominate), so ~4 GB for both with the functions memory
ceiling lowered to 512 MB (`FUNCTIONS_MEMORY_LIMIT`). Confirm on your host
with `docker stats --no-stream` idle and during a game session. Image layers
are shared, so the second copy downloads almost nothing extra.
