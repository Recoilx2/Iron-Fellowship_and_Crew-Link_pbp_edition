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

// App roles must never reach the private schema: only SECURITY DEFINER
// functions cross that boundary. Strip comments so prose about grants
// cannot trip (or satisfy) the checks below.
const codeOf = (sql) =>
  sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const allMigrationCode = () =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => codeOf(readFileSync(join(dir, f), "utf8")))
    .join("\n");

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

  it("runs the roll lock as definer with a pinned search path", () => {
    const sql = text();
    const lock = sql.split(
      "CREATE OR REPLACE FUNCTION public.keep_chat_roll_immutable()"
    )[1];
    assert.ok(lock, "the roll lock is not replaced here");
    const head = lock.split("AS $$")[0];
    assert.ok(
      /SECURITY\s+DEFINER/i.test(head),
      "keep_chat_roll_immutable is not SECURITY DEFINER (the schema-USAGE boundary still blocks burns)"
    );
    assert.ok(
      /SET\s+search_path\s*=\s*(''|"")/i.test(head),
      "keep_chat_roll_immutable does not pin search_path"
    );
    assert.ok(
      /private\.chat_stat_result/i.test(lock),
      "the definer lock no longer rechecks the burn outcome"
    );
  });

  it("never grants the private schema to app roles", () => {
    const code = allMigrationCode();
    assert.ok(
      !/GRANT\s+[\w\s,]*USAGE[\s\S]*?ON\s+SCHEMA\s+private[\s\S]*?TO\s+(authenticated|anon|public)\b/i.test(
        code
      ),
      "a migration grants USAGE on schema private to an app role: only SECURITY DEFINER functions may reach into it"
    );
    assert.ok(
      !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+private\.[\w$]+\s*\([^)]*\)\s*TO\s+(authenticated|anon|public)\b/i.test(
        code
      ),
      "a migration grants EXECUTE on a private function to an app role: only SECURITY DEFINER functions may reach into it"
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
