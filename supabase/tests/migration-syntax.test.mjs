import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Guards the migration SQL against statement-initial bare constraint DDL.
// Postgres requires ALTER TABLE <table> DROP/ADD CONSTRAINT ...; a bare
// `DROP CONSTRAINT ... ON <table>` is a syntax error that psql
// (ON_ERROR_STOP=1 in supabase/migrate/apply.sh) turns into a migrate
// exit 3 in CI. Static feature tests (*.test.mjs) grep for strings and
// pass with broken SQL, so this file scans every migration instead. The
// realtime-auth channel policies apply through the same apply.sh tracking,
// so they are scanned too.
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const realtimeAuthDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "realtime-auth"
);

const files = () =>
  [
    ...readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => join(migrationsDir, f)),
    ...readdirSync(realtimeAuthDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => join(realtimeAuthDir, f)),
  ].sort();

const shortName = (p) => p.split("/").at(-1);

describe("migration SQL syntax guard", () => {
  it("has at least one migration to scan", () => {
    assert.ok(files().length > 0, "no migration files found");
  });

  it("never uses bare DROP CONSTRAINT (must be ALTER TABLE ... DROP ...)", () => {
    const bad = files().filter((f) => {
      const text = readFileSync(f, "utf8");
      return /^DROP\s+CONSTRAINT\b/m.test(text);
    });
    assert.deepEqual(
      bad.map(shortName),
      [],
      `bare DROP CONSTRAINT in: ${bad.map(shortName).join(", ")} (use ALTER TABLE ... DROP CONSTRAINT ...)`
    );
  });

  it("never uses bare ADD CONSTRAINT (must be ALTER TABLE ... ADD ...)", () => {
    const bad = files().filter((f) => {
      const text = readFileSync(f, "utf8");
      return /^ADD\s+CONSTRAINT\b/m.test(text);
    });
    assert.deepEqual(
      bad.map(shortName),
      [],
      `bare ADD CONSTRAINT in: ${bad.map(shortName).join(", ")} (use ALTER TABLE ... ADD CONSTRAINT ...)`
    );
  });
});
