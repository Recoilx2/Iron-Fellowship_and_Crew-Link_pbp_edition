import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const membersFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_campaign_members.sql")
  );
  assert.ok(files.length > 0, "no *_campaign_members.sql migration");
  assert.equal(files.length, 1, "more than one *_campaign_members.sql migration");
  return files[0];
};

describe("campaign members migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(membersFile(), /^\d{14}_campaign_members\.sql$/);
  });

  it("creates public.campaign_members with gm/player roles", () => {
    const text = readFileSync(join(dir, membersFile()), "utf8");
    assert.ok(/CREATE TABLE/i.test(text), "no CREATE TABLE");
    assert.ok(/public\.campaign_members/.test(text), "not in the public schema");
    assert.ok(/campaign_id/i.test(text), "no campaign column");
    assert.ok(/REFERENCES\s+auth\.users/i.test(text), "not keyed to auth.users");
    assert.ok(/ON DELETE CASCADE/i.test(text), "removed people keep rows behind");
    assert.ok(
      /role[^;]*IN\s*\(\s*'gm'\s*,\s*'player'\s*\)/i.test(text),
      "role is not restricted to gm/player"
    );
    assert.ok(
      /PRIMARY KEY\s*\(\s*campaign_id\s*,\s*user_id\s*\)/i.test(text),
      "no (campaign_id, user_id) primary key"
    );
    assert.ok(
      /CREATE\s+(UNIQUE\s+)?INDEX[\s\S]*?\(\s*user_id\s*\)/i.test(text),
      "no index on user_id"
    );
  });

  it("exposes security-definer membership helpers for later access rules", () => {
    const text = readFileSync(join(dir, membersFile()), "utf8");
    for (const fn of ["is_campaign_member", "is_campaign_gm"]) {
      assert.ok(
        new RegExp(`private\\.${fn}\\s*\\(`, "i").test(text),
        `${fn} is not in the private schema`
      );
    }
    assert.ok(/SECURITY DEFINER/i.test(text), "helpers are not security definer");
    assert.ok(
      /search_path\s*=\s*(''|"")/i.test(text),
      "helpers do not pin an empty search path"
    );
    assert.ok(
      /\(select auth\.uid\(\)\)/i.test(text),
      "helpers do not wrap auth.uid() as a subquery"
    );
    assert.ok(
      /role\s*=\s*'gm'/i.test(text),
      "no helper distinguishes the gm role"
    );
  });

  it("lets members see the roster and only GMs change it", () => {
    const text = readFileSync(join(dir, membersFile()), "utf8");
    assert.ok(
      /ENABLE ROW LEVEL SECURITY/i.test(text),
      "row-level security not enabled"
    );
    assert.ok(
      /FOR SELECT[\s\S]*?is_campaign_member/i.test(text),
      "SELECT is not restricted to campaign members"
    );
    for (const op of ["INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(`FOR ${op}[\\s\\S]*?is_campaign_gm`, "i").test(text),
        `${op} is not restricted to campaign GMs`
      );
    }
    assert.ok(!/\bTO\s+anon\b/i.test(text), "signed-out readers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(text), "everyone is granted access");
  });
});
