/**
 * Test-only token minting for the GM assistant handler tests (ticket #152).
 *
 * The stack signs access tokens with an asymmetric RSA key (RS256): GoTrue
 * holds the private half, every verifier only the public JWKS. These tests
 * play GoTrue: one throwaway RSA key pair per run, `mintRs256` signs the
 * way GoTrue does (RS256 header carrying the key's `kid`), and `testJwks`
 * builds the env's `jwtJwks` value. `mintHs256` exists so the tests can
 * prove HS256 tokens — signed with any secret, old or new — are refused.
 */
import { createHmac, createPrivateKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";

import type { JwkSet } from "./env.ts";

const TEST_KID = "test-rsa-key";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const exportedPrivate = {
  ...(privateKey.export({ format: "jwk" }) as JsonWebKey & Record<string, string>),
  kid: TEST_KID,
  alg: "RS256",
};
const exportedPublic = {
  ...(publicKey.export({ format: "jwk" }) as JsonWebKey & Record<string, string>),
  kid: TEST_KID,
  alg: "RS256",
};

/** The env's `jwtJwks`: the public half of the test signing key. */
export function testJwks(): JwkSet {
  return [
    {
      kty: "RSA",
      kid: exportedPublic.kid,
      alg: "RS256",
      n: exportedPublic.n,
      e: exportedPublic.e,
    },
  ];
}

export function b64url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Signs `claims` the way GoTrue signs access tokens: RS256 with the kid. */
export function mintRs256(claims: Record<string, unknown>): string {
  const header = b64url(
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: TEST_KID })).toString("base64"),
  );
  const payload = b64url(Buffer.from(JSON.stringify(claims)).toString("base64"));
  const key = createPrivateKey({ key: exportedPrivate, format: "jwk" });
  const signature = cryptoSign("sha256", Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64url(signature.toString("base64"))}`;
}

/** Signs `claims` with HS256 and the given secret, for rejection tests. */
export function mintHs256(claims: Record<string, unknown>, secret: string): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64"));
  const payload = b64url(Buffer.from(JSON.stringify(claims)).toString("base64"));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64");
  return `${header}.${payload}.${b64url(signature)}`;
}
