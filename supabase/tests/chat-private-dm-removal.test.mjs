import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const accessFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_chat_private_dm_removal.sql")
  );
  assert.equal(
    files.length,
    1,
    "expected one *_chat_private_dm_removal.sql migration (#117)"
  );
  return files[0];
};

const text = () => readFileSync(join(dir, accessFile()), "utf8");

describe("removed campaign members keep no private access migration (#117)", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention with a timestamp later than every migration it builds on", () => {
    assert.match(accessFile(), /^\d{14}_chat_private_dm_removal\.sql$/);
    const mine = accessFile();
    const stamp = mine.slice(0, 14);
    // Migrations that landed after #117 (e.g. #118 chat image access,
    // 20261114000000, #120 roll cleanup, 20261115000000, #125 momentum
    // burn, 20261116000000, and #118 image hardening, 20261117000000, #125
    // burn hardening, 20261118000000, and its GM-only pin,
    // 20261119000000, and the storage-privileges fix, 20261120000000)
    // sort later by design, so they are excluded here.
    const landedLater = new Set([
      "20261114000000_chat_image_access.sql",
      "20261115000000_chat_roll_cleanup.sql",
      "20261116000000_chat_momentum_burn.sql",
      "20261117000000_chat_image_hardening.sql",
      "20261118000000_chat_momentum_burn_hardening.sql",
      "20261119000000_chat_momentum_burn_gms_pin.sql",
      "20261120000000_chat_storage_privileges.sql",
    ]);
    const others = readdirSync(dir).filter(
      (f) => /^\d{14}_.*\.sql$/.test(f) && f !== mine && !landedLater.has(f)
    );
    for (const other of others) {
      assert.ok(
        stamp > other.slice(0, 14),
        `${mine} does not sort after ${other}`
      );
    }
  });

  it("requires current campaign membership to read private and DM channels", () => {
    const sql = text();
    assert.ok(
      /CREATE OR REPLACE FUNCTION[\s\S]*?private\.can_read_channel/i.test(sql),
      "no replacement visibility check"
    );
    assert.ok(
      /private\.is_campaign_member\(ch\.campaign_id\)[\s\S]*?AND[\s\S]*?\([\s\S]*?'public'/i.test(
        sql
      ),
      "campaign membership does not gate every visibility"
    );
    assert.ok(
      /'private'[\s\S]*?private\.is_channel_member/i.test(sql),
      "private channels no longer check the roster"
    );
    assert.ok(
      /'private'[\s\S]*?private\.is_campaign_gm/i.test(sql),
      "private channels no longer admit the campaign GMs"
    );
    assert.ok(
      /'dm'[\s\S]*?private\.is_channel_member/i.test(sql),
      "direct messages no longer check the roster"
    );
  });

  it("clears the departing member's channel roster rows when any campaign membership ends", () => {
    const sql = text();
    assert.ok(
      /AFTER DELETE ON public\.campaign_members/i.test(sql),
      "nothing runs when a campaign membership ends"
    );
    assert.ok(
      /DELETE FROM public\.chat_channel_members/i.test(sql),
      "no cleanup of the departing member's roster rows"
    );
    assert.ok(
      /campaign_id = OLD\.campaign_id[\s\S]*?user_id = OLD\.user_id|user_id = OLD\.user_id[\s\S]*?campaign_id = OLD\.campaign_id/i.test(
        sql
      ),
      "the cleanup is not scoped to the departing member's campaign channels"
    );
  });

  it("takes the roster table out of the realtime publication so membership DELETEs stop broadcasting", () => {
    const sql = text();
    assert.ok(
      /ALTER PUBLICATION supabase_realtime DROP TABLE public\.chat_channel_members/i.test(
        sql
      ),
      "chat_channel_members is not dropped from the realtime publication"
    );
    assert.ok(
      !/ADD TABLE public\.chat_channel_members/i.test(sql),
      "chat_channel_members is re-added to the realtime publication"
    );
  });
});
