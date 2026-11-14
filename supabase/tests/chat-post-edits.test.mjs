import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const editsFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_chat_post_edits.sql")
  );
  assert.ok(files.length > 0, "no *_chat_post_edits.sql migration");
  assert.equal(files.length, 1, "more than one *_chat_post_edits.sql migration");
  return files[0];
};

const text = () => readFileSync(join(dir, editsFile()), "utf8");

describe("chat post edits migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(editsFile(), /^\d{14}_chat_post_edits\.sql$/);
  });

  it("stamps edits and soft deletes without touching existing data", () => {
    const sql = text();
    assert.ok(/edited_at/i.test(sql), "no edited_at marker");
    assert.ok(/deleted_at/i.test(sql), "no deleted_at marker");
    assert.ok(
      /CHECK[\s\S]*?deleted_at[\s\S]*?trim\s*\(\s*text\s*\)|CHECK[\s\S]*?trim\s*\(\s*text\s*\)[\s\S]*?deleted_at/i.test(
        sql
      ),
      "the text check does not make room for cleared soft-deleted content"
    );
  });

  it("lets only the author edit, and the author or a GM soft-delete", () => {
    const sql = text();
    assert.ok(
      /FOR UPDATE[\s\S]*?author_id[\s\S]*?auth\.uid/i.test(sql),
      "no author UPDATE policy"
    );
    assert.ok(
      /FOR UPDATE[\s\S]*?is_campaign_gm/i.test(sql),
      "no GM UPDATE policy"
    );
    assert.ok(
      /GRANT[\s\S]*?UPDATE[\s\S]*?chat_posts[\s\S]*?authenticated|GRANT[\s\S]*?authenticated/i.test(
        sql
      ),
      "UPDATE is not granted to signed-in members"
    );
    assert.ok(!/FOR DELETE/i.test(sql), "a SQL DELETE policy bypasses RLS");
    assert.ok(!/\bTO\s+anon\b/i.test(sql), "signed-out writers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(sql), "everyone is granted access");
  });

  it("clears the content on delete and keeps deletes final", () => {
    const sql = text();
    assert.ok(/TRIGGER/i.test(sql), "no trigger enforcing the edit rules");
    assert.ok(
      /only the author may edit/i.test(sql),
      "nothing refuses edits from anyone but the author"
    );
    assert.ok(
      /only the author or a GM may delete/i.test(sql),
      "nothing refuses deletes from outsiders and fellow players"
    );
    assert.ok(
      /NEW\.text\s*:?=\s*''/i.test(sql),
      "a soft delete does not clear the content"
    );
    assert.ok(
      /deleted posts stay deleted/i.test(sql),
      "deleted posts can be edited or undeleted"
    );
  });
});
