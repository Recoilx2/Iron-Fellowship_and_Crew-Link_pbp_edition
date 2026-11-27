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
verifier holds only the public JWKS; the shared `JWT_SECRET` is removed
from the template entirely; and the two HS256 verifiers the pinned images
mandate at boot are closed by configuration and a one-file patch (below).
No service or function accepts an HS256-signed token.

- **Key generation** (`bin/gen-env.py` + `bin/gen-keys.mjs`): node generates
  the RSA-3072 key pair (Python's standard library cannot). The private JWK
  is written to a GoTrue-only env file (`.env.<copy>.gotrue`) — the shared
  env file every container reads never contains it. The public JWKS goes
  into `JWT_JWKS` in the shared file (PostgREST, Realtime, Storage, the
  functions container, the note server). `ANON_KEY` and `SERVICE_ROLE_KEY`
  are minted as RS256 JWTs signed by the same key, so the gateway's
  exact-match `apikey` checks and every downstream verification keep
  working unchanged.
- **GoTrue** (`GOTRUE_JWT_KEYS`, delivered by its own env file, plus
  `GOTRUE_JWT_VALID_METHODS=RS256`): signs with the private JWK (its `kid`
  rides every token) and refuses every other algorithm on verification —
  golang-jwt rejects a disallowed `alg` before any key lookup, so the
  secret fallback is unreachable. The pinned image also refuses to *boot*
  without `GOTRUE_JWT_SECRET` even when keys are set, so a random value
  rides along in the GoTrue-only file; it is never consulted.
- **PostgREST** (`PGRST_JWT_SECRET`): accepts the JWKS JSON directly and
  selects keys by `kid`.
- **Realtime** (`API_JWT_JWKS`): the tenant's `jwt_jwks` verifies RS256 by
  `kid`. Two upstream quirks needed handling, both fixed by forking the
  image's own files (mounted read-only at the pinned version's paths, and
  version-guarded by `tests/template.test.mjs`):
  - upstream's tenant seed forces the tenant's `jwt_secret` to a
    well-known constant when `API_JWT_SECRET` is unset — which would let
    anyone forge HS256 tenant tokens. `supabase/realtime/seeds.exs` (a
    forked copy) seeds the tenant with `jwt_secret = nil`; the check
    constraint allows that when `jwt_jwks` is set, and realtime then
    rejects all HS256 tokens on the tenant and subscription paths.
  - realtime's `/api` endpoints (health, tenant management) and `/metrics`
    endpoints authenticate with HS256 tokens signed with app-level secrets
    (`API_JWT_SECRET` / `METRICS_JWT_SECRET`), both boot-mandated by
    upstream's `config/runtime.exs`. `supabase/realtime/runtime.exs` (a
    forked copy) sets the metrics secret to an empty list and the stack
    configures no API secret at all: `check_auth` wraps each value with
    `List.wrap()`, and an empty list refuses every caller without
    verifying anything. There is no valid token to present on either
    route family. The container healthcheck, the smoke test and the CI
    wait steps exec `realtime/healthcheck.sh`, which probes the
    unauthenticated `/healthcheck` route; depth is covered by the seed
    running before the server binds its port, the realtime-auth one-shot's
    own polling, the smoke test's tenant checks, and the live tests
    joining real channels with real RS256 tokens.
- **Storage** (`JWT_JWKS` + a patched verifier): verifies user tokens
  against the public JWKS (RS256). The pinned image's verifier would still
  accept HS256 tokens against a boot-mandated static secret
  (`AUTH_JWT_SECRET`), and its `signJWT` would still mint them, so
  `supabase/storage/jwt.js` — a patched build of the image's own
  `dist/internal/auth/jwt.js` (built by the repo's own `build.js` with its
  lockfile-pinned esbuild), mounted read-only over the image's copy —
  refuses HMAC tokens outright, refuses tokens with no matching key, fails
  closed when no keys are configured, and refuses HMAC *signing* too: the
  stack mints no HS256 tokens. The static secret keeps one job: satisfying
  the boot-time config check. It lives in a Storage-only env file.
- **The app loads images with the viewer's token, not signed URLs**
  (`src/api-calls`): chat attachments, character portraits and world
  images are fetched with `download()` (the viewer's RS256 token, so the
  bucket's access rules stay the only gate) and handed to the interface as
  object URLs; the stores revoke a URL when they replace or drop it. The
  signed-URL flow is retired: its tokens are HMAC-signed, and the patched
  verifier refuses both minting and verifying them.
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
- **Upstream's own hybrid self-hosted design**: upstream's asymmetric-keys
  guide ships `JWT_JWKS` with "the EC public key … and the legacy
  `JWT_SECRET` as a symmetric JWK", so every service keeps verifying
  HS256. Rejected: it keeps the shared-secret property this decision
  closes.
- **A JWKS endpoint instead of env distribution** (GoTrue serves
  `/.well-known/jwks.json`): the self-hosted verifiers read their key set
  from configuration, not from a URL, so the public JWKS is still
  distributed through the env file.
- **Bumping images instead of forking their files**: checked the newest
  releases — Realtime v2.168.0 (metrics: `System.fetch_env!` +
  HS256-only verification with the JWKS argument hardcoded nil) and
  Storage v1.96.2 (config load throws without the static secret; the HS256
  fallback is unchanged). No released version closes either hold-out by
  configuration, so the forks stay until upstream changes.

## Consequences

- Only GoTrue holds a private signing key — wired, not just documented: the
  private JWK lives in a GoTrue-only env file, and the shared env file every
  other container reads never carries it. A verifier compromise forges no
  tokens; a signing-key compromise is contained to GoTrue's env.
- Storage's static secret and Realtime's (unset) metrics secret live in
  service-only env files or nowhere; no HS256 secret is shared across
  services.
- Regenerating the key pair (`bin/gen-env.py`) signs everyone out once:
  sessions carry the old signature until they expire. Operators keep all
  three env files (the main one and the two service-only ones) with their
  backups (README).
- The realtime and storage forks are coupled to the pinned images' file
  layouts; `tests/template.test.mjs` fails when an image tag and a mount
  path (or a built file's version marker) drift apart.
- The browser's object URLs are short-lived in the interface: a member whose
  access is revoked stops seeing an image by its next reload, and the
  replaced bytes are freed by revocation.
