# Hocuspocus note server

One container per stack copy holding the live Yjs documents for shared note
editing. Each persistent document is one Postgres content row
(`character_note_contents` / `campaign_note_contents`, base64 bytes beside
each note): the server reads the row on first connect and writes it back on
a 2 s debounce (10 s at the latest), so a lone editor is persisted within
seconds and reloads survive restarts. World rooms are transient until the
worlds ticket ports them: they sync live but never touch the database.

## Configuration (environment)

| Variable | Meaning |
|---|---|
| `PORT` | Listen port (default 1234). Reached only through the gateway. |
| `JWT_SECRET` | The stack's HS256 secret: client access tokens are verified with it. |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_PASSWORD` | Database connection. Connects as `postgres` on the internal network; per-connection access checks reuse the same `private.*` visibility helpers the row-level security policies use. |

## Behavior

- No token, or a forged, expired, anon or service-role token: refused.
- No access to the note (unshared, outsider, deleted): refused.
- Reader without write access (a member viewing someone else's shared
  character note): connected read-only, edits are neither accepted nor synced.
- Unshare or delete: the database notifies `note_access_revoked`; the server
  re-checks every connected reader and closes the ones who lost access.
  Everyone else stays connected.

Health: any plain HTTP GET answers `200 Welcome to Hocuspocus!`; the smoke
test checks the gateway route with it.
