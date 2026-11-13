import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const rollsFile = () => {
  const files = readdirSync(dir).filter((f) => f.endsWith("_chat_rolls.sql"));
  assert.ok(files.length > 0, "no *_chat_rolls.sql migration");
  assert.equal(files.length, 1, "more than one *_chat_rolls.sql migration");
  return files[0];
};

const text = () => readFileSync(join(dir, rollsFile()), "utf8");

describe("chat roll posts migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(rollsFile(), /^\d{14}_chat_rolls\.sql$/);
  });

  it("carries the roll in its existing shape beside a GM-only flag", () => {
    const sql = text();
    assert.ok(/roll\s+jsonb/i.test(sql), "no roll jsonb column");
    assert.ok(
      /gms_only\s+boolean\s+NOT NULL\s+DEFAULT false/i.test(sql),
      "no gms_only boolean defaulting to open"
    );
  });

  it("lets a roll stand in for text but never an empty post", () => {
    const sql = text();
    assert.ok(
      /CHECK[\s\S]*?roll\s+IS NOT NULL/i.test(sql),
      "a roll cannot stand in for post text"
    );
  });

  it("hides GM-only roll posts from players over reads and writes", () => {
    const sql = text();
    assert.ok(
      /FOR SELECT[\s\S]*?NOT\s+[\w.]*gms_only[\s\S]*?is_campaign_gm/i.test(
        sql
      ),
      "SELECT does not narrow GM-only posts to GMs"
    );
    assert.ok(
      /FOR INSERT[\s\S]*?NOT\s+[\w.]*gms_only[\s\S]*?is_campaign_gm/i.test(
        sql
      ),
      "INSERT lets non-GMs post GM-only"
    );
    assert.ok(
      /FOR INSERT[\s\S]*?is_campaign_member/i.test(sql),
      "INSERT no longer requires campaign membership"
    );
    assert.ok(
      /FOR INSERT[\s\S]*?archived/i.test(sql),
      "INSERT no longer refuses archived channels"
    );
    assert.ok(!/FOR UPDATE/i.test(sql), "edits belong to a later ticket");
    assert.ok(!/FOR DELETE/i.test(sql), "deletes belong to a later ticket");
  });

  it("keeps posted dice immutable while text edits arrive later", () => {
    const sql = text();
    assert.ok(
      /OLD\.roll\s+IS DISTINCT FROM\s+NEW\.roll/i.test(sql),
      "nothing stops the roll from changing on update"
    );
    assert.ok(
      /OLD\.gms_only\s+IS DISTINCT FROM\s+NEW\.gms_only/i.test(sql),
      "nothing stops the GM-only flag from changing on update"
    );
  });
});
