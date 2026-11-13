import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  parseDocumentName,
  scopeConfig,
  verifySupabaseJwt,
} from "./note-access.js";

const SECRET = "test-secret-with-at-least-32-characters!!";

function mintJwt({ sub = "11111111-1111-1111-1111-111111111111", role = "authenticated", expOffsetSec = 3600, secret = SECRET } = {}) {
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64url({ alg: "HS256", typ: "JWT" })}.` +
    b64url({ sub, role, exp: now + expOffsetSec });
  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

describe("verifySupabaseJwt", () => {
  it("accepts a fresh HS256 token signed with the stack secret", () => {
    const sub = "22222222-2222-2222-2222-222222222222";
    const claims = verifySupabaseJwt(mintJwt({ sub }), SECRET);
    assert.ok(claims);
    assert.equal(claims.sub, sub);
  });

  it("rejects tokens signed with another secret", () => {
    assert.equal(verifySupabaseJwt(mintJwt(), "wrong-secret"), null);
  });

  it("rejects expired tokens", () => {
    assert.equal(verifySupabaseJwt(mintJwt({ expOffsetSec: -10 }), SECRET), null);
  });

  it("rejects anon and service-role keys: only a person's token connects", () => {
    assert.equal(
      verifySupabaseJwt(mintJwt({ role: "anon" }), SECRET),
      null
    );
    assert.equal(
      verifySupabaseJwt(mintJwt({ role: "service_role" }), SECRET),
      null
    );
  });

  it("rejects malformed tokens without throwing", () => {
    for (const bad of ["", "garbage", "a.b", "a.b.c.d", "....", null, undefined, 42]) {
      assert.equal(verifySupabaseJwt(bad, SECRET), null, `accepted ${bad}`);
    }
  });

  it("rejects tokens with a non-HS256 header", () => {
    const token = mintJwt();
    const [header, payload, sig] = token.split(".");
    const forged =
      `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${payload}.${sig}`;
    assert.equal(verifySupabaseJwt(forged, SECRET), null);
    assert.ok(header.length > 0);
  });
});

describe("parseDocumentName", () => {
  it("parses the persistent character and campaign scopes", () => {
    const id = "33333333-3333-3333-3333-333333333333";
    assert.deepEqual(parseDocumentName(`character-notes/${id}`), {
      scope: "character-notes",
      noteId: id,
    });
    assert.deepEqual(parseDocumentName(`campaign-notes/${id}`), {
      scope: "campaign-notes",
      noteId: id,
    });
  });

  it("parses the world note and description scopes too", () => {
    const id = "44444444-4444-4444-4444-444444444444";
    assert.deepEqual(parseDocumentName(`world-notes/${id}`), {
      scope: "world-notes",
      noteId: id,
    });
    assert.deepEqual(parseDocumentName(`world-descriptions/${id}`), {
      scope: "world-descriptions",
      noteId: id,
    });
  });
  it("leaves legacy world rooms unparsed: they sync live but persist elsewhere", () => {
    assert.equal(
      parseDocumentName("iron-fellowship-world1-lore-abc"),
      null
    );
  });

  it("rejects junk without throwing", () => {
    for (const bad of ["", "character-notes/", "character-notes/not-a-uuid", "../x", null, undefined]) {
      assert.equal(parseDocumentName(bad), null, `parsed ${bad}`);
    }
  });
});

describe("scopeConfig", () => {
  it("maps each persistent scope to its tables and access helpers", () => {
    const character = scopeConfig("character-notes");
    assert.ok(character.table.includes("character_note_contents"));
    assert.equal(character.idColumn, "note_id");
    assert.equal(character.contentColumn, "content");
    assert.ok(character.visibleFn.includes("is_character_note_visible"));
    assert.ok(character.writableFn.includes("is_character_note_owner"));
    const campaign = scopeConfig("campaign-notes");
    assert.ok(campaign.table.includes("campaign_note_contents"));
    assert.equal(campaign.idColumn, "note_id");
    assert.equal(campaign.contentColumn, "content");
    assert.ok(campaign.visibleFn.includes("is_campaign_note_visible"));
    assert.ok(campaign.writableFn.includes("is_campaign_note_writable"));
  });

  it("maps the world scopes to their tables and access helpers", () => {
    const notes = scopeConfig("world-notes");
    assert.ok(notes.table.includes("world_note_contents"));
    assert.equal(notes.idColumn, "note_id");
    assert.equal(notes.contentColumn, "content");
    assert.ok(notes.visibleFn.includes("is_world_note_visible"));
    assert.ok(notes.writableFn.includes("is_world_note_writable"));
    const descriptions = scopeConfig("world-descriptions");
    assert.ok(descriptions.table.includes("worlds"));
    assert.equal(descriptions.idColumn, "id");
    assert.equal(descriptions.contentColumn, "description");
    assert.ok(descriptions.visibleFn.includes("is_world_viewer"));
    assert.ok(descriptions.writableFn.includes("is_world_gm"));
  });

  it("returns null for transient scopes and junk", () => {
    assert.equal(scopeConfig("iron-fellowship-world1-lore-abc"), null);
    assert.equal(scopeConfig(""), null);
  });
});
