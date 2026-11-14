import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const accessFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_chat_private_dm.sql")
  );
  assert.ok(files.length > 0, "no *_chat_private_dm.sql migration");
  assert.equal(files.length, 1, "more than one *_chat_private_dm.sql migration");
  return files[0];
};

const text = () => readFileSync(join(dir, accessFile()), "utf8");

describe("chat private channels and direct messages migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(accessFile(), /^\d{14}_chat_private_dm\.sql$/);
  });

  it("marks channels public, private or dm, starting channels staying public", () => {
    const sql = text();
    assert.ok(
      /visibility[^;]*IN\s*\(\s*'public'\s*,\s*'private'\s*,\s*'dm'\s*\)/i.test(sql),
      "no public/private/dm visibility on chat_channels"
    );
    assert.ok(
      /is_starting[\s\S]*?visibility|visibility[\s\S]*?is_starting/i.test(sql),
      "nothing keeps the starting channels public"
    );
  });

  it("keeps the channel roster in a members table with no direct writes", () => {
    const sql = text();
    assert.ok(
      /CREATE TABLE[\s\S]*?public\.chat_channel_members\b/i.test(sql),
      "no public.chat_channel_members table"
    );
    assert.ok(
      /channel_id[\s\S]*?REFERENCES[\s\S]*?public\.chat_channels[\s\S]*?ON DELETE CASCADE/i.test(
        sql
      ),
      "memberships do not follow their channel with ON DELETE CASCADE"
    );
    assert.ok(
      /ENABLE ROW LEVEL SECURITY/i.test(sql),
      "row-level security not enabled"
    );
    assert.ok(
      /FOR SELECT[\s\S]*?public\.chat_channel_members|ON public\.chat_channel_members[\s\S]{0,200}?FOR SELECT/i.test(
        sql
      ),
      "no SELECT policy on the members table"
    );
    assert.ok(
      !/ON public\.chat_channel_members[\s\S]{0,200}?FOR INSERT/i.test(sql),
      "members must only change through the management functions"
    );
    assert.ok(
      !/ON public\.chat_channel_members[\s\S]{0,200}?FOR DELETE/i.test(sql),
      "memberships must only change through the management functions"
    );
  });

  it("reads channels, posts and memberships through one visibility check", () => {
    const sql = text();
    assert.ok(/can_read_channel/i.test(sql), "no shared visibility check");
    assert.ok(
      /FOR SELECT[\s\S]*?can_read_channel[\s\S]*?chat_channels|chat_channels_select/i.test(
        sql
      ),
      "channel reads do not use the visibility check"
    );
    assert.ok(
      /FOR SELECT[\s\S]*?can_read_channel[\s\S]*?chat_posts|chat_posts_select/i.test(
        sql
      ),
      "post reads do not use the visibility check"
    );
    assert.ok(
      /private[\s\S]*?is_campaign_gm/i.test(sql),
      "private channels are not visible to campaign GMs"
    );
    assert.ok(
      /'dm'[\s\S]*?is_channel_member/i.test(sql),
      "direct messages are not limited to their two members"
    );
  });

  it("keeps direct messages blind to GMs on every table", () => {
    const sql = text();
    assert.ok(
      /FOR INSERT[\s\S]*?chat_posts[\s\S]*?can_read_channel/i.test(sql),
      "post writes do not use the visibility check"
    );
    assert.ok(
      /visibility\s*<>?\s*'dm'|visibility\s*!=\s*'dm'/i.test(sql),
      "nothing stops blind GM writes to direct messages"
    );
  });

  it("manages private rosters and DMs through database functions", () => {
    const sql = text();
    assert.ok(
      /CREATE OR REPLACE FUNCTION[\s\S]*?create_private_channel/i.test(sql),
      "no create_private_channel function"
    );
    assert.ok(
      /CREATE OR REPLACE FUNCTION[\s\S]*?set_channel_members/i.test(sql),
      "no set_channel_members function"
    );
    assert.ok(
      /CREATE OR REPLACE FUNCTION[\s\S]*?get_or_create_dm_channel/i.test(
        sql
      ),
      "no get_or_create_dm_channel function"
    );
    assert.ok(
      /GRANT EXECUTE ON FUNCTION public\.create_private_channel/i.test(sql),
      "create_private_channel is not granted to members"
    );
    assert.ok(
      /GRANT EXECUTE ON FUNCTION public\.set_channel_members/i.test(sql),
      "set_channel_members is not granted to members"
    );
    assert.ok(
      /GRANT EXECUTE ON FUNCTION public\.get_or_create_dm_channel/i.test(
        sql
      ),
      "get_or_create_dm_channel is not granted to members"
    );
  });

  it("bumps the channel when its roster changes so open listeners re-check", () => {
    const sql = text();
    assert.ok(
      /chat_channel_members[\s\S]*?updated_at|updated_at[\s\S]*?chat_channel_members/i.test(
        sql
      ),
      "roster changes do not touch the parent channel"
    );
  });

  it("streams membership rows over live updates", () => {
    const sql = text();
    assert.ok(
      /REPLICA IDENTITY FULL/i.test(sql),
      "no REPLICA IDENTITY FULL for deleted-row payloads"
    );
    assert.ok(
      /supabase_realtime[\s\S]*?chat_channel_members|chat_channel_members[\s\S]*?supabase_realtime/i.test(
        sql
      ),
      "chat_channel_members is not added to the realtime publication"
    );
  });
});
