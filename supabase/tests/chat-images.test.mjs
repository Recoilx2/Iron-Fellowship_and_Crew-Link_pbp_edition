import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const imagesFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_chat_images.sql")
  );
  assert.ok(files.length > 0, "no *_chat_images.sql migration");
  assert.equal(files.length, 1, "more than one *_chat_images.sql migration");
  return files[0];
};

const text = () => readFileSync(join(dir, imagesFile()), "utf8");

describe("chat images storage", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(imagesFile(), /^\d{14}_chat_images\.sql$/);
  });

  it("carries image attachments on the post row", () => {
    const sql = text();
    assert.ok(/image_paths/i.test(sql), "no image_paths column for posts");
    assert.ok(
      /CHECK[\s\S]*?cardinality\s*\(\s*image_paths\s*\)/i.test(sql),
      "image-only posts are not allowed past the text rule"
    );
  });

  it("keeps chat images in a private bucket capped at 10 MB", () => {
    const sql = text();
    assert.ok(
      /INSERT\s+INTO\s+storage\.buckets/i.test(sql),
      "no storage bucket is created"
    );
    assert.ok(/chat-images/.test(sql), "bucket is not named chat-images");
    assert.ok(
      /public\s*,\s*false|public\s*=\s*false/i.test(sql),
      "chat-images bucket is not private"
    );
    assert.ok(
      /file_size_limit[\s\S]*?10485760/i.test(sql),
      "chat-images bucket is not capped at 10 MB"
    );
  });

  it("lets only campaign members read and write their chat images", () => {
    const sql = text();
    assert.ok(/CREATE POLICY/i.test(sql), "no storage access rules");
    assert.ok(
      /storage\.objects/i.test(sql),
      "rules are not on storage.objects"
    );
    for (const op of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(`FOR ${op}\\b`, "i").test(sql),
        `no ${op} rule on the chat-images bucket`
      );
    }
    assert.ok(
      /is_campaign_member/i.test(sql),
      "rules are not scoped to campaign members"
    );
    assert.ok(
      !/\bTO\s+anon\b/i.test(sql),
      "signed-out readers are granted access"
    );
    assert.ok(
      !/\bTO\s+PUBLIC\b/i.test(sql),
      "everyone is granted access"
    );
  });
});
