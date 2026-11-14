import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const files = () =>
  readdirSync(dir).filter((f) => /^\d{14}_/.test(f));

const textOf = (name) => readFileSync(join(dir, name), "utf8");

const SWAP_HARDENING = "20261121000002_campaign_swap_owner_guard.sql";
const BURN_CAMPAIGN = "20261121000003_campaign_burn_campaign_match.sql";

describe("active character hardening migrations (review round 1 on #127)", () => {
  it("lands both hardening files after the regressed ones", () => {
    const names = files();
    for (const wanted of [SWAP_HARDENING, BURN_CAMPAIGN]) {
      assert.ok(
        names.includes(wanted),
        `missing hardening migration ${wanted}`
      );
    }
    assert.ok(
      SWAP_HARDENING > "20261121000001_chat_roll_lock_definer.sql",
      "swap guard does not sort after the roll-lock repair"
    );
    assert.ok(
      BURN_CAMPAIGN > SWAP_HARDENING,
      "burn campaign match does not sort after the swap guard"
    );
  });

  it("refuses signed-out callers of the swap function", () => {
    // auth.uid() is NULL with no JWT, so `mine` is NULL and `IF NOT mine`
    // never fires: the definer runs both UPDATEs anyway. The guard names
    // the NULL caller outright.
    const sql = textOf(SWAP_HARDENING);
    assert.ok(
      /set_campaign_character_active/i.test(sql),
      "the swap guard never restates set_campaign_character_active"
    );
    assert.ok(
      /caller\s+IS\s+NULL/i.test(sql),
      "no signed-out caller guard on the swap"
    );
    assert.ok(
      /42501/.test(sql),
      "the signed-out refusal carries no privilege error code"
    );
    assert.ok(
      /mine\s+IS\s+NOT\s+TRUE/i.test(sql),
      "the owner check still passes a NULL comparison"
    );
  });

  it("keeps the swap executable to signed-in callers only", () => {
    const sql = textOf(SWAP_HARDENING);
    assert.ok(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.set_campaign_character_active[\s\S]*?FROM\s+PUBLIC/i.test(
        sql
      ),
      "EXECUTE on the swap is never revoked from PUBLIC"
    );
    assert.ok(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.set_campaign_character_active[\s\S]*?[, ]anon/i.test(
        sql
      ),
      "EXECUTE on the swap is never revoked from anon"
    );
    assert.ok(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.set_campaign_character_active[\s\S]*?TO\s+authenticated/i.test(
        sql
      ),
      "authenticated callers lose EXECUTE on the swap"
    );
  });

  it("the swap stays a pinned definer with the same one-step body", () => {
    const sql = textOf(SWAP_HARDENING);
    assert.ok(
      /set_campaign_character_active[\s\S]*?SECURITY\s+DEFINER/i.test(sql),
      "the swap guard drops SECURITY DEFINER"
    );
    assert.ok(
      /UPDATE\s+public\.characters\s+SET\s+is_active\s*=\s*false[\s\S]*?UPDATE\s+public\.characters\s+SET\s+is_active\s*=\s*true/i.test(
        sql
      ),
      "the one-step swap body changed in the guard restatement"
    );
  });

  it("burns only on rolls whose speaker still plays in the post's campaign", () => {
    // Unlinking leaves is_active true, so an old roll's speaker can be
    // active-but-gone: the burn must also match the character's campaign
    // to the post's channel campaign.
    const sql = textOf(BURN_CAMPAIGN);
    assert.ok(
      /keep_chat_roll_immutable/i.test(sql),
      "the campaign-match repair never restates the roll lock"
    );
    assert.ok(
      /c\.campaign_id|char_camp|character[^;]*campaign_id/i.test(sql),
      "the burn branch never reads the speaker's campaign"
    );
    assert.ok(
      /chat_channels|channel[^;]*campaign_id/i.test(sql),
      "the burn branch never reads the post's campaign"
    );
  });

  it("the campaign-match repair keeps the lock a pinned definer", () => {
    const sql = textOf(BURN_CAMPAIGN);
    assert.ok(
      /keep_chat_roll_immutable\(\)[\s\S]*?SECURITY\s+DEFINER/i.test(sql),
      "the campaign-match restatement drops SECURITY DEFINER"
    );
    assert.ok(
      /is_active/i.test(sql),
      "the campaign-match restatement drops the active-character checks"
    );
  });
});
