import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const privilegesFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_chat_storage_privileges.sql")
  );
  assert.ok(files.length > 0, "no *_chat_storage_privileges.sql migration");
  assert.equal(
    files.length,
    1,
    "more than one *_chat_storage_privileges.sql migration"
  );
  return files[0];
};

const text = () => readFileSync(join(dir, privilegesFile()), "utf8");

describe("chat storage privileges migration (#125 burn, #118 uploads)", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention on a later stamp", () => {
    assert.match(
      privilegesFile(),
      /^\d{14}_chat_storage_privileges\.sql$/
    );
    // Sorts after the migrations it fixes (the 20261119000000 GM-only pin
    // is the latest on the branch). Deliberately not "after everything":
    // the next migration must not break this file's test.
    assert.ok(
      privilegesFile().slice(0, 14) > "20261119000000",
      `${privilegesFile()} does not sort after the migrations it fixes`
    );
  });

  it("lets the invoker burn lock resolve the private helpers", () => {
    const sql = text();
    assert.ok(
      /GRANT\s+USAGE\s+ON\s+SCHEMA\s+private\s+TO\s+authenticated/i.test(sql),
      "no USAGE on schema private for authenticated"
    );
    assert.ok(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+private\.chat_stat_result\s*\(\s*integer\s*,\s*integer\s*,\s*integer\s*\)\s*TO\s+authenticated/i.test(
        sql
      ),
      "no EXECUTE on private.chat_stat_result for authenticated"
    );
  });

  it("qualifies the file path inside the own-post author branch", () => {
    const sql = text();
    assert.ok(
      /CREATE POLICY "chat_images_insert_members" ON storage\.objects/i.test(
        sql
      ),
      "the storage INSERT policy is not replaced here"
    );
    // Bare `name` inside the EXISTS would resolve to chat_channels.name
    // (the channel's display name) instead of the file path, so the
    // author branch could never match. Every path helper call in the
    // replacement policy names the policy target explicitly.
    assert.ok(
      /private\.chat_image_(post|campaign)\(\s*storage\.objects\.name\s*\)/.test(
        sql
      ),
      "the replacement policy does not qualify the file path"
    );
    assert.ok(
      !/private\.chat_image_(post|campaign)\(\s*name\s*\)/.test(sql),
      "a bare `name` still reaches a path helper and is shadowed by chat_channels.name"
    );
    assert.ok(
      /p\.author_id\s*=\s*\(select auth\.uid\(\)\)/i.test(sql),
      "the author branch no longer limits existing-post folders to their author"
    );
  });
});
