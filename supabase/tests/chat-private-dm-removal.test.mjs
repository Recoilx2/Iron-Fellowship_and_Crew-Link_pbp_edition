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
  it("follows the <UTC timestamp>_<short-name>.sql convention with a timestamp later than every migration on the branch", () => {
    assert.match(accessFile(), /^\d{14}_chat_private_dm_removal\.sql$/);
    const stamps = readdirSync(dir)
      .map((f) => (/^(\d{14})_.*\.sql$/.exec(f) ?? [])[1])
      .filter(Boolean)
      .sort();
    const mine = accessFile().slice(0, 14);
    assert.equal(
      stamps.at(-1),
      mine,
      "the removal migration must sort last so it applies after every fix it builds on"
    );
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
