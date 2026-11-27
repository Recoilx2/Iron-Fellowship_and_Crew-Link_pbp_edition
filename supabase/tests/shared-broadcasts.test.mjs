import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const sup = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(sup, "..");
const read = (p) => readFileSync(join(repo, p), "utf8");

const MIGRATION = "supabase/migrations/20261128000000_realtime_shared_broadcasts.sql";
const POLICIES = "supabase/realtime-auth/20261127200000_realtime_shared_broadcasts.sql";
const NEW_SQL = [MIGRATION, POLICIES];

describe("private broadcast shadow phase (#211)", () => {
  it("adds one new dated migration and one new realtime-auth policy file", () => {
    for (const file of NEW_SQL) {
      assert.match(file, /\/(\d{14})_[\w-]+\.sql$/);
      assert.ok(read(file).length > 0, `${file} is empty`);
    }
  });

  it("generalises the existing channel-member helper instead of duplicating it", () => {
    const sql = read(MIGRATION);
    assert.ok(
      /CREATE OR REPLACE FUNCTION private\.is_channel_member\(cid uuid, uid uuid\)/i.test(sql),
      "no two-argument is_channel_member helper"
    );
    assert.ok(
      /CREATE OR REPLACE FUNCTION private\.is_channel_member\(cid uuid\)[\s\S]{0,200}?private\.is_channel_member\(cid, \(select auth\.uid\(\)\)\)/i.test(sql),
      "the one-argument helper no longer delegates to the shared rule"
    );
    const occurrences = sql.match(/CREATE OR REPLACE FUNCTION private\.is_channel_member\(cid uuid\)/gi) ?? [];
    assert.equal(occurrences.length, 1, "duplicate one-argument helper");
  });

  it("publishes refresh on membership delete and role update", () => {
    const sql = read(MIGRATION);
    assert.ok(
      /CREATE TRIGGER realtime_refresh_on_campaign_membership\s+AFTER DELETE OR UPDATE OF role ON public\.campaign_members/i.test(sql),
      "no campaign membership delete/role-change refresh trigger"
    );
    assert.ok(
      /CREATE TRIGGER realtime_refresh_on_channel_membership\s+AFTER INSERT OR DELETE ON public\.chat_channel_members/i.test(sql),
      "no channel roster refresh trigger"
    );
    for (const family of [
      "campaign-shared:",
      "campaign-gm:",
      "channel-shared:",
    ]) {
      assert.ok(
        sql.includes(`'${family}`),
        `refresh publisher never names ${family}`
      );
    }
    assert.ok(
      /'refresh',\s*topic,\s*true/i.test(sql),
      "refresh is not published to a private topic"
    );
  });

  it("pins every table that broadcasts changes", () => {
    const sql = read(MIGRATION);
    for (const table of [
      "campaign_notes",
      "worlds",
      "world_locations",
      "world_lore",
      "world_npcs",
      "world_notes",
      "chat_channels",
      "chat_channel_members",
      "chat_posts",
      "assistant_conversations",
      "assistant_messages",
      "assistant_outline_versions",
    ]) {
      assert.ok(
        new RegExp(
          `CREATE TRIGGER realtime_broadcast_${table}\\s+AFTER INSERT OR UPDATE OR DELETE ON public\\.${table}`,
          "i"
        ).test(sql),
        `no broadcast trigger for ${table}`
      );
    }
    for (const table of [
      "world_location_gm_details",
      "world_npc_gm_details",
    ]) {
      assert.ok(
        new RegExp(
          `CREATE TRIGGER realtime_broadcast_${table}\\s+AFTER INSERT OR UPDATE OR DELETE ON public\\.${table}`,
          "i"
        ).test(sql),
        `no GM-only broadcast trigger for ${table}`
      );
    }
  });

  it("calls broadcast_changes from SECURITY DEFINER row triggers", () => {
    const sql = read(MIGRATION);
    const calls = sql.match(/realtime\.broadcast_changes\(/g) ?? [];
    assert.ok(calls.length >= 8, `only ${calls.length} broadcast_changes calls`);
    const definerFunctions = sql.match(/SECURITY DEFINER/g) ?? [];
    assert.ok(
      definerFunctions.length >= 10,
      "trigger helpers are not SECURITY DEFINER"
    );
    assert.ok(
      /TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD, TG_LEVEL/m.test(sql),
      "broadcast_changes is not called with the real row payload"
    );
  });

  it("never sends a GM-only DELETE on a shared topic", () => {
    const sql = read(MIGRATION);
    const gmOnly = sql.slice(
      sql.indexOf("FUNCTION private.broadcast_gm_only_change"),
      sql.indexOf("FUNCTION private.broadcast_chat_change")
    );
    assert.ok(gmOnly.length > 0, "no GM-only trigger function");
    assert.ok(
      /IF TG_OP = 'DELETE' THEN[\s\S]{0,280}?broadcast_realtime_key_delete\(\s*'campaign-gm:'/m.test(gmOnly),
      "GM-only DELETE is not key-only on campaign-gm"
    );
    assert.ok(
      !gmOnly.includes("campaign-shared:"),
      "the GM-only function names a shared topic"
    );
    assert.ok(
      /jsonb_build_object\(\s*'id', key_value/m.test(read(MIGRATION)),
      "the key-only delete payload is not keyed by id"
    );
  });

  it("broadcasts large note content as refresh only", () => {
    const sql = read(MIGRATION);
    for (const table of ["campaign_note_contents", "world_note_contents"]) {
      assert.ok(
        new RegExp(
          `CREATE TRIGGER realtime_refresh_\\w+\\s+AFTER INSERT OR UPDATE OR DELETE ON public\\.${table}`,
          "i"
        ).test(sql),
        `no refresh-only trigger for ${table}`
      );
    }
    const contentFn = sql.slice(
      sql.indexOf("FUNCTION private.broadcast_content_refresh"),
      sql.indexOf("-- One trigger per table")
    );
    assert.ok(!contentFn.includes("broadcast_changes("), "large content broadcasts rows");
    assert.ok(contentFn.includes("broadcast_realtime_refresh("), "large content sends no refresh");
  });

  it("pins the three membership-checked topic families and their RLS checks", () => {
    const sql = read(POLICIES);
    for (const topic of ["campaign-shared:", "campaign-gm:", "channel-shared:"]) {
      assert.ok(sql.includes(topic), `policy file misses ${topic}`);
    }
    assert.ok(
      /current_setting\('realtime\.topic', true\)/g.test(sql),
      "policies do not use the ADR 0002 topic setting"
    );
    assert.ok(
      sql.includes("private.is_campaign_member("),
      "shared topics are not campaign-member checked"
    );
    assert.ok(
      sql.includes("private.is_campaign_gm("),
      "GM topics are not GM checked"
    );
    assert.ok(
      sql.includes("private.is_channel_member("),
      "channel topics are not roster checked"
    );
    for (const name of [
      "realtime campaign shared topics readable by members",
      "realtime campaign gm topics readable by gms",
      "realtime channel shared topics readable by channel readers",
    ]) {
      assert.ok(
        sql.includes(`DROP POLICY IF EXISTS "${name}" ON realtime.messages;`),
        `${name} is not idempotent`
      );
      assert.ok(
        sql.includes(`CREATE POLICY "${name}"`),
        `${name} is not created`
      );
    }
  });

  it("keeps the owner-only prefixes and mirrors them into presence writes", () => {
    const sql = read(POLICIES);
    for (const prefix of [
      "user-%",
      "character%",
      "campaign:%",
      "campaign-notes%",
      "campaign-note-content%",
      "world%",
      "campaign-channels%",
      "campaign-channel-members%",
      "channel-posts%",
      "assistant-conversations%",
      "assistant-messages%",
      "assistant-outline-versions%",
      "homebrew%",
    ]) {
      assert.ok(sql.includes(`'${prefix}'`), `owner-only prefix ${prefix} lost`);
    }
    assert.ok(
      /CREATE POLICY "realtime app channels writable by signed-in listeners"[\s\S]*?FOR INSERT TO authenticated\s+WITH CHECK/m.test(sql),
      "no presence INSERT policy"
    );
    const insertPolicy = sql.slice(
      sql.indexOf("FOR INSERT TO authenticated"),
      sql.indexOf("COMMIT;")
    );
    for (const topic of ["campaign-shared:", "campaign-gm:", "channel-shared:"]) {
      assert.ok(insertPolicy.includes(topic), `presence policy misses ${topic}`);
    }
  });
});

describe("new SQL files are in every migration-order allowlist", () => {
  it("lists each new file in the allowlist of every ordering test", () => {
    const files = readdirSync(join(repo, "supabase", "tests")).filter((f) =>
      f.endsWith(".test.mjs")
    );
    const lists = files.filter((f) => {
      const text = read(`supabase/tests/${f}`);
      return text.includes("const landedLater = new Set([");
    });
    assert.ok(lists.length >= 9, `only ${lists.length} allowlists found`);
    for (const file of lists) {
      const text = read(`supabase/tests/${file}`);
      assert.ok(
        text.includes("20261128000000_realtime_shared_broadcasts.sql"),
        `${file} does not allow the new migration`
      );
    }
  });
});
