import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { liveStackConfig, type LiveStackConfig } from "api-calls/testing/liveHarness";

/**
 * Live: every service refuses HS256 tokens (ticket #152).
 *
 * The stack's user tokens are RS256, signed by GoTrue's private key; the
 * shared HS256 secret is gone. These tests send well-formed HS256 tokens —
 * signed with upstream's well-known seed constant and, for Storage, with
 * the stack's own static secret — and expect refusal everywhere, so a
 * drifted fork or a re-enabled fallback fails CI instead of silently
 * reopening forgeable tokens.
 */

const config = liveStackConfig() as LiveStackConfig | null;

/** Upstream's well-known seed constant: what a drifted fork would accept. */
const WELL_KNOWN_SEED_SECRET =
  "super-secret-jwt-token-with-at-least-32-characters-long";

function mintHs256(
  claims: Record<string, unknown>,
  secret: string
): string {
  const b64url = (value: string) =>
    Buffer.from(value).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function readStorageAuthSecret(): string {
  const envFile = process.env.LIVE_ENV_FILE;
  if (!envFile) return "";
  for (const line of readFileSync(`${envFile}.storage`, "utf8").split("\n")) {
    if (line.startsWith("AUTH_JWT_SECRET=")) {
      return line.slice("AUTH_JWT_SECRET=".length).trim();
    }
  }
  return "";
}

function forgedToken(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  return mintHs256(
    {
      role: "authenticated",
      iss: "supabase",
      sub: "99999999-9999-4222-8222-999999999999",
      iat: now,
      exp: now + 3600,
    },
    secret
  );
}

describe.skipIf(!config)("HS256 tokens are refused everywhere", () => {
  const cfg = config as LiveStackConfig;

  it("GoTrue refuses an HS256 access token", async () => {
    const base = cfg.url.replace(/\/+$/, "");
    const res = await fetch(`${base}/auth/v1/user`, {
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${forgedToken(WELL_KNOWN_SEED_SECRET)}`,
      },
    });
    expect(res.status).toBe(401);
  });

  it("PostgREST refuses an HS256 access token", async () => {
    const base = cfg.url.replace(/\/+$/, "");
    const res = await fetch(`${base}/rest/v1/profiles?select=uid&limit=1`, {
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${forgedToken(WELL_KNOWN_SEED_SECRET)}`,
      },
    });
    expect(res.status).toBe(401);
  });

  it("Realtime refuses an HS256 connect token", { timeout: 30000 }, async () => {
    // Signed with upstream's well-known seed constant: if the seed fork
    // drifted (upstream's seed ran, the tenant's jwt_secret came back), a
    // token like this would verify again and this test fails CI.
    const base = cfg.url.replace(/\/+$/, "");
    const ws = new WebSocket(
      `${base.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(
        forgedToken(WELL_KNOWN_SEED_SECRET)
      )}&vsn=2.0.0`
    );
    const opened = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(true);
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    try {
      expect(opened).toBe(false);
    } finally {
      ws.close();
    }
  });

  it("Storage refuses an HS256 token signed with its own static secret", async () => {
    const base = cfg.url.replace(/\/+$/, "");
    const storageSecret = readStorageAuthSecret();
    expect(storageSecret).toBeTruthy();
    const res = await fetch(
      `${base}/storage/v1/object/chat-images/${crypto.randomUUID()}/${crypto.randomUUID()}/missing.png`,
      {
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${forgedToken(storageSecret)}`,
        },
      }
    );
    expect(res.status).toBe(403);
  });
});
