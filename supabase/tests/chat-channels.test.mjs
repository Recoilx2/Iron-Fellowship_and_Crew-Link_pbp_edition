import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const channelsFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_chat_channels.sql")
  );
  assert.ok(files.length > 0, "no *_chat_channels.sql migration");
  assert.equal(files.length, 1, "more than one *_chat_channels.sql migration");
  return files[0];
};

const text = () =>
  readFileSync(join(dir, channelsFile()), "utf8");

describe("chat channels migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(channelsFile(), /^\d{14}_chat_channels\.sql$/);
  });

  it("creates public.chat_channels beside its campaign", () => {
    const sql = text();
    assert.ok(
      /CREATE TABLE[\s\S]*?public\.chat_channels\b/i.test(sql),
      "no public.chat_channels table"
    );
    assert.ok(
      /campaign_id[\s\S]*?REFERENCES[\s\S]*?public\.campaigns[\s\S]*?ON DELETE CASCADE/i.test(
        sql
      ),
      "channels do not follow their campaign with ON DELETE CASCADE"
    );
    assert.ok(/name\s+text/i.test(sql), "no channel name column");
    assert.ok(
      /kind[^;]*IN\s*\(\s*'IC'\s*,\s*'OOC'\s*\)/i.test(sql),
      "kind is not restricted to IC/OOC"
    );
    assert.ok(/is_starting\s+boolean/i.test(sql), "no starting-channel flag");
    assert.ok(/archived\s+boolean/i.test(sql), "no archived flag");
    assert.ok(/created_by\s+uuid/i.test(sql), "no creator column");
    assert.ok(/updated_at/i.test(sql), "no updated_at for stale-event detection");
    assert.ok(
      /ENABLE ROW LEVEL SECURITY/i.test(sql),
      "row-level security not enabled"
    );
  });

  it("lets members read channels but only GMs write them", () => {
    const sql = text();
    assert.ok(
      /FOR SELECT[\s\S]*?is_campaign_member/i.test(sql),
      "SELECT is not restricted to campaign members"
    );
    assert.ok(
      /FOR INSERT[\s\S]*?is_campaign_gm/i.test(sql),
      "INSERT does not require the GM role"
    );
    assert.ok(
      /FOR UPDATE[\s\S]*?is_campaign_gm/i.test(sql),
      "UPDATE does not require the GM role"
    );
    assert.ok(!/\bTO\s+anon\b/i.test(sql), "signed-out readers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(sql), "everyone is granted access");
  });

  it("keeps the starting channels unarchivable", () => {
    const sql = text();
    assert.ok(
      /is_starting[\s\S]*?archived/i.test(sql),
      "nothing stops the starting channels from being archived"
    );
    assert.ok(
      /starting channels cannot be archived/i.test(sql),
      "archiving a starting channel is not refused"
    );
    assert.ok(
      /starting channels stay starting channels/i.test(sql),
      "the starting flag itself is not immutable"
    );
  });

  it("creates the IC and OOC channels with the campaign", () => {
    const sql = text();
    assert.ok(
      /CREATE OR REPLACE FUNCTION[\s\S]*?create_campaign/i.test(sql),
      "create_campaign is not extended here"
    );
    assert.ok(
      /chat_channels[\s\S]*?'IC'|chat_channels[\s\S]*?"IC"/i.test(sql),
      "create_campaign does not insert the IC channel"
    );
    assert.ok(
      /chat_channels[\s\S]*?'OOC'|chat_channels[\s\S]*?"OOC"/i.test(sql),
      "create_campaign does not insert the OOC channel"
    );
  });

  it("streams channel rows over live updates", () => {
    const sql = text();
    assert.ok(
      /REPLICA IDENTITY FULL/i.test(sql),
      "no REPLICA IDENTITY FULL for deleted-row payloads"
    );
    assert.ok(
      /supabase_realtime[\s\S]*?chat_channels|chat_channels[\s\S]*?supabase_realtime/i.test(
        sql
      ),
      "chat_channels is not added to the realtime publication"
    );
  });
});
