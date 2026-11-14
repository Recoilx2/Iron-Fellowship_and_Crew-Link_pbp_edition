import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const activeFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_campaign_active_character.sql")
  );
  assert.ok(files.length > 0, "no *_campaign_active_character.sql migration");
  assert.equal(
    files.length,
    1,
    "more than one *_campaign_active_character.sql migration"
  );
  return files[0];
};

const text = () => readFileSync(join(dir, activeFile()), "utf8");

describe("campaign active character migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention after prod", () => {
    assert.match(activeFile(), /^\d{14}_campaign_active_character\.sql$/);
    const stamp = activeFile().slice(0, 14);
    assert.ok(
      stamp > "20261120000000",
      `migration timestamp ${stamp} is not later than prod's 20261120000000`
    );
  });

  it("adds an is_active flag defaulting to active", () => {
    const sql = text();
    assert.ok(
      /is_active\s+boolean\s+NOT NULL\s+DEFAULT true/i.test(sql),
      "no is_active boolean defaulting to true on characters"
    );
  });

  it("replaces the one-character rule with at most one active per player", () => {
    const sql = text();
    assert.ok(
      /DROP INDEX IF EXISTS\s+public\.characters_one_per_player_per_campaign/i.test(
        sql
      ),
      "the one-per-player index is never dropped"
    );
    assert.ok(
      /CREATE UNIQUE INDEX[\s\S]*?ON public\.characters\s*\(\s*owner_id\s*,\s*campaign_id\s*\)[\s\S]*?WHERE campaign_id IS NOT NULL AND is_active/i.test(
        sql
      ),
      "no partial unique index on active campaign characters"
    );
  });

  it("retires and reactivates owner-only with a single-step swap", () => {
    const sql = text();
    const swap = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.set_campaign_character_active[\s\S]*?^\$\$;/m
    );
    assert.ok(
      swap,
      "no set_campaign_character_active(char_id, make_active) definition"
    );
    assert.ok(
      /set_campaign_character_active\s*\(\s*char_id\s+uuid\s*,\s*make_active\s+boolean\s*\)/i.test(
        swap[0]
      ),
      "no set_campaign_character_active(char_id, make_active) signature"
    );
    assert.ok(
      /SECURITY\s+DEFINER/i.test(swap[0]),
      "set_campaign_character_active itself is not security definer"
    );
    assert.ok(
      /SET\s+search_path\s*=\s*(''|"")/i.test(swap[0]),
      "set_campaign_character_active does not pin search_path"
    );
    assert.ok(
      /only the owner/i.test(sql),
      "no owner-only refusal for retire/reactivate"
    );
    assert.ok(
      /42501/.test(sql),
      "the owner-only refusal carries no privilege error code"
    );
    assert.ok(
      /UPDATE public\.characters SET is_active = false[\s\S]*?UPDATE public\.characters SET is_active = true/i.test(
        sql
      ),
      "activating does not retire the other active characters in the same call"
    );
    assert.ok(
      /GRANT EXECUTE ON FUNCTION public\.set_campaign_character_active/i.test(
        sql
      ),
      "authenticated callers cannot execute the swap"
    );
  });

  it("speaks in character as the active character only", () => {
    const sql = text();
    assert.ok(
      /FOR INSERT[\s\S]*?chat_posts[\s\S]*?c\.is_active/i.test(sql) ||
        /speaker[\s\S]*?AND c\.is_active/i.test(sql),
      "the speaker check does not require the active character"
    );
  });

  it("burns momentum on the active character's rolls only", () => {
    const sql = text();
    assert.ok(
      /keep_chat_roll_immutable[\s\S]*?is_active/i.test(sql),
      "posted burns do not require the active character"
    );
    assert.ok(
      /enforce_chat_roll_burn_on_insert[\s\S]*?is_active/i.test(sql),
      "composer-send burns do not require the active character"
    );
  });

  it("leaves direct flag writes to the owner-only update policy", () => {
    // No new UPDATE policy and no extra grant: the base characters
    // migration restricts every UPDATE (including is_active) to the row
    // owner with no GM exception, so a direct write by anyone else touches
    // zero rows and the swap function stays the only path with its own
    // owner-only refusal.
    const sql = text();
    assert.ok(
      !/CREATE POLICY[\s\S]*?ON public\.characters[\s\S]*?FOR UPDATE/i.test(
        sql
      ),
      "the migration adds a characters UPDATE policy beside the owner-only one"
    );
  });
});
