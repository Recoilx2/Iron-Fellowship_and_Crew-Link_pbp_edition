/**
 * Caller verification and the GM membership check for the GM assistant
 * function (spec #10). Split out of `handler.ts` (ticket #151): the JWT is
 * verified in code (the gateway's VERIFY_JWT flag is off) and GM
 * membership is checked before anything else on every route.
 *
 * Tokens are RS256 (ticket #152): GoTrue signs access tokens with the
 * stack's RSA-3072 key and every verifier holds only the public JWKS. An
 * HS256 token — signed with any secret — is refused by the algorithm check.
 */
import type { GmAssistantEnv, JwkSet, RsaPublicJwk, UpstreamFetch } from "./env.ts";
import { postgrest } from "./postgrest.ts";

export const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * One reference code per error response, minted here so the log line and
 * the body a GM sees carry the same value. Base32 without I, O, 0 and 1,
 * so a reference read aloud survives.
 */
export function mintReference(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((b) => "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 32])
    .join("");
}

export function base64UrlDecodeToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface VerifiedCaller {
  sub: string;
}

/**
 * Picks the JWK the token claims (by `kid`) from the stack's public JWKS.
 * Every token GoTrue mints carries the signing key's `kid`, so a token
 * without a known kid is not one of ours. Returns null when no key matches.
 */
function selectJwk(
  jwks: JwkSet,
  kid: string | undefined,
): RsaPublicJwk | null {
  if (kid) {
    return jwks.find((jwk) => jwk.kid === kid) ?? null;
  }
  return jwks.length === 1 ? jwks[0] : null;
}

export async function verifyCaller(
  req: Request,
  env: GmAssistantEnv,
): Promise<VerifiedCaller | null> {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  let headerJson: { alg?: string; kid?: string };
  let payload: { role?: string; exp?: number; sub?: string };
  try {
    headerJson = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToBytes(headerB64)),
    );
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToBytes(payloadB64)),
    );
  } catch {
    return null;
  }
  // RS256 only (ticket #152): the stack's tokens are signed with the
  // GoTrue RSA key; an HS256 token — signed with any secret, old or new —
  // is refused before any key material is touched.
  if (!headerJson || headerJson.alg !== "RS256") return null;
  const jwk = selectJwk(env.jwtJwks, headerJson.kid);
  if (!jwk) return null;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlDecodeToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  if (!payload || payload.role !== "authenticated") return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    return null;
  }
  if (typeof payload.sub !== "string" || !UUID_PATTERN.test(payload.sub)) {
    return null;
  }
  return { sub: payload.sub };
}

/**
 * The server-side gate beside the access rules (spec #10, story 4): only
 * GMs of the campaign pass, and every assistant route checks this before
 * reading or writing anything.
 */
export async function isCampaignGm(
  env: GmAssistantEnv,
  callerToken: string,
  userId: string,
  campaignId: string,
  fetchImpl: UpstreamFetch,
): Promise<boolean> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `campaign_members?campaign_id=eq.${encodeURIComponent(campaignId)}&user_id=eq.${encodeURIComponent(userId)}&select=role`,
    fetchImpl,
  );
  if (status !== 200) return false;
  return rows.some((row) => row.role === "gm");
}
