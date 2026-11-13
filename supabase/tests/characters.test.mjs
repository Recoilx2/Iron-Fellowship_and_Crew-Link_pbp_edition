import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const charactersFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_characters.sql")
  );
  assert.ok(files.length > 0, "no *_characters.sql migration");
  assert.equal(files.length, 1, "more than one *_characters.sql migration");
  return files[0];
};

const text = () => readFileSync(join(dir, charactersFile()), "utf8");

// Follow-up migrations keep the base file's name; read the whole chain so
// the asserted rules are the ones a fresh database ends up with.
const charactersChain = () => {
  const files = readdirSync(dir)
    .filter((f) => /characters.*\.sql$/.test(f))
    .sort();
  assert.ok(files.length > 0, "no characters migrations");
  return files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
};

describe("characters migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(charactersFile(), /^\d{14}_characters\.sql$/);
  });

  it("creates public.characters owned by one person with campaign and world links", () => {
    const sql = text();
    assert.ok(/CREATE TABLE/i.test(sql), "no CREATE TABLE");
    assert.ok(/public\.characters/.test(sql), "not in the public schema");
    assert.ok(
      /owner_id\s+uuid\s+NOT NULL\s+REFERENCES\s+auth\.users/i.test(sql),
      "characters are not keyed to auth.users"
    );
    assert.ok(/ON DELETE CASCADE/i.test(sql), "orphan rows survive account deletion");
    assert.ok(/campaign_id\s+uuid/i.test(sql), "no campaign link column");
    assert.ok(/world_id\s+uuid/i.test(sql), "no world link column");
    assert.ok(/stats\s+jsonb/i.test(sql), "no stats column");
    assert.ok(/condition_meters\s+jsonb/i.test(sql), "no condition meters column");
    assert.ok(/momentum\s+integer/i.test(sql), "no momentum column");
    assert.ok(/profile_image\s+jsonb/i.test(sql), "no portrait metadata column");
    assert.ok(/updated_at/i.test(sql), "no updated_at for stale-event detection");
  });

  it("lets the owner and campaign members read, and only the owner write", () => {
    const sql = text();
    assert.ok(/ENABLE ROW LEVEL SECURITY/i.test(sql), "row-level security not enabled");
    assert.ok(
      /FOR SELECT[\s\S]*?is_character_visible|FOR SELECT[\s\S]*?is_campaign_member/i.test(sql),
      "SELECT is not restricted to the owner and campaign members"
    );
    for (const op of ["INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(`FOR ${op}\\b[\\s\\S]*?owner_id\\s*=\\s*\\(select auth\\.uid\\(\\)\\)`, "i").test(sql) ||
          new RegExp(`FOR ${op}\\b[\\s\\S]*?is_character_owner`, "i").test(sql),
        `${op} is not restricted to the row owner`
      );
    }
    assert.ok(!/\bTO\s+anon\b/i.test(sql), "signed-out readers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(sql), "everyone is granted access");
  });

  it("exposes security-definer character helpers for the child tables", () => {
    const sql = text();
    for (const fn of ["is_character_owner", "is_character_visible"]) {
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
    assert.ok(
      /\(select auth\.uid\(\)\)/i.test(sql),
      "helpers do not wrap auth.uid() as a subquery"
    );
  });

  it("keeps assets, tracks, notes, settings and the solo roll log beside their character", () => {
    const sql = text();
    for (const table of [
      "character_assets",
      "character_tracks",
      "character_notes",
      "character_note_contents",
      "character_settings",
      "character_rolls",
    ]) {
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
  });

  it("streams owner-visible rows over the shared live-update channel", () => {
    const sql = text();
    assert.ok(
      /ALTER PUBLICATION\s+supabase_realtime\s+ADD TABLE/i.test(sql),
      "tables are not added to the supabase_realtime publication"
    );
    assert.ok(
      /pg_publication_tables/i.test(sql),
      "publication membership is not guarded for re-runs"
    );
    assert.ok(
      /REPLICA IDENTITY FULL/i.test(sql),
      "old row values are not published"
    );
  });

  it("rejects a second character from the same player in one campaign", () => {
    const sql = charactersChain();
    assert.ok(
      /CREATE\s+UNIQUE\s+INDEX[\s\S]*?\(\s*owner_id\s*,\s*campaign_id\s*\)[\s\S]*?WHERE\s+campaign_id\s+IS\s+NOT\s+NULL/i.test(
        sql
      ),
      "no partial unique index on (owner_id, campaign_id); a player can add two characters to one campaign"
    );
  });
});
