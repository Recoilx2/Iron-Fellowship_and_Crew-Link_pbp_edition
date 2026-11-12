import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const homebrewFile = () => {
  const files = readdirSync(dir).filter((f) => f.endsWith("_homebrew.sql"));
  assert.ok(files.length > 0, "no *_homebrew.sql migration");
  assert.equal(files.length, 1, "more than one *_homebrew.sql migration");
  return files[0];
};

describe("homebrew migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(homebrewFile(), /^\d{14}_homebrew\.sql$/);
  });

  it("creates the collections, editors, viewers and invite-key tables", () => {
    const text = readFileSync(join(dir, homebrewFile()), "utf8");
    for (const table of ["homebrew_collections", "homebrew_editors", "homebrew_viewers", "homebrew_invite_keys"]) {
      assert.ok(
        new RegExp(`CREATE TABLE[\\s\\S]*?public\\.${table}\\b`, "i").test(text),
        `no public.${table} table`
      );
    }
    assert.ok(
      /REFERENCES\s+auth\.users/i.test(text),
      "membership rows are not keyed to auth.users"
    );
    assert.ok(/ON DELETE CASCADE/i.test(text), "deleting a person or collection leaves rows behind");
  });

  it("creates one content table per homebrew collection type", () => {
    const text = readFileSync(join(dir, homebrewFile()), "utf8");
    for (const table of [
      "homebrew_stats",
      "homebrew_condition_meters",
      "homebrew_non_linear_meters",
      "homebrew_impact_categories",
      "homebrew_legacy_tracks",
      "homebrew_move_categories",
      "homebrew_moves",
      "homebrew_oracle_collections",
      "homebrew_oracle_tables",
      "homebrew_asset_collections",
      "homebrew_assets",
    ]) {
      assert.ok(
        new RegExp(`CREATE TABLE[\\s\\S]*?public\\.${table}\\b`, "i").test(text),
        `no public.${table} table`
      );
      assert.ok(
        new RegExp(`${table}[\\s\\S]*?REFERENCES[\\s\\S]*?homebrew_collections`, "i").test(text),
        `${table} is not tied to its collection`
      );
    }
  });

  it("reads publicly and restricts writes to collection editors", () => {
    const text = readFileSync(join(dir, homebrewFile()), "utf8");
    assert.ok(/ENABLE ROW LEVEL SECURITY/i.test(text), "row-level security not enabled");
    assert.ok(
      /FOR SELECT[\s\S]*?TO\s+anon/i.test(text),
      "homebrew content is not publicly readable"
    );
    assert.ok(
      /private\.is_homebrew_editor/i.test(text),
      "no editor-membership helper guards writes"
    );
    assert.ok(/SECURITY DEFINER/i.test(text), "helpers are not security definer");
    assert.ok(
      /search_path\s*=\s*(''|"")/i.test(text),
      "helpers do not pin an empty search path"
    );
    assert.ok(
      /\(select auth\.uid\(\)\)/i.test(text),
      "helpers do not wrap auth.uid() as a subquery"
    );
    // Editors and invite keys change only through the database functions.
    for (const op of ["INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        !new RegExp(`homebrew_editors[\\s\\S]{0,400}?FOR ${op}\\b[\\s\\S]{0,200}?TO authenticated`, "i").test(text),
        `homebrew_editors allows direct ${op}`
      );
    }
  });

  it("only the creator can delete a collection", () => {
    const text = readFileSync(join(dir, homebrewFile()), "utf8");
    assert.ok(
      /FOR DELETE[\s\S]*?creator\s*=\s*\(select auth\.uid\(\)\)/i.test(text),
      "collection delete is not restricted to the creator"
    );
  });

  it("replaces the invite-key cloud functions with database functions", () => {
    const text = readFileSync(join(dir, homebrewFile()), "utf8");
    for (const fn of [
      "homebrew_create_invite_key",
      "homebrew_collection_id_from_key",
      "homebrew_accept_invite",
      "homebrew_remove_editor",
    ]) {
      assert.ok(
        new RegExp(`FUNCTION\\s+public\\.${fn}\\s*\\(`, "i").test(text),
        `${fn} is not a public database function`
      );
    }
    assert.ok(
      /GRANT EXECUTE[\s\S]*?TO authenticated/i.test(text),
      "signed-in people cannot call the invite functions"
    );
    // Single-use keys: accepting spends the key.
    assert.ok(
      /homebrew_accept_invite[\s\S]*?DELETE FROM\s+public\.homebrew_invite_keys/i.test(text),
      "accepting an invite does not spend the key"
    );
  });

  it("adds the creator as an editor on collection creation", () => {
    const text = readFileSync(join(dir, homebrewFile()), "utf8");
    assert.ok(/TRIGGER/i.test(text), "no triggers");
    assert.ok(
      /AFTER INSERT ON public\.homebrew_collections/i.test(text),
      "no bootstrap trigger on collection creation"
    );
  });

  it("keeps updated_at fresh and publishes rows for live updates", () => {
    const text = readFileSync(join(dir, homebrewFile()), "utf8");
    assert.ok(/updated_at/i.test(text), "no updated_at bookkeeping");
    assert.ok(/REPLICA IDENTITY FULL/i.test(text), "no full replica identity for deletes");
    assert.ok(/supabase_realtime/i.test(text), "tables are not added to the live publication");
  });

  it("guards the homebrew image bucket with access rules", () => {
    const text = readFileSync(join(dir, homebrewFile()), "utf8");
    assert.ok(/homebrew-images/.test(text), "no homebrew-images bucket");
    assert.ok(/storage\.objects/i.test(text), "no access rules on storage objects");
    assert.ok(
      /homebrew_ensure_image_bucket/i.test(text),
      "no idempotent bucket setup for stacks where storage boots after migrations"
    );
  });
});
