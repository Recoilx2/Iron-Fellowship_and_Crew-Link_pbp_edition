import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const postsFile = () => {
  const files = readdirSync(dir).filter((f) => f.endsWith("_chat_posts.sql"));
  assert.ok(files.length > 0, "no *_chat_posts.sql migration");
  assert.equal(files.length, 1, "more than one *_chat_posts.sql migration");
  return files[0];
};

const text = () => readFileSync(join(dir, postsFile()), "utf8");

describe("chat posts migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(postsFile(), /^\d{14}_chat_posts\.sql$/);
  });

  it("creates public.chat_posts beside its channel", () => {
    const sql = text();
    assert.ok(
      /CREATE TABLE[\s\S]*?public\.chat_posts\b/i.test(sql),
      "no public.chat_posts table"
    );
    assert.ok(
      /channel_id[\s\S]*?REFERENCES[\s\S]*?public\.chat_channels[\s\S]*?ON DELETE CASCADE/i.test(
        sql
      ),
      "posts do not follow their channel with ON DELETE CASCADE"
    );
    assert.ok(/author_id\s+uuid/i.test(sql), "no author column");
    assert.ok(
      /speaker_character_id\s+uuid/i.test(sql),
      "no speaker character column"
    );
    assert.ok(/text\s+text/i.test(sql), "no post text column");
    assert.ok(/created_at/i.test(sql), "no created_at for ordering");
    assert.ok(/updated_at/i.test(sql), "no updated_at for stale-event detection");
    assert.ok(
      /ENABLE ROW LEVEL SECURITY/i.test(sql),
      "row-level security not enabled"
    );
  });

  it("requires text and keeps the speaker inside the author's campaign", () => {
    const sql = text();
    assert.ok(
      /CHECK[\s\S]*?trim\s*\(\s*text\s*\)/i.test(sql),
      "empty text posts are not refused"
    );
    assert.ok(
      /speaker_character_id[\s\S]*?owner_id/i.test(sql),
      "nothing ties the speaker to the author's character"
    );
    assert.ok(
      /speaker_character_id[\s\S]*?campaign_id/i.test(sql),
      "nothing ties the speaker to the channel's campaign"
    );
  });

  it("lets members read and post but nobody else", () => {
    const sql = text();
    assert.ok(
      /FOR SELECT[\s\S]*?is_campaign_member/i.test(sql),
      "SELECT is not restricted to campaign members"
    );
    assert.ok(
      /FOR INSERT[\s\S]*?is_campaign_member/i.test(sql),
      "INSERT does not require campaign membership"
    );
    assert.ok(
      /FOR INSERT[\s\S]*?archived/i.test(sql),
      "INSERT does not refuse archived channels"
    );
    assert.ok(!/FOR UPDATE/i.test(sql), "edits belong to a later ticket");
    assert.ok(!/FOR DELETE/i.test(sql), "deletes belong to a later ticket");
    assert.ok(!/\bTO\s+anon\b/i.test(sql), "signed-out readers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(sql), "everyone is granted access");
  });

  it("leaves room for threads, whispers, rolls, images, edits and deletes", () => {
    const sql = text();
    assert.ok(/parent/i.test(sql), "no room left for threaded replies");
    assert.ok(/recipient/i.test(sql), "no room left for whispers");
    assert.ok(/roll/i.test(sql), "no room left for roll posts");
    assert.ok(/image/i.test(sql), "no room left for image attachments");
    assert.ok(/edit/i.test(sql), "no room left for edits");
    assert.ok(/delet/i.test(sql), "no room left for soft deletes");
  });

  it("streams post rows over live updates", () => {
    const sql = text();
    assert.ok(
      /REPLICA IDENTITY FULL/i.test(sql),
      "no REPLICA IDENTITY FULL for deleted-row payloads"
    );
    assert.ok(
      /supabase_realtime[\s\S]*?chat_posts|chat_posts[\s\S]*?supabase_realtime/i.test(
        sql
      ),
      "chat_posts is not added to the realtime publication"
    );
  });
});
