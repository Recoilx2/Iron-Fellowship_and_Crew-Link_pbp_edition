import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = join(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(testsDir, "..", "migrations");
const repoDir = join(testsDir, "..", "..");
const readRepo = (p) => readFileSync(join(repoDir, p), "utf8");

// The #118 fix lands as its own migration: existing migrations are never
// edited, and the final chat policies sort after every migration on the
// branch, so filename order alone decides the outcome.
const accessFile = () => {
  const files = readdirSync(migrationsDir).filter((f) =>
    f.endsWith("_chat_image_access.sql")
  );
  assert.ok(files.length > 0, "no *_chat_image_access.sql migration");
  assert.equal(files.length, 1, "more than one *_chat_image_access.sql migration");
  return files[0];
};

const sql = () => readFileSync(join(migrationsDir, accessFile()), "utf8");

describe("chat image access rules (#118)", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention on a later stamp", () => {
    assert.match(accessFile(), /^\d{14}_chat_image_access\.sql$/);
    const stamp = accessFile().slice(0, 14);
    // Migrations that landed after #118 (e.g. #120 roll cleanup,
    // 20261115000000) sort later by design, so they are excluded here.
    const landedLater = new Set(["20261115000000_chat_roll_cleanup.sql"]);
    const others = readdirSync(migrationsDir).filter(
      (f) => /^\d{14}_/.test(f) && f !== accessFile() && !landedLater.has(f)
    );
    for (const other of others) {
      assert.ok(
        stamp > other.slice(0, 14),
        `${accessFile()} does not sort after ${other}`
      );
    }
  });

  it("replaces the campaign-member-only storage rules", () => {
    const text = sql();
    for (const op of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(`FOR ${op}\\b`, "i").test(text),
        `no ${op} rule on the chat-images bucket`
      );
    }
    assert.ok(/storage\.objects/i.test(text), "rules are not on storage.objects");
    assert.ok(
      !/\bTO\s+anon\b/i.test(text),
      "signed-out readers are granted access"
    );
    assert.ok(
      !/\bTO\s+PUBLIC\b/i.test(text),
      "everyone is granted access"
    );
  });

  it("reads through the channel visibility and GM-only rules", () => {
    const text = sql();
    assert.ok(
      /private\.can_read_channel/i.test(text),
      "reads do not go through private.can_read_channel"
    );
    assert.ok(/gms_only/i.test(text), "GM-only roll posts are not narrowed");
    assert.ok(
      /image_paths/i.test(text),
      "reads are not bound to the post's attached image paths"
    );
  });

  it("keeps pending uploads readable only by their uploader", () => {
    const text = sql();
    assert.ok(
      /owner\s*=\s*\(select auth\.uid\(\)\)/i.test(text),
      "no uploader-only (owner) read rule for unattached images"
    );
  });

  it("lets nobody overwrite or delete another person's image", () => {
    const text = sql();
    assert.ok(
      /FOR UPDATE[\s\S]*?owner\s*=\s*\(select auth\.uid\(\)\)/i.test(text),
      "overwrites are not restricted to the uploader"
    );
    assert.ok(
      /FOR DELETE[\s\S]*?owner\s*=\s*\(select auth\.uid\(\)\)/i.test(text),
      "deletes are not open to the uploader"
    );
    assert.ok(
      /author_id\s*=\s*\(select auth\.uid\(\)\)/i.test(text),
      "a post's author cannot remove its files"
    );
    assert.ok(
      /is_campaign_gm/i.test(text),
      "a campaign GM cannot remove a post's files"
    );
  });

  it("caps the bucket at the deployment's image size, not a hard-coded value", () => {
    const text = sql();
    assert.ok(
      /CHAT_IMAGE_MAX_MB/.test(text),
      "the bucket cap does not read the CHAT_IMAGE_MAX_MB deployment setting"
    );
    assert.ok(
      !/file_size_limit\s*=\s*10485760/.test(text),
      "the 10 MB cap is still hard-coded in the migration"
    );
  });

  it("restricts the bucket to the composer's image types", () => {
    const text = sql();
    assert.ok(
      /allowed_mime_types/i.test(text),
      "the bucket does not set allowed_mime_types"
    );
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      assert.ok(text.includes(mime), `${mime} is not an allowed bucket type`);
    }
  });

  it("takes the size cap from one deployment setting the bucket and client share", () => {
    const example = readRepo("supabase/.env.example");
    assert.ok(
      /^CHAT_IMAGE_MAX_MB=\d+$/m.test(example),
      "CHAT_IMAGE_MAX_MB default missing from supabase/.env.example"
    );
    const compose = readRepo("supabase/docker-compose.yml");
    assert.ok(
      /CHAT_IMAGE_MAX_MB/.test(compose),
      "docker-compose.yml does not pass CHAT_IMAGE_MAX_MB through"
    );
    const apply = readRepo("supabase/migrate/apply.sh");
    assert.ok(
      /CHAT_IMAGE_MAX_MB/.test(apply),
      "supabase/migrate/apply.sh does not hand CHAT_IMAGE_MAX_MB to psql"
    );
    const dockerfile = readRepo("supabase/site/Dockerfile");
    assert.ok(
      /VITE_CHAT_IMAGE_MAX_MB/.test(dockerfile),
      "the site build does not bake in VITE_CHAT_IMAGE_MAX_MB"
    );
    const limits = readRepo("src/api-calls/chat/chatImageLimits.ts");
    assert.ok(
      /VITE_CHAT_IMAGE_MAX_MB/.test(limits),
      "the client cap does not read VITE_CHAT_IMAGE_MAX_MB"
    );
  });

  it("never edits the original chat-images migration", () => {
    const original = readFileSync(
      join(migrationsDir, "20261113170000_chat_images.sql"),
      "utf8"
    );
    assert.ok(
      !/can_read_channel|chat_image_access|allowed_mime_types/.test(original),
      "20261113170000_chat_images.sql was edited instead of superseded"
    );
  });

  it("leaves the *_chat_images.sql static contract alone", () => {
    const files = readdirSync(migrationsDir).filter((f) =>
      f.endsWith("_chat_images.sql")
    );
    assert.equal(files.length, 1, "expected exactly one *_chat_images.sql migration");
    assert.ok(
      existsSync(join(testsDir, "chat-images.test.mjs")),
      "the original chat-images static test is gone"
    );
  });
});
