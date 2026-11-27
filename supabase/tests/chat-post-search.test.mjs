import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const searchFile = () => {
  const files = readdirSync(dir).filter((f) => f.endsWith("_chat_post_search.sql"));
  assert.ok(files.length > 0, "no *_chat_post_search.sql migration");
  assert.equal(files.length, 1, "more than one *_chat_post_search.sql migration");
  return files[0];
};

const sql = () => readFileSync(join(dir, searchFile()), "utf8");

describe("chat post search migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(searchFile(), /^\d{14}_chat_post_search\.sql$/);
  });

  it("adds pg_trgm and its GIN index only when the extension is available", () => {
    const text = sql();
    assert.ok(
      /DO\s*\$\$[\s\S]*?CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions[\s\S]*?EXCEPTION[\s\S]*?RAISE NOTICE[\s\S]*?\$\$/i.test(
        text
      ),
      "pg_trgm creation is not guarded so a contrib-less Postgres can migrate"
    );
    assert.ok(
      /DO\s*\$\$[\s\S]*?SELECT[\s\S]*?pg_extension[\s\S]*?IF\s+trgm_schema\s+IS\s+NOT\s+NULL[\s\S]*?CREATE INDEX IF NOT EXISTS chat_posts_text_trgm[\s\S]*?USING gin[\s\S]*?\$\$/i.test(
        text
      ),
      "the trigram index is not guarded on the extension being present"
    );
    assert.ok(
      /chat_posts_text_trgm[\s\S]*?USING gin[\s\S]*?gin_trgm_ops/i.test(text),
      "the index does not use the trigram operator class"
    );
  });

  it("keeps the search invoker-scoped through the existing post RLS", () => {
    const text = sql();
    assert.ok(
      /CREATE OR REPLACE FUNCTION public\.search_campaign_posts\([\s\S]*?\)\s*RETURNS SETOF public\.chat_posts/i.test(
        text
      ),
      "no search function returning whole post rows"
    );
    assert.ok(/SECURITY INVOKER/i.test(text), "search must not run as definer");
    assert.ok(
      /SET\s+search_path\s*=\s*''/i.test(text),
      "search does not pin its search path"
    );
    assert.ok(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.search_campaign_posts[\s\S]*?FROM PUBLIC/i.test(
        text
      ),
      "search is still executable by PUBLIC"
    );
    assert.ok(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.search_campaign_posts[\s\S]*?TO authenticated/i.test(
        text
      ),
      "signed-in members were not granted search"
    );
    assert.ok(
      !/SECURITY DEFINER/i.test(text),
      "a definer helper would bypass the post visibility policy"
    );
    assert.ok(
      /JOIN public\.chat_channels[\s\S]*?ch\.campaign_id\s*=\s*p_campaign_id/i.test(
        text
      ),
      "results are not scoped to the requested campaign"
    );
    assert.ok(
      /p\.deleted_at\s+IS\s+NULL/i.test(text),
      "soft-deleted posts would be searchable"
    );
  });

  it("builds an escaped substring pattern with a blank guard and a keyset", () => {
    const text = sql();
    assert.ok(
      /nullif\([\s\S]*?btrim\(p_query\)[\s\S]*?''[\s\S]*?\)/i.test(text),
      "a blank query is not refused"
    );
    assert.ok(
      /replace\([\s\S]*?replace\([\s\S]*?replace\([\s\S]*?'\\'[\s\S]*?'\\\\'[\s\S]*?'%'[\s\S]*?'\\%'[\s\S]*?'_'[\s\S]*?'\\_'/i.test(
        text
      ),
      "backslash, percent and underscore are not escaped before ILIKE"
    );
    assert.ok(
      /p\.text\s+ILIKE[\s\S]*?'%'[\s\S]*?q\.pattern[\s\S]*?'%'[\s\S]*?ESCAPE/i.test(
        text
      ),
      "the pattern is not an escaped contains-match"
    );
    assert.ok(
      /\(p\.created_at,\s*p\.id\)\s*<\s*\(p_before_created_at,\s*p_before_id\)/i.test(
        text
      ),
      "paging does not use the (created_at, id) keyset"
    );
    assert.ok(
      /ORDER BY p\.created_at DESC,\s*p\.id DESC/i.test(text),
      "results are not newest-first"
    );
    assert.ok(
      /LIMIT least\(greatest\(coalesce\(p_limit, 20\), 1\), 50\) \+ 1/i.test(
        text
      ),
      "the page is not clamped with a one-row lookahead"
    );
  });
});
