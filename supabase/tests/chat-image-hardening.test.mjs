import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = join(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(testsDir, "..", "migrations");
const repoDir = join(testsDir, "..", "..");
const readRepo = (p) => readFileSync(join(repoDir, p), "utf8");

// The #118 hardening lands as its own migration: existing migrations are
// never edited, and it sorts after every migration on the branch (later
// than the 20261116000000 momentum-burn edit trigger it replaces), so
// filename order alone decides the outcome.
const hardeningFile = () => {
  const files = readdirSync(migrationsDir).filter((f) =>
    f.endsWith("_chat_image_hardening.sql")
  );
  assert.ok(files.length > 0, "no *_chat_image_hardening.sql migration");
  assert.equal(files.length, 1, "more than one *_chat_image_hardening.sql migration");
  return files[0];
};

const sql = () => readFileSync(join(migrationsDir, hardeningFile()), "utf8");

describe("chat image hardening migration (#118 points 1-3)", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention on a later stamp", () => {
    assert.match(hardeningFile(), /^\d{14}_chat_image_hardening\.sql$/);
    const stamp = hardeningFile().slice(0, 14);
    assert.ok(
      stamp > "20261116000000",
      `${hardeningFile()} does not sort after the momentum-burn edit trigger`
    );
    // The #125 burn hardening (20261118000000) lands after #118 by design,
    // so it is excluded here.
    const landedLater = new Set([
      "20261118000000_chat_momentum_burn_hardening.sql",
    ]);
    const others = readdirSync(migrationsDir).filter(
      (f) => /^\d{14}_/.test(f) && f !== hardeningFile() && !landedLater.has(f)
    );
    for (const other of others) {
      assert.ok(
        stamp > other.slice(0, 14),
        `${hardeningFile()} does not sort after ${other}`
      );
    }
  });

  it("locks image_paths on edit, except when a delete clears it", () => {
    const text = sql();
    assert.ok(
      /NEW\.image_paths\s+IS DISTINCT FROM\s+OLD\.image_paths/i.test(text),
      "edits do not pin image_paths"
    );
    assert.ok(
      /NEW\.image_paths\s*:?=\s*'\{\}'/i.test(text),
      "a soft delete does not clear the image paths"
    );
  });

  it("refuses storage overwrites of files that belong to a sent post", () => {
    const text = sql();
    assert.ok(
      /FOR UPDATE[\s\S]*?storage\.objects/i.test(text),
      "no storage UPDATE rule"
    );
    assert.ok(
      /image_paths/i.test(text),
      "the UPDATE rule is not bound to attached image paths"
    );
    assert.ok(
      /owner\s*=\s*\(select auth\.uid\(\)\)/i.test(text),
      "overwrites are not restricted to the uploader"
    );
  });

  it("limits uploads to a new post's folder or the uploader's own post", () => {
    const text = sql();
    assert.ok(
      /FOR INSERT[\s\S]*?storage\.objects/i.test(text),
      "no storage INSERT rule"
    );
    assert.ok(
      /author_id\s*=\s*\(select auth\.uid\(\)\)/i.test(text),
      "uploads into an existing post's folder are not limited to its author"
    );
    assert.ok(
      /NOT\s+private\.chat_post_exists\s*\(/i.test(text),
      "uploads into a not-yet-posted folder are not allowed"
    );
    assert.ok(
      /CREATE OR REPLACE FUNCTION private\.chat_post_exists[\s\S]{0,300}?SECURITY DEFINER/i.test(
        text
      ),
      "the no-post check does not see every row (row visibility would reopen hidden folders)"
    );
  });

  it("drives the bucket cap from the one deployment setting on every start", () => {
    const apply = readRepo("supabase/migrate/apply.sh");
    assert.ok(
      /CHAT_IMAGE_MAX_MB/.test(apply),
      "apply.sh does not read CHAT_IMAGE_MAX_MB"
    );
    assert.ok(
      /storage\.buckets[\s\S]*?file_size_limit/.test(apply),
      "apply.sh does not set the bucket file_size_limit outside migrations"
    );
    assert.ok(
      /RAISE EXCEPTION|exit 1/.test(apply),
      "apply.sh does not fail when the stored cap disagrees with the setting"
    );
  });

  it("drives Storage's FILE_SIZE_LIMIT from the same setting", () => {
    const compose = readRepo("supabase/docker-compose.yml");
    assert.ok(
      !/^      FILE_SIZE_LIMIT: 52428800$/m.test(compose),
      "Storage FILE_SIZE_LIMIT is still the hard-coded 50 MB"
    );
    assert.ok(
      /FILE_SIZE_LIMIT: \$\{FILE_SIZE_LIMIT/.test(compose),
      "Storage FILE_SIZE_LIMIT does not follow the deployment setting"
    );
    const genEnv = readRepo("supabase/bin/gen-env.py");
    assert.ok(
      /FILE_SIZE_LIMIT/.test(genEnv) && /CHAT_IMAGE_MAX_MB/.test(genEnv),
      "gen-env.py does not derive FILE_SIZE_LIMIT from CHAT_IMAGE_MAX_MB"
    );
    assert.ok(
      /1048576|1024\s*\*\s*1024/.test(genEnv),
      "gen-env.py does not convert megabytes to bytes"
    );
  });
});
