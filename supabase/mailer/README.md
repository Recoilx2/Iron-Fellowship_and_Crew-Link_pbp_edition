# Chat-post email mailer

One small Node container per stack copy. It turns the Postgres outbox written
by `20261128000001_chat_post_email_outbox.sql` into email through the
operator's existing `SMTP_*` settings, with a link straight to the post. No
host port is published and no token is needed: the worker connects to the
internal database as `postgres` and only reads the outbox and the
`chat_post_email_candidates` function.

## Configuration (environment)

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Internal Postgres connection URL (from the shared env file's password and host). |
| `EMAIL_NOTIFICATIONS_ENABLED` | Master switch. `false` (the default) keeps the container up as a no-op; `true` starts the listener and poll. |
| `MAILER_POLL_SECONDS` | Boot/poll interval in seconds, default 30. The `LISTEN chat_post_email` notification triggers an immediate poll too, so normal delivery is fast; the poll covers missed notifications and rows claimed by a worker that died. |
| `MAILER_MEMORY_LIMIT` | Compose container memory ceiling, default 128m. |
| `SITE_URL` | Public site origin used to build `${SITE_URL}/campaign/<campaign>?tab=chat&channel=<channel>&post=<post>`. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | The same mail server the stack uses for magic links. Blank user means no SMTP auth (a local test server). Port 465 selects implicit TLS; other ports use STARTTLS via nodemailer's defaults. |
| `SMTP_ADMIN_EMAIL` / `SMTP_SENDER_NAME` | From address and display name. |

## Behavior

- An AFTER INSERT trigger on `chat_posts` writes one outbox row per eligible
  reader and `pg_notify`s with the post id alone. No address, text or roll
  travels over the notification channel.
- Before sending, the worker re-runs `chat_post_email_candidates(post_id)` so
  a later opt-out, deleted post or roster change is honoured. It then applies
  the pure `shouldEmail` rule: global opt-out wins, a missing channel row
  means no email, the author is never mailed, and a player never receives
  GM-only content.
- `renderPostEmail` escapes every name, post value and link in the HTML body
  and leaves markdown to the app. It never renders GM-only words or a roll
  for a non-GM candidate.
- Delivery failures retry with backoff up to five attempts. After that the
  row is marked done with a redacted error. Logs contain only ids and error
  codes: no recipient address, post text, roll or SMTP credential.
- The pure preference/rendering tests run with plain `node --test
  supabase/mailer/render.test.mjs` (also part of CI's `static` job). The
  delivery path is covered by `emailNotifications.live.test.ts` against a
  fake SMTP server on the host; in CI the `live` job points the worker at it
  with `SMTP_HOST=host.docker.internal` and `LIVE_SMTP_CAPTURE_PORT=2525`.
