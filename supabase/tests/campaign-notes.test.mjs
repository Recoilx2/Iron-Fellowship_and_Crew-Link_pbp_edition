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

const baseText = () => readFileSync(join(dir, notesFile()), "utf8");

// Combined SQL of every migration, in apply order: #106's strict rules
// live in a later file (README: never edit an applied migration), so the
// #106 assertions below read the whole chain, while the base assertions
// above keep reading the base file they have always checked.
const text = () =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");

describe("campaign notes migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(notesFile(), /^\d{14}_campaign_notes\.sql$/);
  });

  it("keeps campaign notes and their contents beside their campaign", () => {
    const sql = baseText();
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
    const sql = baseText();
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
    const sql = baseText();
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
    const sql = baseText();
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
    const sql = baseText();
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

  it("tightens campaign note writes so writable implies visible (#106)", () => {
    const sql = text();
    // Every note records its author; the human decision on #106 allows any
    // backfill for existing rows, but new rows must name their author.
    assert.ok(/created_by/i.test(sql), "campaign notes record no author");
    // Contents stay writable exactly where they are readable: the
    // writable helper reuses the visibility helper in its own body.
    assert.ok(
      /private\.is_campaign_note_writable\(nid[^)]*\)[\s\S]{0,400}?is_campaign_note_visible/i.test(
        sql
      ),
      "the writable helper does not imply the visibility helper"
    );
    // Inserts name the signed-in person as the author.
    assert.ok(
      /campaign_notes_insert[\s\S]*?created_by[\s\S]*?auth\.uid\(\)/i.test(sql),
      "INSERT does not pin the author to the signed-in person"
    );
    // Row updates stay readable on both sides of the write; the guard
    // trigger below owns the field-level rules.
    assert.ok(
      /campaign_notes_update[\s\S]*?is_campaign_note_visible/i.test(sql),
      "UPDATE does not go through the visibility helper"
    );
    // campaign_id can never move a note to another campaign.
    assert.ok(
      /NEW\.campaign_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.campaign_id/i.test(sql),
      "campaign_id is not locked against moves"
    );
    // Only the author or a campaign GM flips shared.
    assert.ok(
      /NEW\.shared\s+IS\s+DISTINCT\s+FROM\s+OLD\.shared[\s\S]*?created_by[\s\S]*?is_campaign_gm/i.test(
        sql
      ),
      "shared flips are not restricted to the author or a GM"
    );
    // Deletes are author-or-GM only.
    assert.ok(
      /campaign_notes_delete[\s\S]*?created_by/i.test(sql),
      "DELETE is not restricted to the note author"
    );
    assert.ok(
      /campaign_notes_delete[\s\S]*?is_campaign_gm/i.test(sql),
      "DELETE does not still allow a campaign GM"
    );
  });

  it("cuts live access when campaign access is lost (#106)", () => {
    const sql = text();
    // Losing the roster row ends note access: removal deletes it, and a
    // GM-to-player demotion drops the unshared notes.
    assert.ok(
      /campaign_members_revoke_notify/i.test(sql),
      "no revoke trigger on campaign_members"
    );
    assert.ok(
      /OLD\.role\s*=\s*'gm'\s+AND\s+NEW\.role\s*=\s*'player'/i.test(sql),
      "demoting a GM to player fires no revocation"
    );
    // A character leaving its campaign ends its old campaign's access to
    // the character's notes (and re-checks the old campaign's notes).
    assert.ok(
      /characters_campaign_leave_notify/i.test(sql),
      "no revoke trigger on characters.campaign_id"
    );
    // Unlinking a world from a campaign ends the campaign GMs' world-note
    // access (per #12); deleting the campaign does the same.
    assert.ok(
      /campaigns_world_unlink_notify/i.test(sql),
      "no revoke trigger on campaigns.world_id"
    );
    assert.ok(
      /campaigns_delete_world_notify/i.test(sql),
      "deleting a campaign fires no world-note revocation"
    );
  });
});
