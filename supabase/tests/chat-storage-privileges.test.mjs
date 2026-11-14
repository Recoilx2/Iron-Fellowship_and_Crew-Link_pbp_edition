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

  it("keeps every later redefinition of the roll lock a definer", () => {
    // 20261121000000 restated keep_chat_roll_immutable with its active-
    // character checks but without SECURITY DEFINER, so this file's test
    // above stayed green while live burns failed with `permission denied
    // for schema private` (run 43595627045). Every definition at or after
    // the definer fix (20261120000000, f6675771) must carry SECURITY
    // DEFINER with a pinned empty search path; earlier definitions predate
    // the rule and are exempt by name, as is 20261121000000 itself, the
    // regressed file this repair supersedes: migrations are never edited,
    // so the bad definition stays in history and filename order (this
    // repair sorts later) decides the live outcome. Any future file that
    // restates the lock without DEFINER fails here. Follows the
    // landedLater allowlist convention.
    const exemptBeforeDefiner = new Set([
      "20261113170000_chat_rolls.sql",
      "20261115000000_chat_roll_cleanup.sql",
      "20261116000000_chat_momentum_burn.sql",
      "20261118000000_chat_momentum_burn_hardening.sql",
      "20261119000000_chat_momentum_burn_gms_pin.sql",
      "20261121000000_campaign_active_character.sql",
    ]);
    const headsIn = (sql) => {
      const re =
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.keep_chat_roll_immutable\(\)([\s\S]*?)AS\s*\$\$/gi;
      return [...codeOf(sql).matchAll(re)].map((m) => m[1]);
    };
    const bad = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => headsIn(readFileSync(join(dir, f), "utf8")).length > 0)
      .filter((f) => !exemptBeforeDefiner.has(f))
      .filter((f) =>
        headsIn(readFileSync(join(dir, f), "utf8")).some(
          (head) =>
            !/SECURITY\s+DEFINER/i.test(head) ||
            !/SET\s+search_path\s*=\s*(''|"")/i.test(head)
        )
      );
    assert.deepEqual(
      bad,
      [],
      `roll lock redefined without SECURITY DEFINER (burns lose private-schema access): ${bad.join(", ")}`
    );
    // The repair sorts after the regressed file, so filename order alone
    // decides the live outcome.
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter(
        (f) =>
          headsIn(readFileSync(join(dir, f), "utf8")).length > 0 &&
          !exemptBeforeDefiner.has(f)
      )
      .sort();
    assert.ok(
      defining.length > 0,
      "no non-exempt keep_chat_roll_immutable definition remains"
    );
    assert.ok(
      defining.at(-1) > "20261121000000_campaign_active_character.sql",
      `latest definer restatement ${defining.at(-1)} does not sort after the regressed file`
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
