import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const worldsFile = () => {
  const files = readdirSync(dir).filter((f) => f.endsWith("_worlds.sql"));
  assert.ok(files.length > 0, "no *_worlds.sql migration");
  assert.equal(files.length, 1, "more than one *_worlds.sql migration");
  return files[0];
};

const text = () => readFileSync(join(dir, worldsFile()), "utf8");

describe("worlds migration", () => {
  it("follows the <UTC timestamp>_worlds.sql convention", () => {
    assert.match(worldsFile(), /^\d{14}_worlds\.sql$/);
  });

  it("keeps worlds and every world item in tables beside their world", () => {
    const sql = text();
    for (const table of [
      "worlds",
      "world_locations",
      "world_lore",
      "world_npcs",
      "world_notes",
      "world_note_contents",
    ]) {
      assert.ok(
        new RegExp(`public\\.${table}`, "i").test(sql),
        `${table} is not in the public schema`
      );
    }
    for (const [child, parent] of [
      ["world_locations", "worlds"],
      ["world_lore", "worlds"],
      ["world_npcs", "worlds"],
      ["world_location_gm_details", "world_locations"],
      ["world_npc_gm_details", "world_npcs"],
      ["world_notes", "worlds"],
      ["world_note_contents", "world_notes"],
    ]) {
      assert.ok(
        new RegExp(
          `${child}[\\s\\S]*?REFERENCES[\\s\\S]*?public\\.${parent}[\\s\\S]*?ON DELETE CASCADE`,
          "i"
        ).test(sql),
        `${child} does not follow ${parent} with ON DELETE CASCADE`
      );
    }
    assert.ok(
      /shared_with_players/i.test(sql),
      "world items have no shared_with_players flag to enforce"
    );
  });

  it("keeps GM-only details in separate tables readable only by world GMs", () => {
    const sql = text();
    for (const table of [
      "world_location_gm_details",
      "world_npc_gm_details",
    ]) {
      assert.ok(
        new RegExp(`public\\.${table}`, "i").test(sql),
        `${table} is not in the public schema`
      );
      assert.ok(
        new RegExp(
          `${table}[\\s\\S]*?REFERENCES[\\s\\S]*?ON DELETE CASCADE`,
          "i"
        ).test(sql),
        `${table} does not follow its item with ON DELETE CASCADE`
      );
      for (const op of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        assert.ok(
          new RegExp(
            `${table}[\\s\\S]*?FOR ${op}\\b[\\s\\S]*?is_world_gm`,
            "i"
          ).test(sql),
          `${op} on ${table} is not restricted to world GMs`
        );
      }
    }
    // Lore's only GM-only datum is its GM notes, held in world_notes with
    // gm_only=true (see the visibility helper below), so no extra table.
    assert.ok(
      /gm_only/i.test(sql),
      "world notes have no gm_only flag separating GM notes"
    );
  });

  it("grants world access to owners and campaign GMs through one helper", () => {
    const sql = text();
    assert.ok(
      /private\.is_world_gm\s*\(/i.test(sql),
      "private.is_world_gm is not defined"
    );
    assert.ok(/SECURITY DEFINER/i.test(sql), "helpers are not security definer");
    assert.ok(
      /search_path\s*=\s*(''|"")/i.test(sql),
      "helpers do not pin an empty search path"
    );
    assert.ok(
      /is_world_gm[\s\S]*?owner_ids/i.test(sql),
      "is_world_gm does not cover world owners"
    );
    assert.ok(
      /is_world_gm[\s\S]*?campaign_members[\s\S]*?gm/i.test(sql),
      "is_world_gm does not cover GMs of linked campaigns"
    );
    assert.ok(
      /private\.is_world_viewer\s*\(/i.test(sql),
      "private.is_world_viewer is not defined"
    );
  });

  it("shows players only shared items, and lets only world GMs write", () => {
    const sql = text();
    assert.ok(/ENABLE ROW LEVEL SECURITY/i.test(sql), "row-level security not enabled");
    for (const table of ["world_locations", "world_lore", "world_npcs"]) {
      assert.ok(
        new RegExp(
          `${table}[\\s\\S]*?FOR SELECT[\\s\\S]*?shared_with_players[\\s\\S]*?is_world_viewer`,
          "i"
        ).test(sql),
        `SELECT on ${table} does not limit players to shared items`
      );
      for (const op of ["INSERT", "UPDATE", "DELETE"]) {
        assert.ok(
          new RegExp(`${table}[\\s\\S]*?FOR ${op}\\b[\\s\\S]*?is_world_gm`, "i").test(
            sql
          ),
          `${op} on ${table} is not restricted to world GMs`
        );
      }
    }
    assert.ok(!/\bTO\s+anon\b/i.test(sql), "signed-out readers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(sql), "everyone is granted access");
  });

  it("hides GM notes from players and unshared notes from outsiders", () => {
    const sql = text();
    for (const fn of ["is_world_note_visible", "is_world_note_writable"]) {
      assert.ok(
        new RegExp(`private\\.${fn}\\s*\\(`, "i").test(sql),
        `${fn} is not in the private schema`
      );
    }
    assert.ok(
      /is_world_note_visible[\s\S]*?gm_only/i.test(sql),
      "the note visibility helper does not separate GM notes"
    );
    assert.ok(
      /is_world_note_visible[\s\S]*?shared_with_players/i.test(sql),
      "the note visibility helper does not check the parent item sharing flag"
    );
    assert.ok(
      /world_note_contents[\s\S]*?FOR SELECT[\s\S]*?is_world_note_visible/i.test(
        sql
      ),
      "SELECT on world_note_contents does not go through the visibility helper"
    );
  });

  it("lets world viewers toggle only their own characters' bonds", () => {
    const sql = text();
    assert.ok(
      /set_world_item_bond/i.test(sql),
      "no bond-setting function for players"
    );
    assert.ok(
      /set_world_item_bond[\s\S]*?is_world_viewer/i.test(sql),
      "the bond function does not check world membership"
    );
    assert.ok(
      /add_world_guide/i.test(sql) && /remove_world_guide/i.test(sql),
      "no guide-management functions for world owners"
    );
  });

  it("keeps ownership with current owners: GMs cannot mint themselves owners", () => {
    const sql = text();
    assert.ok(
      /reject_world_owner_change/i.test(sql),
      "no owner-change guard function on worlds"
    );
    assert.ok(
      /BEFORE UPDATE OF owner_ids[\s\S]*?ON public\.worlds/i.test(sql),
      "owner_ids changes on worlds are not guarded by a trigger"
    );
    assert.ok(
      /OLD\.owner_ids/i.test(sql),
      "the owner guard does not check the row's current owners"
    );
    const ownerGates = sql.match(/only world owners manage guides/gi) ?? [];
    assert.equal(
      ownerGates.length,
      2,
      "add/remove_world_guide are not both owners-only"
    );
  });

  it("links campaigns and characters to their world with safe deletes", () => {
    const sql = text();
    assert.ok(
      /campaigns[\s\S]*?world_id[\s\S]*?REFERENCES[\s\S]*?public\.worlds[\s\S]*?ON DELETE SET NULL/i.test(
        sql
      ),
      "campaigns.world_id does not reference worlds with ON DELETE SET NULL"
    );
    assert.ok(
      /characters[\s\S]*?world_id[\s\S]*?REFERENCES[\s\S]*?public\.worlds[\s\S]*?ON DELETE SET NULL/i.test(
        sql
      ),
      "characters.world_id does not reference worlds with ON DELETE SET NULL"
    );
    assert.ok(
      /CREATE INDEX[\s\S]*?campaigns[\s\S]*?\(world_id\)/i.test(sql),
      "campaigns are not indexed by world_id for the access checks"
    );
  });

  it("guards the world-images bucket by world membership", () => {
    const sql = text();
    assert.ok(/world-images/i.test(sql), "no world-images storage bucket");
    assert.ok(
      /storage\.objects[\s\S]*?world-images[\s\S]*?is_world_viewer/i.test(sql),
      "world image reads are not limited to world viewers"
    );
    assert.ok(
      /storage\.objects[\s\S]*?world-images[\s\S]*?is_world_gm/i.test(sql),
      "world image writes are not limited to world GMs"
    );
  });

  it("notifies the note server when sharing ends, and publishes rows live", () => {
    const sql = text();
    assert.ok(/pg_notify/i.test(sql), "no pg_notify call");
    assert.ok(
      /note_access_revoked/i.test(sql),
      "no access-revoked notification channel"
    );
    assert.ok(
      /OLD\.shared_with_players\s+AND\s+NOT\s+NEW\.shared_with_players/i.test(
        sql
      ),
      "unsharing is not what fires the notification"
    );
    assert.ok(
      /world-descriptions/i.test(sql),
      "world description revocation is not notified"
    );
    assert.ok(
      /ALTER PUBLICATION\s+supabase_realtime\s+ADD TABLE/i.test(sql),
      "tables are not added to the supabase_realtime publication"
    );
    assert.ok(/REPLICA IDENTITY FULL/i.test(sql), "old row values are not published");
  });
});
