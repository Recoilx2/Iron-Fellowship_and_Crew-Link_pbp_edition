import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const prefs = readFileSync(
  join(dir, "20261128000000_chat_email_prefs.sql"),
  "utf8"
);
const outbox = readFileSync(
  join(dir, "20261128000001_chat_post_email_outbox.sql"),
  "utf8"
);
const worker = readFileSync(join(dir, "..", "mailer", "worker.js"), "utf8");

describe("chat email preference and outbox migrations (#203)", () => {
  it("follows the migration naming convention", () => {
    assert.match(
      "20261128000000_chat_email_prefs.sql",
      /^\d{14}_chat_email_prefs\.sql$/
    );
    assert.match(
      "20261128000001_chat_post_email_outbox.sql",
      /^\d{14}_chat_post_email_outbox\.sql$/
    );
  });

  it("keeps both preferences owner-only, with no implicit channel opt-in", () => {
    assert.ok(
      /email_notifications_enabled boolean NOT NULL DEFAULT true/.test(prefs),
      "no global switch on user_settings"
    );
    assert.ok(
      /CREATE TABLE IF NOT EXISTS public\.chat_channel_email_prefs/.test(prefs),
      "no per-channel preference table"
    );
    assert.ok(
      /PRIMARY KEY \(user_id, channel_id\)/.test(prefs),
      "preferences are not one row per person and channel"
    );
    assert.ok(
      /ENABLE ROW LEVEL SECURITY/.test(prefs),
      "preference table has no row-level security"
    );
    for (const op of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(`FOR ${op} TO authenticated`).test(prefs),
        `no owner-only ${op} policy`
      );
    }
    assert.ok(
      (prefs.match(/user_id = \(select auth\.uid\(\)\)/g) ?? []).length >= 4,
      "policies do not all check the owner"
    );
    assert.ok(
      !/opted_in boolean NOT NULL DEFAULT true/.test(prefs),
      "channel preferences must not be pre-seeded as opted in"
    );
  });

  it("refactors the access helpers for an explicit reader without changing today's checks", () => {
    for (const name of [
      "is_campaign_member",
      "is_campaign_gm",
      "is_channel_member",
      "can_read_channel",
    ]) {
      assert.ok(
        prefs.includes(`private.${name}_as(`),
        `no explicit-reader helper for ${name}`
      );
      assert.ok(
        new RegExp(
          `CREATE OR REPLACE FUNCTION private\\.${name}\\(cid uuid\\)`
        ).test(prefs),
        `the old ${name} helper was not kept`
      );
    }
    assert.ok(
      prefs.includes("SELECT private.can_read_channel_as(cid, (select auth.uid()))"),
      "the old helper does not delegate the caller's identity"
    );
    assert.ok(
      prefs.includes("OR (ch.visibility = 'dm' AND private.is_channel_member_as(ch.id, uid))"),
      "a GM outside a DM could read it"
    );
    // The explicit-reader helper must keep the old one-argument helper's
    // meaning: membership gates every branch, not just public channels.
    assert.ok(
      /WHERE ch\.id = cid\s+AND private\.is_campaign_member_as\(ch\.campaign_id, uid\)\s+AND \(\s*\(ch\.visibility = 'public'\)/m.test(prefs),
      "campaign membership no longer gates every visibility branch"
    );
  });

  it("resolves only access-eligible candidates and exposes both preference flags", () => {
    assert.ok(
      prefs.includes("SECURITY DEFINER"),
      "candidate function cannot read auth.users or hidden rows"
    );
    assert.ok(prefs.includes("SET search_path = ''"), "candidate function has no pinned search path");
    for (const fragment of [
      "p.deleted_at IS NULL",
      "m.user_id <> p.author_id",
      "private.can_read_channel_as(ch.id, m.user_id)",
      "(NOT p.gms_only OR private.is_campaign_gm_as(ch.campaign_id, m.user_id))",
      "global_opt_in boolean",
      "channel_opt_in boolean",
    ]) {
      assert.ok(prefs.includes(fragment), `candidate function misses ${fragment}`);
    }
    assert.ok(
      /REVOKE ALL ON FUNCTION public\.chat_post_email_candidates\(uuid\) FROM PUBLIC/.test(prefs),
      "post text and addresses are exposed to every caller"
    );
    assert.ok(
      /FROM anon, authenticated/.test(prefs),
      "signed-in users can call the candidate function"
    );
  });

  it("queues one outbox row per candidate and notifies with an id alone", () => {
    assert.ok(
      /AFTER INSERT ON public\.chat_posts/.test(outbox),
      "no post insert trigger"
    );
    assert.ok(
      outbox.includes("public.chat_post_email_candidates(v_post_id)"),
      "the outbox does not use the access-checked candidate list"
    );
    // Both target columns must be supplied: one expression for two columns
    // is a Postgres error that made every post insert fail (PR #216 CI).
    assert.ok(
      /INSERT INTO public\.chat_post_email_outbox \(post_id, recipient_user_id\)\s+SELECT v_post_id, c\.recipient_user_id\s+FROM public\.chat_post_email_candidates\(v_post_id\) AS c/.test(outbox),
      "the outbox INSERT does not supply both post_id and recipient_user_id"
    );
    assert.ok(
      outbox.includes("ON CONFLICT (post_id, recipient_user_id) DO NOTHING"),
      "a reader could be queued twice"
    );
    assert.ok(
      /sending_at timestamptz NULL/.test(outbox),
      "no durable in-flight marker to prevent a repeat send"
    );
    assert.ok(
      outbox.includes("pg_notify('chat_post_email', v_post_id::text)"),
      "no notification to the worker"
    );
    assert.ok(
      /REVOKE ALL ON TABLE public\.chat_post_email_outbox FROM PUBLIC, anon, authenticated/.test(outbox),
      "the outbox is readable through the data API"
    );
    assert.ok(
      /attempts integer NOT NULL DEFAULT 0/.test(outbox) &&
        /next_attempt_at timestamptz NOT NULL DEFAULT now\(\)/.test(outbox),
      "no bounded retry state"
    );
  });
});

describe("mailer in-flight delivery (PR #216 fixes)", () => {
  it("claims a row durably before SMTP and excludes in-flight rows from polls", () => {
    assert.ok(
      /SET sending_at = now\(\)/.test(worker),
      "the row is not marked in flight at claim time"
    );
    assert.ok(
      worker.includes("AND q.sending_at IS NULL"),
      "the poll can claim a row that is already being sent"
    );
    assert.ok(
      /SET sent_at = now\(\), sending_at = NULL/.test(worker),
      "a successful send does not clear the in-flight marker"
    );
  });

  it("resets in-flight state on failure, keeps bounded retries and redacted logs", () => {
    assert.ok(
      /SET sending_at = NULL, attempts = \$2, next_attempt_at/.test(worker),
      "a failed send leaves the row stuck in flight"
    );
    assert.ok(
      /sent = true;[\s\S]*?sending_at IS NOT NULL/.test(worker),
      "a DB failure after SMTP send can clear the in-flight marker"
    );
    assert.ok(
      worker.includes("attempts < $1") && worker.includes("MAX_ATTEMPTS = 5"),
      "delivery attempts are unbounded"
    );
    assert.ok(
      worker.includes("redact(") && worker.includes("errorCode"),
      "errors are not redacted before logging"
    );
  });
});
