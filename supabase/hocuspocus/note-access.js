/**
 * Pure access helpers for the Hocuspocus note server (server.js).
 *
 * Kept free of network and database handles so the rules below are
 * unit-testable without a stack: sign-in token verification, document-name
 * routing and the per-scope table/helper mapping.
 *
 * Decisions (see the ticket #20 PR, token shape updated in ticket #152):
 * - Tokens are the stack's Supabase access tokens, signed by GoTrue with
 *   the asymmetric RSA key (RS256) and verified here against the public
 *   JWKS only. Only the "authenticated" role connects: anon and
 *   service-role keys never open a note document.
 * - Access goes through the database's own visibility helpers (the same
 *   private.* functions the row-level security policies call), but over a
 *   direct privileged connection instead of PostgREST-as-user: one rule
 *   source, no extra HTTP hop on every connect and revocation.
 * - Document names are `<scope>/<note uuid>` for the persistent scopes.
 *   Anything else (legacy world rooms) syncs live but is never read from
 *   or written to the database. The `table`/`idColumn`/`contentColumn`
 *   triple says where one document's bytes live; `notesTable` names the
 *   parent row that must still exist before a store (null when the bytes
 *   live beside their own parent, like the world description).
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const SCOPES = {
  "character-notes": {
    table: "public.character_note_contents",
    idColumn: "note_id",
    contentColumn: "content",
    notesTable: "public.character_notes",
    visibleFn: "private.is_character_note_visible",
    writableFn: "private.is_character_note_owner",
  },
  "campaign-notes": {
    table: "public.campaign_note_contents",
    idColumn: "note_id",
    contentColumn: "content",
    notesTable: "public.campaign_notes",
    visibleFn: "private.is_campaign_note_visible",
    writableFn: "private.is_campaign_note_writable",
  },
  "world-notes": {
    table: "public.world_note_contents",
    idColumn: "note_id",
    contentColumn: "content",
    notesTable: "public.world_notes",
    visibleFn: "private.is_world_note_visible",
    writableFn: "private.is_world_note_writable",
  },
  "world-descriptions": {
    table: "public.worlds",
    idColumn: "id",
    contentColumn: "description",
    notesTable: null,
    visibleFn: "private.is_world_viewer",
    writableFn: "private.is_world_gm",
  },
};

/**
 * Returns the scope config for a persistent document, or null for transient
 * (world) rooms and junk.
 */
export function scopeConfig(scope) {
  return Object.hasOwn(SCOPES, scope) ? SCOPES[scope] : null;
}

/**
 * Splits a Hocuspocus document name into its scope and note id, or returns
 * null when the document is not a persisted note.
 */
export function parseDocumentName(name) {
  if (typeof name !== "string") return null;
  const slash = name.indexOf("/");
  if (slash === -1) return null;
  const scope = name.slice(0, slash);
  const noteId = name.slice(slash + 1);
  if (!scopeConfig(scope)) return null;
  if (!UUID_PATTERN.test(noteId)) return null;
  return { scope, noteId: noteId.toLowerCase() };
}

/**
 * Verifies a Supabase access token against the stack's public JWKS (RS256;
 * ticket #152). GoTrue signs with the stack's RSA-3072 key and only its
 * public half reaches this server. Returns the claims
 * ({ sub, role, exp, ... }) or null when the token is missing, malformed,
 * mis-signed, expired, or not a person's token. Never throws:
 * authentication failures must close the connection, not the server.
 *
 * `jwks` is the parsed JWT_JWKS value: an array of RSA public JWKs
 * ({ kty, kid, alg, n, e }). The token's `kid` must name one of them.
 */
export function verifySupabaseJwt(token, jwks) {
  if (typeof token !== "string" || !Array.isArray(jwks) || jwks.length === 0) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  // RS256 only: an HS256 token — signed with any secret — is refused by
  // the algorithm check before any key is touched.
  if (!header || header.alg !== "RS256") return null;
  if (typeof header.kid !== "string" || header.kid === "") return null;
  const jwk = jwks.find((key) => key?.kid === header.kid && key?.kty === "RSA");
  if (!jwk) return null;
  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return null;
  }
  let valid = false;
  try {
    valid = cryptoVerify("sha256", Buffer.from(`${headerB64}.${payloadB64}`), publicKey, Buffer.from(signatureB64, "base64url"));
  } catch {
    return null;
  }
  if (!valid) return null;
  if (!payload || typeof payload !== "object") return null;
  if (payload.role !== "authenticated") return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    return null;
  }
  if (typeof payload.sub !== "string" || !UUID_PATTERN.test(payload.sub)) {
    return null;
  }
  return payload;
}
