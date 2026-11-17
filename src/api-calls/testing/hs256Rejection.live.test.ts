import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

import {
  adminClient,
  createPerson,
  deletePerson,
  liveStackConfig,
  personToken,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";

/**
 * Live: every service refuses HS256 tokens (ticket #152).
 *
 * The stack's user tokens are RS256, signed by GoTrue's private key; the
 * shared HS256 secret is gone. These tests send well-formed HS256 tokens —
 * signed with secrets the stack actually holds or would hold if a fork
 * drifted — and expect refusal everywhere, so a re-enabled fallback fails
 * CI instead of silently reopening forgeable tokens:
 *
 * - GoTrue: signed with GOTRUE_JWT_SECRET (the boot-required dead value in
 *   the GoTrue-only env file). A GoTrue without the RS256 method pin would
 *   accept this via its HS256 fallback; the pin is what refuses it.
 * - PostgREST: signed with upstream's well-known seed constant. PostgREST
 *   holds no symmetric key at all, so any HS256 token is refused.
 * - Realtime: a socket opened with the real anon key (the gateway
 *   string-matches apikey), then a channel join carrying the forged token
 *   signed with upstream's well-known seed constant — the constant a
 *   drifted seeds.exs mount would put back in the tenant row.
 * - Storage: signed with AUTH_JWT_SECRET (the stack's own static secret)
 *   and asked for an authenticated endpoint; the patched verifier refuses
 *   the HMAC token outright.
 */

const config = liveStackConfig() as LiveStackConfig | null;

/** Upstream's well-known seed constant: what a drifted fork would accept. */
const WELL_KNOWN_SEED_SECRET =
  "super-secret-jwt-token-with-at-least-32-characters-long";

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function mintHs256(claims: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function forgedToken(secret: string, role = "authenticated"): string {
  const now = Math.floor(Date.now() / 1000);
  return mintHs256(
    {
      role,
      iss: "supabase",
      sub: "99999999-9999-4222-8222-999999999999",
      iat: now,
      exp: now + 3600,
    },
    secret
  );
}

/** Reads one variable out of a service-only env file beside the main one. */
function readServiceEnvVar(suffix: string, name: string): string {
  const envFile = process.env.LIVE_ENV_FILE;
  if (!envFile) return "";
  for (const line of readFileSync(`${envFile}${suffix}`, "utf8").split("\n")) {
    if (line.startsWith(`${name}=`)) {
      return line.slice(name.length + 1).trim();
    }
  }
  return "";
}

describe.skipIf(!config)("HS256 tokens are refused everywhere", () => {
  const cfg = config as LiveStackConfig;
  let person: LivePerson | undefined;

  afterAll(async () => {
    if (person) {
      await deletePerson(cfg, person.userId).catch(() => {});
    }
  });

  it("GoTrue refuses an HS256 access token signed with its own boot secret", async () => {
    const gotrueSecret = readServiceEnvVar(".gotrue", "GOTRUE_JWT_SECRET");
    expect(gotrueSecret).toBeTruthy();
    const base = cfg.url.replace(/\/+$/, "");
    const res = await fetch(`${base}/auth/v1/user`, {
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${forgedToken(gotrueSecret)}`,
      },
    });
    // GoTrue's bad-JWT refusal is a 403: the RS256 method pin rejected the
    // algorithm before any key lookup.
    expect(res.status).toBe(403);
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

  it("Realtime refuses a forged HS256 join token and accepts a real one", { timeout: 120000 }, async () => {
    const base = cfg.url.replace(/\/+$/, "");
    person = await createPerson(cfg, "gm");
    const wsUrl = `${base.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(
      cfg.anonKey
    )}&vsn=2.0.0`;

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket never opened")), 15000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("the socket was refused before opening"));
      });
    });

    let ref = 0;
    function join(topic: string, token: string): Promise<{ status: string }> {
      return new Promise((resolve, reject) => {
        const thisRef = String(++ref);
        const timer = setTimeout(
          () => reject(new Error(`no reply for ${topic}`)),
          20000
        );
        ws.addEventListener("message", (event: MessageEvent) => {
          const frame = JSON.parse(String(event.data));
          if (
            Array.isArray(frame) &&
            frame[2] === topic &&
            frame[3] === "phx_reply" &&
            frame[1] === thisRef
          ) {
            clearTimeout(timer);
            resolve(frame[4]);
          }
        });
        ws.send(
          JSON.stringify([
            thisRef,
            thisRef,
            topic,
            "phx_join",
            {
              access_token: token,
              config: {
                postgres_changes: [
                  { event: "*", schema: "public", table: "campaigns" },
                ],
              },
            },
          ])
        );
      });
    }

    try {
      // The forged join: upstream's well-known seed constant is the secret
      // a drifted seeds.exs mount would put back in the tenant row.
      const forgedReply = await join(
        "realtime:test-forged",
        forgedToken(WELL_KNOWN_SEED_SECRET)
      );
      expect(forgedReply.status).toBe("error");

      // The positive control: a real person's RS256 token joins.
      const realReply = await join(
        "realtime:test-real",
        await personToken(person)
      );
      expect(realReply.status).toBe("ok");
    } finally {
      ws.close();
    }
  });

  it("Storage refuses an HS256 token signed with its own static secret", async () => {
    const base = cfg.url.replace(/\/+$/, "");
    const storageSecret = readServiceEnvVar(".storage", "AUTH_JWT_SECRET");
    expect(storageSecret).toBeTruthy();
    // The bucket list is a plain authenticated endpoint: a service-role
    // token succeeds on an unpatched stack, so a 200 here would mean the
    // HS256 fallback came back. The token is forged as service_role exactly
    // because that role skips the RLS checks that would otherwise mask the
    // verifier's answer with an unrelated 42501 (the reason the first
    // version of this test could not fail).
    const res = await fetch(`${base}/storage/v1/bucket`, {
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${forgedToken(storageSecret, "service_role")}`,
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message?: string };
    // The refusal is the patched algorithm list doing its work: jose rejects
    // the HS256 alg before any key lookup.
    expect(body.message).toContain("not allowed");
  });

  it("Storage mints no HMAC signed URLs", async () => {
    // The service key is itself an RS256 token, so this request
    // authenticates; what must fail is the signing step. Upload one object
    // (the signer checks the object exists) and ask for a signed URL.
    const admin = adminClient(cfg);
    const path = `signed-url-${Date.now()}.png`;
    const upload = await admin.storage
      .from("portraits")
      .upload(path, new Uint8Array([137, 80, 78, 71]), {
        contentType: "image/png",
        upsert: true,
      });
    expect(upload.error).toBeNull();
    try {
      const signed = await admin.storage.from("portraits").createSignedUrl(path, 60);
      // The patched signJWT refuses HMAC material (the static secret), so
      // no token is minted at all.
      expect(signed.error?.message).toContain("HMAC token signing is not accepted");
      expect(signed.data).toBeNull();
    } finally {
      await admin.storage.from("portraits").remove([path]).catch(() => {});
    }
  });

  it("the S3 protocol endpoint is not served", async () => {
    const base = cfg.url.replace(/\/+$/, "");
    // SigV4 is HMAC-SHA256 and the protocol mints HS256 session tokens, so
    // the endpoint is off: the route does not exist.
    const res = await fetch(`${base}/storage/v1/s3`, {
      headers: { apikey: cfg.anonKey },
    });
    expect(res.status).toBe(404);
  });
});
