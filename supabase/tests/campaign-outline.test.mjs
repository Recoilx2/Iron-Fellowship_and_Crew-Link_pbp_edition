import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// The campaign outline (ticket #131, part of spec #10) lands as its own
// migration: existing migrations are never edited, and it sorts after
// every migration on the branch, so filename order alone decides the
// outcome.
const outlineFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_campaign_outline.sql")
  );
  assert.ok(files.length > 0, "no *_campaign_outline.sql migration");
  assert.equal(
    files.length,
    1,
    "more than one *_campaign_outline.sql migration"
  );
  return files[0];
};

const text = () => readFileSync(join(dir, outlineFile()), "utf8");

describe("campaign outline migration (#131)", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention on a later stamp", () => {
    assert.match(outlineFile(), /^\d{14}_campaign_outline\.sql$/);
    const stamp = outlineFile().slice(0, 14);
    // Migrations that landed after the outline (the #133 outline
    // versions) sort later by design, so they are excluded here.
    const landedLater = new Set([
      "20261121000006_assistant_outline_versions.sql",
      "20261121000007_assistant_proposal_state.sql",
    ]);
    // The outline is the latest migration on the branch: nothing landed
    // after it, so nothing is excluded here. A later migration re-adds
    // this file to its own landedLater set, following the branch pattern.
    const others = readdirSync(dir).filter(
      (f) => /^\d{14}_/.test(f) && f !== outlineFile() && !landedLater.has(f)
    );
    assert.ok(others.length > 0, "no earlier migrations to sort after");
    for (const other of others) {
      assert.ok(
        stamp > other.slice(0, 14),
        `${outlineFile()} does not sort after ${other}`
      );
    }
  });

  it("marks the outline with a kind column that ordinary notes never take", () => {
    const sql = text();
    assert.ok(
      /ADD COLUMN IF NOT EXISTS kind/i.test(sql),
      "no kind column is added to campaign notes"
    );
    assert.ok(
      /CHECK[\s\S]*?kind IN \('note',\s*'outline'\)/i.test(sql),
      "kind is not limited to note and outline"
    );
  });

  it("keeps at most one outline per campaign, never shared", () => {
    const sql = text();
    assert.ok(
      /CREATE UNIQUE INDEX[\s\S]*?campaign_notes[\s\S]*?WHERE kind = 'outline'/i.test(sql),
      "no partial unique index keeps one outline per campaign"
    );
    assert.ok(
      /CHECK[\s\S]*?kind <> 'outline' OR shared = false/i.test(sql),
      "no check keeps the outline unshared"
    );
    assert.ok(
      /kind cannot be changed/i.test(sql),
      "the update guard does not lock kind"
    );
    assert.ok(
      /never shared/i.test(sql),
      "the update guard does not refuse sharing the outline"
    );
  });

  it("restricts every outline write to GMs of the campaign", () => {
    const sql = text();
    for (const op of ["INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(
          `campaign_notes[\\s\\S]*?FOR ${op}\\b[\\s\\S]*?kind IS DISTINCT FROM 'outline' OR private\\.is_campaign_gm`,
          "i"
        ).test(sql),
        `${op} on campaign notes does not require GM membership for outline rows`
      );
    }
  });
});
