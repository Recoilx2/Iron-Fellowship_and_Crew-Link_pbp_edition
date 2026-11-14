import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// The #120 fix lands as its own migration: existing migrations are never
// edited, and it sorts after every migration on the branch, so filename
// order alone decides the outcome.
const cleanupFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_chat_roll_cleanup.sql")
  );
  assert.ok(files.length > 0, "no *_chat_roll_cleanup.sql migration");
  assert.equal(
    files.length,
    1,
    "more than one *_chat_roll_cleanup.sql migration"
  );
  return files[0];
};

const text = () => readFileSync(join(dir, cleanupFile()), "utf8");

describe("deleted-post cleanup and roll forgery migration (#120)", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention on a later stamp", () => {
    assert.match(cleanupFile(), /^\d{14}_chat_roll_cleanup\.sql$/);
    const stamp = cleanupFile().slice(0, 14);
    // Migrations that landed after #120 (e.g. #125 momentum burn,
    // 20261116000000, and #118 image hardening, 20261117000000, and #125
    // burn hardening, 20261118000000, and its GM-only pin,
    // 20261119000000, and the storage-privileges fix, 20261120000000)
    // sort later by design, so they are excluded here.
    const landedLater = new Set([
      "20261116000000_chat_momentum_burn.sql",
      "20261117000000_chat_image_hardening.sql",
      "20261118000000_chat_momentum_burn_hardening.sql",
      "20261119000000_chat_momentum_burn_gms_pin.sql",
      "20261120000000_chat_storage_privileges.sql",
    ]);
    const others = readdirSync(dir).filter(
      (f) => /^\d{14}_/.test(f) && f !== cleanupFile() && !landedLater.has(f)
    );
    for (const other of others) {
      assert.ok(
        stamp > other.slice(0, 14),
        `${cleanupFile()} does not sort after ${other}`
      );
    }
  });

  it("clears the text, images and roll on soft delete", () => {
    const sql = text();
    assert.ok(
      /NEW\.text\s*:?=\s*''/i.test(sql),
      "a soft delete does not clear the text"
    );
    assert.ok(
      /NEW\.image_paths\s*:?=\s*'\{\}'/i.test(sql),
      "a soft delete does not clear the image paths"
    );
    assert.ok(
      /NEW\.roll\s*:?=\s*NULL/i.test(sql),
      "a soft delete does not clear the roll"
    );
  });

  it("still lets the roll lock clear the roll on delete", () => {
    const sql = text();
    assert.ok(
      /OLD\.roll\s+IS DISTINCT FROM\s+NEW\.roll/i.test(sql),
      "nothing keeps posted dice immutable"
    );
    assert.ok(
      /deleted_at/i.test(sql),
      "the roll lock does not allow clearing on delete"
    );
  });

  it("requires a posted roll to match the post on insert", () => {
    const sql = text();
    assert.ok(/FOR EACH ROW/i.test(sql), "no row trigger validates the roll");
    assert.ok(/BEFORE INSERT/i.test(sql), "no insert trigger validates the roll");
    assert.ok(
      /NEW\.roll\s*->>\s*'uid'/i.test(sql) && /NEW\.author_id/i.test(sql),
      "the roll's uid is not bound to the post's author"
    );
    assert.ok(
      /NEW\.roll\s*->>\s*'characterId'/i.test(sql) &&
        /NEW\.speaker_character_id/i.test(sql),
      "the roll's character is not bound to the post's speaker"
    );
  });

  it("keeps deletes soft and the access closed", () => {
    const sql = text();
    assert.ok(!/FOR DELETE/i.test(sql), "a SQL DELETE policy bypasses RLS");
    assert.ok(
      !/\bTO\s+anon\b/i.test(sql),
      "signed-out writers are granted access"
    );
    assert.ok(
      !/\bTO\s+PUBLIC\b/i.test(sql),
      "everyone is granted access"
    );
  });
});
