# Setup

The app runs on self-hosted Supabase from one Docker Compose template. There
are two ways to run it: the stack (the real deployment, and what CI tests) and
the local dev server (fast UI iteration against a stack copy).

## Prerequisites

- Node v18 and npm v10 (`nvm install` in the project root picks the pinned
  versions from `.nvmrc`)
- Docker with the Compose plugin (for the stack)
- Python 3, stdlib only (for the env-file generator)

## Run the stack

Everything below runs from `supabase/`. Start one copy per game system
(Ironsworn, Starforged); each copy is fully separate, with its own data,
accounts, ports and volumes.

```sh
cd supabase
cp .env.example .env.ironsworn   # then fill in every blank value,
                                 # or generate a filled file:
python3 bin/gen-env.py --copy ironsworn --port 8000
ENV_FILE=.env.ironsworn docker compose -p ironsworn --env-file .env.ironsworn up -d
```

A second copy on the same machine needs its own project name, env file and
ports:

```sh
python3 bin/gen-env.py --copy starforged --port 8001 --out .env.starforged
ENV_FILE=.env.starforged docker compose -p starforged --env-file .env.starforged up -d
```

Check: `docker compose -p ironsworn ps`; gateway at `http://localhost:8000`
(Ironsworn) and `http://localhost:8001` (Starforged), site at
`http://localhost:8080` (Ironsworn) and `http://localhost:8081` (Starforged).
Stop one copy (`down` keeps the named volumes, so data survives restarts and
upgrades):

```sh
ENV_FILE=.env.ironsworn docker compose -p ironsworn down
```

### Mail, sign-in and upgrades

- Sign-in is email magic links through your own mail server: set the `SMTP_*`
  values, `SITE_URL` and `API_EXTERNAL_URL` in the per-copy env file. To sign
  in from a local dev server (`npm run dev`), add its origin (for example
  `http://localhost:5173`) to `ADDITIONAL_REDIRECT_URLS` and restart.
- Database migrations in `supabase/migrations/` apply automatically on every
  start, each exactly once. Upgrading is pulling and restarting.
- Backups, restore, and admin work without the dashboard are documented in
  `supabase/README.md` (Backup and restore, Admin without the dashboard).

## Develop the site locally

```sh
npm ci
npm run dev
```

The dev server needs the stack's URL and anon key, one copy at a time:

```sh
# .env.local (git-ignored, never commit)
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=<that copy's ANON_KEY from supabase/.env.ironsworn>
```

The deployed site container bakes in its game system at build time; in local
development no system is configured, so switch systems from the settings menu
("Switch System").

## Verify

- `npm test` — unit and component tests (behavior tests skip without a stack)
- `npm run lint` — no backend imports outside the data layer
- `npx tsc --noEmit` — type check
- `npm run build` — production build of the site
- `supabase/tests/smoke.sh` — both stack copies side by side (needs Docker;
  also runs in CI on every pull request)

With that, you should be all set up and ready to develop locally!
