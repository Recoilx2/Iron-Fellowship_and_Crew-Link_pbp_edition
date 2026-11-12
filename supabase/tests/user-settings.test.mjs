import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const settingsFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_user_settings.sql")
  );
  assert.ok(files.length > 0, "no *_user_settings.sql migration");
  assert.equal(files.length, 1, "more than one *_user_settings.sql migration");
  return files[0];
};

describe("user settings migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(settingsFile(), /^\d{14}_user_settings\.sql$/);
  });

  it("keeps one settings row per person with both setting kinds", () => {
    const text = readFileSync(join(dir, settingsFile()), "utf8");
    assert.ok(/CREATE TABLE/i.test(text), "no CREATE TABLE");
    assert.ok(/public\.user_settings/.test(text), "not in the public schema");
    assert.ok(
      /user_id\s+uuid\s+PRIMARY KEY\s+REFERENCES\s+auth\.users/i.test(text),
      "not keyed one-to-one to auth.users"
    );
    assert.ok(/ON DELETE CASCADE/i.test(text), "orphan rows survive account deletion");
    assert.ok(/verbose_roll_results/i.test(text), "no accessibility column");
    assert.ok(/pinned_oracle_sections/i.test(text), "no oracle-settings column");
    assert.ok(/jsonb/i.test(text), "oracle settings are not schemaless JSON");
    assert.ok(/updated_at/i.test(text), "no updated_at for stale-event detection");
  });

  it("protects rows with owner-only access rules", () => {
    const text = readFileSync(join(dir, settingsFile()), "utf8");
    assert.ok(
      /ENABLE ROW LEVEL SECURITY/i.test(text),
      "row-level security not enabled"
    );
    for (const op of ["SELECT", "INSERT", "UPDATE"]) {
      assert.ok(
        new RegExp(
          `FOR ${op}\\b[\\s\\S]*?auth\\.uid\\(\\)\\s*=\\s*user_id|FOR ${op}\\b[\\s\\S]*?user_id\\s*=\\s*\\(select auth\\.uid\\(\\)\\)`,
          "i"
        ).test(text),
        `${op} is not restricted to the row owner`
      );
    }
    assert.ok(!/\bTO\s+anon\b/i.test(text), "signed-out readers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(text), "everyone is granted access");
  });

  it("streams owner-only rows over the shared live-update channel", () => {
    const text = readFileSync(join(dir, settingsFile()), "utf8");
    assert.ok(
      /ALTER PUBLICATION\s+supabase_realtime\s+ADD TABLE/i.test(text),
      "table is not added to the supabase_realtime publication"
    );
    assert.ok(
      /pg_publication_tables/i.test(text),
      "publication membership is not guarded for re-runs"
    );
    assert.ok(
      /REPLICA IDENTITY FULL/i.test(text),
      "old row values are not published"
    );
  });
});
