import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const portraitsFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_character_portraits.sql")
  );
  assert.ok(files.length > 0, "no *_character_portraits.sql migration");
  assert.equal(
    files.length,
    1,
    "more than one *_character_portraits.sql migration"
  );
  return files[0];
};

const text = () =>
  readFileSync(join(dir, portraitsFile()), "utf8");

describe("character portraits storage", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(portraitsFile(), /^\d{14}_character_portraits\.sql$/);
  });

  it("keeps portraits in a private bucket", () => {
    const sql = text();
    assert.ok(
      /INSERT\s+INTO\s+storage\.buckets/i.test(sql),
      "no storage bucket is created"
    );
    assert.ok(/portraits/.test(sql), "bucket is not named portraits");
    assert.ok(
      /public\s*,\s*false|public\s*=\s*false/i.test(sql),
      "portraits bucket is not private"
    );
  });

  it("lets only the owner write portraits, and members read them", () => {
    const sql = text();
    assert.ok(
      /CREATE POLICY/i.test(sql),
      "no storage access rules"
    );
    assert.ok(
      /storage\.objects/i.test(sql),
      "rules are not on storage.objects"
    );
    for (const op of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(`FOR ${op}\\b`, "i").test(sql),
        `no ${op} rule on the portraits bucket`
      );
    }
    assert.ok(
      /auth\.uid\(\)/i.test(sql),
      "rules do not check the signed-in person"
    );
    assert.ok(
      /is_campaign_member|characters/i.test(sql),
      "reads are not opened to the character's campaign members"
    );
    assert.ok(!/\bTO\s+anon\b/i.test(sql), "signed-out readers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(sql), "everyone is granted access");
  });
});
