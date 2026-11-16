/**
 * Caller verification and the GM membership check for the GM assistant
 * function (spec #10). Split out of `handler.ts` (ticket #151): the JWT is
 * verified in code (the gateway's VERIFY_JWT flag is off) and GM
 * membership is checked before anything else on every route.
 */
import type { GmAssistantEnv, UpstreamFetch } from "./env.ts";
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
  let headerJson: { alg?: string };
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
  if (!headerJson || headerJson.alg !== "HS256") return null;
  if (!env.jwtSecret) return null;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
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
