import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const pinFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_chat_momentum_burn_gms_pin.sql")
  );
  assert.ok(files.length > 0, "no *_chat_momentum_burn_gms_pin.sql migration");
  assert.equal(
    files.length,
    1,
    "more than one *_chat_momentum_burn_gms_pin.sql migration"
  );
  return files[0];
};

const text = () => readFileSync(join(dir, pinFile()), "utf8");

describe("chat momentum burn GM-only pin (#125 follow-up)", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention on a later stamp", () => {
    assert.match(pinFile(), /^\d{14}_chat_momentum_burn_gms_pin\.sql$/);
    const stamp = pinFile().slice(0, 14);
    assert.ok(
      stamp > "20261118000000",
      "GM-only pin must sort later than the 20261118000000 hardening"
    );
    // Migrations that landed after the pin (the 20261120000000
    // storage-privileges fix, the #128 assistant tables, and the #131 campaign outline) sort later by
    // design, so they are excluded here.
    const landedLater = new Set([
      "20261128000000_chat_email_prefs.sql",
      "20261128000001_chat_post_email_outbox.sql",
      "20261121000008_assistant_messages_applied_version_index.sql",
      "20261120000000_chat_storage_privileges.sql",
      "20261121000000_campaign_active_character.sql",
      "20261121000001_chat_roll_lock_definer.sql",
      "20261121000002_campaign_swap_owner_guard.sql",
      "20261121000003_campaign_burn_campaign_match.sql",
      "20261121000004_assistant_conversations.sql",
      "20261121000005_campaign_outline.sql",
      "20261121000006_assistant_outline_versions.sql",
      "20261121000007_assistant_proposal_state.sql",
      "20261127000000_chat_post_search.sql",
    ]);
    const others = readdirSync(dir).filter(
      (f) =>
        /^\d{14}_/.test(f) && f !== pinFile() && !landedLater.has(f)
    );
    for (const other of others) {
      assert.ok(
        stamp > other.slice(0, 14),
        `${pinFile()} does not sort after ${other}`
      );
    }
  });

  it("refuses every gms_only change, including a lone flag flip", () => {
    const sql = text();
    // The pin comes first, before any roll-equality early return: a lone
    // flag flip with the roll untouched must raise, not pass through.
    const pinIndex = sql.search(
      /IF\s+OLD\.gms_only\s+IS DISTINCT FROM\s+NEW\.gms_only\s+THEN/i
    );
    assert.ok(pinIndex >= 0, "no gms_only pin in keep_chat_roll_immutable");
    assert.ok(
      /RAISE EXCEPTION/i.test(sql.slice(pinIndex, pinIndex + 500)),
      "the gms_only pin does not raise"
    );
    assert.ok(
      !/OLD\.roll\s+IS NOT DISTINCT FROM\s+NEW\.roll[\s\S]{0,200}?OLD\.gms_only\s+IS DISTINCT FROM\s+NEW\.gms_only\s+THEN\s+RETURN NEW/i.test(
        sql
      ),
      "a lone gms_only flip still passes through"
    );
  });

  it("pins search_path on the replacement roll lock", () => {
    const sql = text();
    assert.ok(
      /keep_chat_roll_immutable\(\)[\s\S]*?SET\s+search_path\s*=\s*(''|"")/i.test(
        sql
      ),
      "keep_chat_roll_immutable does not pin search_path"
    );
  });

  it("never edits the 20261118000000 hardening", () => {
    const hardening = readFileSync(
      join(dir, "20261118000000_chat_momentum_burn_hardening.sql"),
      "utf8"
    );
    assert.ok(
      /AND\s+OLD\.gms_only\s+IS DISTINCT FROM\s+NEW\.gms_only\s+THEN\s+RETURN NEW/i.test(
        hardening
      ),
      "20261118000000_chat_momentum_burn_hardening.sql was edited instead of superseded"
    );
  });
});
