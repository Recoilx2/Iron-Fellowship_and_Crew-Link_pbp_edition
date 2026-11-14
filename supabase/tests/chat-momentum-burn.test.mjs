import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const hardeningFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_chat_momentum_burn_hardening.sql")
  );
  assert.ok(files.length > 0, "no *_chat_momentum_burn_hardening.sql migration");
  assert.equal(
    files.length,
    1,
    "more than one *_chat_momentum_burn_hardening.sql migration"
  );
  return files[0];
};

const text = () => readFileSync(join(dir, hardeningFile()), "utf8");

describe("chat momentum burn hardening migration (#125)", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention on a later stamp", () => {
    assert.match(
      hardeningFile(),
      /^\d{14}_chat_momentum_burn_hardening\.sql$/
    );
    const stamp = hardeningFile().slice(0, 14);
    // The GM-only pin (20261119000000) lands after #125 hardening by
    // design, so it is excluded here. The storage-privileges fix
    // (20261120000000) lands later still.
    const landedLater = new Set([
      "20261119000000_chat_momentum_burn_gms_pin.sql",
      "20261120000000_chat_storage_privileges.sql",
    ]);
    const others = readdirSync(dir).filter(
      (f) =>
        /^\d{14}_/.test(f) &&
        f !== hardeningFile() &&
        !landedLater.has(f)
    );
    for (const other of others) {
      assert.ok(
        other.slice(0, 14) < stamp,
        `${hardeningFile()} does not sort after ${other}`
      );
    }
    assert.ok(
      stamp > "20261116000000",
      "hardening must sort later than the base burn migration"
    );
  });

  it("pins search_path on the roll lock", () => {
    const sql = text();
    assert.ok(
      /keep_chat_roll_immutable\(\)[\s\S]*?SET\s+search_path\s*=\s*(''|"")/i.test(
        sql
      ),
      "keep_chat_roll_immutable does not pin search_path"
    );
  });

  it("ties the burn to the speaker character's current momentum", () => {
    const sql = text();
    assert.ok(
      /characters[\s\S]*?momentum/i.test(sql),
      "nothing reads the speaker character's momentum"
    );
    assert.ok(
      /momentumBurned[\s\S]*?momentum/i.test(sql),
      "the burn value is never compared to the character's momentum"
    );
  });

  it("requires the new outcome to be strictly better than the old one", () => {
    const sql = text();
    assert.ok(
      /strictly better/i.test(sql),
      "nothing requires the burned outcome to improve on the posted one"
    );
  });

  it("resets momentum in the same transaction as the burn", () => {
    const sql = text();
    assert.ok(
      /AFTER\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.chat_posts/i.test(sql),
      "no single-transaction reset trigger on chat posts"
    );
    assert.ok(
      /UPDATE\s+public\.characters[\s\S]*?momentum\s*=/i.test(sql),
      "the reset trigger never writes the character's momentum"
    );
    assert.ok(
      /SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*(''|"")/i.test(sql),
      "helpers are not security definer with a pinned search_path"
    );
  });

  it("validates composer sends carrying a burn at insert", () => {
    const sql = text();
    assert.ok(
      /BEFORE\s+INSERT\s+ON\s+public\.chat_posts/i.test(sql),
      "no insert-side burn validation for composer sends"
    );
  });
});
