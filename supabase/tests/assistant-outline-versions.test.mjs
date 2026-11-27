import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// Outline revision history (ticket #133, part of spec #10): every Apply
// keeps the replaced outline text in a GM-only versions table with the
// same access rules as the outline, so the GM can Undo from the reply or
// the Outline tab. The assistant itself never writes: only the GM's Apply
// (and Undo) touch the outline and its versions.
const versionsFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_assistant_outline_versions.sql")
  );
  assert.ok(files.length > 0, "no *_assistant_outline_versions.sql migration");
  assert.equal(
    files.length,
    1,
    "more than one *_assistant_outline_versions.sql migration"
  );
  return files[0];
};

const text = () => readFileSync(join(dir, versionsFile()), "utf8");

describe("assistant outline versions migration (#133)", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention on a later stamp", () => {
    assert.match(
      versionsFile(),
      /^\d{14}_assistant_outline_versions\.sql$/
    );
    const stamp = versionsFile().slice(0, 14);
    // The #148 proposal state builds on this table and sorts later.
    const landedLater = new Set([
      "20261128000000_chat_email_prefs.sql",
      "20261128000001_chat_post_email_outbox.sql",
      "20261121000008_assistant_messages_applied_version_index.sql",
      "20261121000007_assistant_proposal_state.sql",
      "20261127000000_chat_post_search.sql",
    ]);
    const others = readdirSync(dir).filter(
      (f) =>
        /^\d{14}_/.test(f) && f !== versionsFile() && !landedLater.has(f)
    );
    assert.ok(others.length > 0, "no earlier migrations to sort after");
    for (const other of others) {
      assert.ok(
        stamp > other.slice(0, 14),
        `${versionsFile()} does not sort after ${other}`
      );
    }
  });

  it("keeps one row per saved version with non-blank content", () => {
    const sql = text();
    assert.ok(
      /CREATE TABLE IF NOT EXISTS public\.assistant_outline_versions/i.test(sql),
      "no assistant_outline_versions table is created"
    );
    assert.ok(
      /campaign_id[\s\S]*?REFERENCES public\.campaigns/i.test(sql),
      "versions do not belong to a campaign with cascade delete"
    );
    assert.ok(
      /CHECK[\s\S]*?char_length\(trim\(content\)\)\s*>\s*0/i.test(sql),
      "blank version content is not refused"
    );
  });

  it("restricts every version read and write to GMs of the campaign", () => {
    const sql = text();
    for (const op of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(
          `assistant_outline_versions[\\s\\S]*?FOR ${op}\\b[\\s\\S]*?private\\.is_campaign_gm`,
          "i"
        ).test(sql),
        `${op} on outline versions does not require GM membership`
      );
    }
  });

  it("exposes versions over the API and live updates like the outline", () => {
    const sql = text();
    assert.ok(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.assistant_outline_versions TO authenticated/i.test(
        sql
      ),
      "versions are not granted to authenticated callers"
    );
    assert.ok(
      /supabase_realtime[\s\S]*?assistant_outline_versions/i.test(sql),
      "versions are not added to the realtime publication"
    );
  });

  it("allows the versions live-update channel for signed-in listeners", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "realtime-auth");
    const files = readdirSync(dir)
      .filter((f) => /^\d{14}_realtime_assistant.*\.sql$/.test(f))
      .sort();
    assert.ok(files.length > 0, "no realtime assistant allowlist file");
    // The allowlist is replaced by the latest file in filename order, so
    // the latest one must name the versions channel family.
    const latest = readFileSync(join(dir, files.at(-1)), "utf8");
    assert.ok(
      /'assistant-outline-versions%'/.test(latest),
      "the realtime allowlist does not name assistant-outline-versions"
    );
  });
});
