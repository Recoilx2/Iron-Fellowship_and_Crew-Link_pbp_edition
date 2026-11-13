import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const notesFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_campaign_notes.sql")
  );
  assert.ok(files.length > 0, "no *_campaign_notes.sql migration");
  assert.equal(files.length, 1, "more than one *_campaign_notes.sql migration");
  return files[0];
};

const text = () => readFileSync(join(dir, notesFile()), "utf8");

describe("campaign notes migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(notesFile(), /^\d{14}_campaign_notes\.sql$/);
  });

  it("keeps campaign notes and their contents beside their campaign", () => {
    const sql = text();
    for (const table of ["campaign_notes", "campaign_note_contents"]) {
      assert.ok(
        new RegExp(`public\\.${table}`, "i").test(sql),
        `${table} is not in the public schema`
      );
      assert.ok(
        new RegExp(`${table}[\\s\\S]*?REFERENCES[\\s\\S]*?ON DELETE CASCADE`, "i").test(sql),
        `${table} does not follow its parent with ON DELETE CASCADE`
      );
    }
    assert.ok(/shared/i.test(sql), "notes have no shared flag to enforce");
    assert.ok(/content/i.test(sql), "note contents are not stored beside their note");
    assert.ok(/sort_order/i.test(sql), "notes have no sort order");
  });

  it("shows unshared notes to GMs only, and lets members write", () => {
    const sql = text();
    assert.ok(/ENABLE ROW LEVEL SECURITY/i.test(sql), "row-level security not enabled");
    assert.ok(
      /is_campaign_note_visible[\s\S]*?shared[\s\S]*?is_campaign_gm/i.test(sql),
      "the visibility helper does not keep unshared notes GM-only"
    );
    assert.ok(
      /FOR SELECT[\s\S]*?is_campaign_note_visible/i.test(sql),
      "SELECT does not go through the visibility helper"
    );
    assert.ok(
      /FOR SELECT[\s\S]*?is_campaign_member/i.test(sql),
      "SELECT is not restricted to campaign members"
    );
    for (const op of ["INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(`campaign_notes[\\s\\S]*?FOR ${op}\\b[\\s\\S]*?is_campaign_member`, "i").test(sql),
        `${op} on campaign notes is not restricted to members`
      );
    }
    assert.ok(!/\bTO\s+anon\b/i.test(sql), "signed-out readers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(sql), "everyone is granted access");
  });

  it("exposes security-definer campaign note helpers for the access rules", () => {
    const sql = text();
    for (const fn of ["is_campaign_note_visible", "is_campaign_note_writable"]) {
      assert.ok(
        new RegExp(`private\\.${fn}\\s*\\(`, "i").test(sql),
        `${fn} is not in the private schema`
      );
    }
    assert.ok(/SECURITY DEFINER/i.test(sql), "helpers are not security definer");
    assert.ok(
      /search_path\s*=\s*(''|"")/i.test(sql),
      "helpers do not pin an empty search path"
    );
  });

  it("publishes the tables for row streaming with old values", () => {
    const sql = text();
    assert.ok(
      /ALTER PUBLICATION\s+supabase_realtime\s+ADD TABLE/i.test(sql),
      "tables are not added to the supabase_realtime publication"
    );
    assert.ok(
      /pg_publication_tables/i.test(sql),
      "publication membership is not guarded for re-runs"
    );
    assert.ok(/REPLICA IDENTITY FULL/i.test(sql), "old row values are not published");
  });

  it("notifies the note server when sharing ends or a note is deleted", () => {
    const sql = text();
    assert.ok(/pg_notify/i.test(sql), "no pg_notify call");
    assert.ok(
      /note_access_revoked/i.test(sql),
      "no access-revoked notification channel"
    );
    assert.ok(
      /OLD\.shared\s+AND\s+NOT\s+NEW\.shared/i.test(sql),
      "unsharing is not what fires the notification"
    );
    for (const table of ["character_notes", "campaign_notes"]) {
      assert.ok(
        new RegExp(`ON\\s+public\\.${table}`, "i").test(sql),
        `no revoke trigger on ${table}`
      );
    }
  });
});
