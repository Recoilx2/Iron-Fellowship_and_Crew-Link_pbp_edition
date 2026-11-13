import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const dropFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_campaign_roll_log_view.sql")
  );
  assert.ok(files.length > 0, "no *_campaign_roll_log_view.sql migration");
  assert.equal(
    files.length,
    1,
    "more than one *_campaign_roll_log_view.sql migration"
  );
  return files[0];
};

const text = () => readFileSync(join(dir, dropFile()), "utf8");

describe("campaign roll log view migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(dropFile(), /^\d{14}_campaign_roll_log_view\.sql$/);
  });

  it("drops the campaign roll log table instead of migrating it", () => {
    const sql = text();
    assert.ok(
      /DROP TABLE[\s\S]*?public\.campaign_rolls/i.test(sql),
      "the campaign_rolls table is not dropped"
    );
    assert.ok(
      !/CREATE TABLE[\s\S]*?campaign_rolls/i.test(sql),
      "the campaign_rolls table is recreated"
    );
    assert.ok(
      !/CREATE POLICY[^;]*?campaign_rolls/i.test(sql),
      "roll log access rules survive the drop"
    );
  });

  it("leaves the solo roll log and the chat posts alone", () => {
    const sql = text();
    // Comment lines explain what stays; only statements can touch tables.
    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .split(";");
    assert.ok(
      !statements.some(
        (statement) =>
          /character_rolls/i.test(statement) &&
          /(CREATE|ALTER|DROP)\s+(TABLE|POLICY|TRIGGER|INDEX)/i.test(statement)
      ),
      "the solo roll log is touched"
    );
    assert.ok(
      !statements.some((statement) =>
        /ALTER TABLE[\s\S]*?chat_posts/i.test(statement)
      ),
      "chat posts are altered"
    );
  });
});
