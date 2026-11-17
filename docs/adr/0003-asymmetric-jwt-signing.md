# Asymmetric JWT signing (RS256-3072) replaces the shared HS256 secret

Every access token in the stack was signed with one shared `JWT_SECRET`
(HS256), and every service that verifies a token held that same secret:
GoTrue (signing), PostgREST, Realtime, Storage, the note server, and the
GM assistant function. HS256 is not on the approved crypto list
(AES-256-GCM, Argon2id, RSA-3072+, Ed25519), and a secret shared with every
verifier means every service is a signing oracle: a leak anywhere forges
tokens for everything.

## Decision

The stack signs tokens asymmetrically (ticket #152): GoTrue holds one
RSA-3072 private key per copy and signs access tokens with RS256; every
verifier holds only the public JWKS. The shared `JWT_SECRET` is removed
from the template entirely: no service or function accepts an HS256-signed
token on any user-token path. One internal realtime endpoint (`/metrics`)
still demands an HS256 secret at boot — recorded below as an open gap, not
an accepted exception.

- **Key generation** (`bin/gen-env.py` + `bin/gen-keys.mjs`): node generates
  the RSA-3072 key pair (Python's standard library cannot). The private JWK
  is written to a GoTrue-only env file (`.env.<copy>.gotrue`) — the shared
  env file every container reads never contains it. The public JWKS goes
  into `JWT_JWKS` in the shared file (PostgREST, Realtime, the functions
  container, the note server). `ANON_KEY` and `SERVICE_ROLE_KEY` are minted
  as RS256 JWTs signed by the same key, so the gateway's exact-match
  `apikey` checks and every downstream verification keep working unchanged.
- **GoTrue** (`GOTRUE_JWT_KEYS`, delivered by its own env file, plus
  `GOTRUE_JWT_VALID_METHODS=RS256`): signs with the private JWK (its `kid`
  rides every token) and refuses every other algorithm on verification.
- **PostgREST** (`PGRST_JWT_SECRET`): accepts the JWKS JSON directly and
  selects keys by `kid`.
- **Realtime** (`API_JWT_JWKS`): the tenant's `jwt_jwks` verifies RS256 by
  `kid`. Two upstream quirks needed handling:
  - upstream's tenant seed forces the tenant's `jwt_secret` to a
    well-known constant when `API_JWT_SECRET` is unset — which would let
    anyone forge HS256 tenant tokens. `supabase/realtime/seeds.exs` (a
    forked copy, mounted over the image's at the pinned version's release
    path) seeds the tenant with `jwt_secret = nil`; the check constraint
    allows that when `jwt_jwks` is set, and realtime then rejects all
    HS256 tokens on the tenant and subscription paths.
  - realtime's own `/api` endpoints (health, tenant management) also
    authenticate with an HS256 token, signed with the app-level
    `API_JWT_SECRET`. The fix here is in the Realtime config, not the
    probe: this stack configures no such secret at all, so those
    endpoints refuse every caller (there is no valid token to present).
    The container health check, the smoke test and the CI wait steps all
    exec `realtime/healthcheck.sh`, which probes the unauthenticated
    `/healthcheck` route; depth is covered by the seed running before the
    server binds its port, the realtime-auth one-shot's own polling, and
    the live tests joining real channels with real RS256 tokens.
- **Storage** (`JWT_JWKS_STORAGE`): verifies user tokens against the public
  JWKS (RS256). Storage also signs its own short-lived object URLs
  (chat images, portraits, world images) with a URL-signing key — the
  platform's design allows only symmetric or EC keys there, and its default
  is HS512. That key is an HS512 oct key delivered to Storage only (in
  `JWT_JWKS_STORAGE`, never in the shared `JWT_JWKS`), so it can never
  verify a user token: with the shared JWKS absent from Storage's secret
  and the URL key's `alg` pinned to HS512, HS256 tokens are refused.
- **Functions and the note server**: the GM assistant function verifies
  the caller's token in code (WebCrypto, `RSASSA-PKCS1-v1_5`) against the
  public JWKS (`JWT_JWKS`), refusing any other algorithm; the note server
  does the same with node:crypto. Both refuse to start without the JWKS.
- **The gateway** (Envoy) only ever string-matched the `apikey` header, so
  it needs no change: the RS256-minted API keys are just longer strings.

## Alternatives considered

- **Ed25519 (EdDSA)**: also on the approved list and supported by GoTrue,
  Realtime and Storage, but PostgREST's documentation only demonstrates
  RSA JWKs and node's RSA tooling (key generation to JWK export to
  signing) is direct. RS256-3072 was chosen; nothing in the design prevents
  moving to Ed25519 later (a new key id in the JWKS per verifier).
- **Keeping HS256 during a transition window** (the hosted platform's
  hybrid mode): rejected. The spec allows signing everyone out once at the
  switch, so the template has no legacy secret to carry and no second
  verification path to maintain.
- **A JWKS endpoint instead of env distribution** (GoTrue serves
  `/.well-known/jwks.json`): the self-hosted verifiers read their key set
  from configuration, not from a URL, so the public JWKS is still
  distributed through the env file.
- **Bumping Realtime to close the metrics gap**: checked every release from
  the pinned v2.148.3 through v2.168.0 (the newest): `config/runtime.exs`
  still boots with `System.fetch_env!("METRICS_JWT_SECRET")` and the
  metrics pipeline still verifies HS256-only (`authorize(token, secret,
  nil)` — no JWKS argument). No released version makes the secret optional
  or accepts key-pair tokens there, so the pin stays and the gap stays
  tracked on ticket #152.

## Consequences

- Only GoTrue holds a private signing key — wired, not just documented: the
  private JWK lives in a GoTrue-only env file, and the shared env file every
  other container reads never carries it. A verifier compromise forges no
  tokens; a signing-key compromise is contained to GoTrue's env.
- **Open gap against "no service accepts an HS256-signed token"**: realtime's
  `/metrics` scrape endpoints still require an HS256 token signed with
  `METRICS_JWT_SECRET`. This is not accepted here as fine — it is a
  limitation of the pinned image, which refuses to boot without the secret
  (`System.fetch_env!/1` in `config/runtime.exs`) and verifies metrics
  tokens HS256-only (`check_auth` → `authorize_any` → `authorize(token,
  secret, nil)`: the JWKS argument is hardcoded nil). The same holds at the
  newest release (v2.168.0), so no version bump fixes it; the gap stays
  tracked on ticket #152. The exposure is bounded: the gateway never routes
  `/metrics`, so only containers on the compose network can reach it, and a
  metrics token grants metric reads, nothing else.
- Regenerating the key pair (`bin/gen-env.py`) signs everyone out once:
  sessions carry the old signature until they expire. Operators keep both
  env files (the main one and the GoTrue-only one) with their backups
  (README). `METRICS_JWT_SECRET` is still generated per copy: the pinned
  image does not boot without it.
- The realtime seed fork is coupled to the pinned realtime image's release
  path; `tests/template.test.mjs` fails when the image tag and the mount
  path drift apart.
- Storage's URL-signing key remains symmetric (HS512) because the platform
  only supports symmetric or EC keys there. It is scoped to Storage, never
  verifies a user token, and its tokens are short-lived. If the platform
  later allows RSA URL-signing keys, the exception can be retired.
