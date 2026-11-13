import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const profilesFile = () => {
  const files = readdirSync(dir).filter((f) => f.endsWith("_profiles.sql"));
  assert.ok(files.length > 0, "no *_profiles.sql migration");
  assert.equal(files.length, 1, "more than one *_profiles.sql migration");
  return files[0];
};

// Follow-up migrations keep the base file's name; read the whole chain so
// the asserted rules are the ones a fresh database ends up with.
const profilesChain = () => {
  const files = readdirSync(dir)
    .filter((f) => /profiles.*\.sql$/.test(f))
    .sort();
  assert.ok(files.length > 0, "no profiles migrations");
  return files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
};

describe("profiles migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(profilesFile(), /^\d{14}_profiles\.sql$/);
  });

  it("creates public.profiles keyed to the auth user", () => {
    const text = readFileSync(join(dir, profilesFile()), "utf8");
    assert.ok(/CREATE TABLE/i.test(text), "no CREATE TABLE");
    assert.ok(/public\.profiles/.test(text), "not in the public schema");
    assert.ok(/REFERENCES\s+auth\.users/i.test(text), "not keyed to auth.users");
    assert.ok(/ON DELETE CASCADE/i.test(text), "orphan rows survive account deletion");
    assert.ok(/display_name/i.test(text), "no display name column");
  });

  it("lets every signed-in person read display names but only owners write", () => {
    const text = profilesChain();
    assert.ok(
      /ENABLE ROW LEVEL SECURITY/i.test(text),
      "row-level security not enabled"
    );
    // Names are shown to other players (rosters, avatars, game log), so
    // reads are open to every signed-in person; writes stay owner-only.
    assert.ok(
      /FOR SELECT[\s\S]*?TO authenticated[\s\S]*?USING\s*\(\s*true\s*\)/i.test(
        text
      ),
      "SELECT is not open to every signed-in person"
    );
    for (const op of ["INSERT", "UPDATE"]) {
      assert.ok(
        new RegExp(`FOR ${op}\\b[\\s\\S]*?auth\\.uid\\(\\)\\s*=\\s*id`, "i").test(text),
        `${op} is not restricted to the row owner`
      );
    }
    assert.ok(!/FOR DELETE/i.test(text), "profiles can be deleted");
    assert.ok(!/\bTO\s+anon\b/i.test(text), "signed-out readers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(text), "everyone is granted access");
  });

  it("creates a profile row automatically on signup", () => {
    const text = readFileSync(join(dir, profilesFile()), "utf8");
    assert.ok(/TRIGGER/i.test(text), "no signup trigger");
    assert.ok(/auth\.users/.test(text), "trigger is not on the auth users table");
    assert.ok(/display_name/.test(text), "trigger does not carry the display name");
  });
});
