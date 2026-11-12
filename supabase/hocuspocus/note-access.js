/**
 * Pure access helpers for the Hocuspocus note server (server.js).
 *
 * Kept free of network and database handles so the rules below are
 * unit-testable without a stack: sign-in token verification, document-name
 * routing and the per-scope table/helper mapping.
 *
 * Decisions (see the ticket #20 PR):
 * - Tokens are the stack's HS256 Supabase access tokens, verified with the
 *   same JWT_SECRET GoTrue signs with. Only the "authenticated" role
 *   connects: anon and service-role keys never open a note document.
 * - Access goes through the database's own visibility helpers (the same
 *   private.* functions the row-level security policies call), but over a
 *   direct privileged connection instead of PostgREST-as-user: one rule
 *   source, no extra HTTP hop on every connect and revocation.
 * - Document names are `<scope>/<note uuid>` for the persistent scopes.
 *   Anything else (world rooms until the worlds ticket ports them) syncs
 *   live but is never read from or written to the database.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const SCOPES = {
  "character-notes": {
    notesTable: "public.character_notes",
    contentsTable: "public.character_note_contents",
    visibleFn: "private.is_character_note_visible",
    writableFn: "private.is_character_note_owner",
  },
  "campaign-notes": {
    notesTable: "public.campaign_notes",
    contentsTable: "public.campaign_note_contents",
    visibleFn: "private.is_campaign_note_visible",
    writableFn: "private.is_campaign_note_writable",
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
 * Verifies a Supabase access token against the stack's HS256 secret.
 * Returns the claims ({ sub, role, exp, ... }) or null when the token is
 * missing, malformed, mis-signed, expired, or not a person's token.
 * Never throws: authentication failures must close the connection, not the
 * server.
 */
export function verifySupabaseJwt(token, secret) {
  if (typeof token !== "string" || typeof secret !== "string" || !secret) {
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
  if (!header || header.alg !== "HS256") return null;
  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  if (signatureB64.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signatureB64), Buffer.from(expected))) {
    return null;
  }
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
