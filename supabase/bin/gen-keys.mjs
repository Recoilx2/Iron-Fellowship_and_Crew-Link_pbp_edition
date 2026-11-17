// Generates the per-copy asymmetric JWT signing material (ticket #152):
//
// - one RSA-3072 key pair: the private JWK goes to GoTrue only (it signs
//   access tokens with it), the public JWK goes to every token verifier;
// - ANON_KEY and SERVICE_ROLE_KEY minted as RS256 JWTs signed by that key;
// - Storage's own URL-signing key (the platform's default HS512 oct type):
//   it signs and verifies Storage's short-lived object URLs and is read by
//   Storage only — user tokens always arrive as RS256 and are verified
//   through the public JWKS.
//
// Everything is emitted as one JSON object on stdout; nothing is logged.
// Called by bin/gen-env.py, which needs a crypto tool for RSA key
// generation (Python's standard library has none): node is the one every
// deployment and CI image already has, the same way upstream's
// add-new-auth-keys.sh uses it.
//
// Usage: node gen-keys.mjs
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { randomBytes } from "node:crypto";

const RSA_MODULUS_BITS = 3072;
// DigestInfo prefix for SHA-256, only used to double-check the signature
// shape node produced (kept for the self-check below).
const KEY_EXPIRY_SECONDS = 10 * 365 * 24 * 3600;

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function withSigFields(jwk, ops) {
  return { kty: jwk.kty, kid: jwk.kid, alg: "RS256", use: "sig", key_ops: ops, ...pickRsaParams(jwk) };
}

function pickRsaParams(jwk) {
  const params = {};
  for (const field of ["n", "e", "d", "p", "q", "dp", "dq", "qi"]) {
    if (jwk[field] !== undefined) params[field] = jwk[field];
  }
  return params;
}

function mintRs256(privateJwk, kid, role) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const payload = b64url(
    JSON.stringify({ role, iss: "supabase", iat: now, exp: now + KEY_EXPIRY_SECONDS }),
  );
  const data = `${header}.${payload}`;
  const key = createPrivateKey({ key: privateJwk, format: "jwk" });
  const signature = sign("sha256", Buffer.from(data), key);
  return `${data}.${signature.toString("base64url")}`;
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: RSA_MODULUS_BITS,
  publicExponent: 0x10001,
});

const exportedPrivate = privateKey.export({ format: "jwk" });
const exportedPublic = publicKey.export({ format: "jwk" });
// The kid is derived from the public modulus, so the same key always carries
// the same id and verifiers can select it by kid.
const kid = createHash("sha256")
  .update(Buffer.from(exportedPublic.n, "base64url"))
  .digest("hex")
  .slice(0, 16);

const privateJwk = withSigFields({ ...exportedPrivate, kid }, ["sign"]);
const publicJwk = withSigFields({ ...exportedPublic, kid }, ["verify"]);

const anonKey = mintRs256(exportedPrivate, kid, "anon");
const serviceRoleKey = mintRs256(exportedPrivate, kid, "service_role");

// Self-check: both minted keys must verify against the public half, so a
// broken key never reaches an env file.
const publicVerificationKey = createPublicKey({ key: publicJwk, format: "jwk" });
for (const [token, role] of [
  [anonKey, "anon"],
  [serviceRoleKey, "service_role"],
]) {
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  const ok = verify(
    "sha256",
    Buffer.from(`${headerB64}.${payloadB64}`),
    publicVerificationKey,
    Buffer.from(signatureB64, "base64url"),
  );
  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  if (!ok || claims.role !== role) {
    console.error("gen-keys: generated API key failed self-check");
    process.exit(1);
  }
}

// Storage's URL-signing key: 64 bytes for HS512 (the platform's default URL
// signing type), storage-only.
const urlSigningKey = {
  kty: "oct",
  kid: randomBytes(8).toString("hex"),
  alg: "HS512",
  use: "sig",
  key_ops: ["sign", "verify"],
  k: randomBytes(64).toString("base64url"),
};

process.stdout.write(
  JSON.stringify({
    JWT_KEYS: [privateJwk],
    JWT_JWKS: { keys: [publicJwk] },
    JWT_JWKS_STORAGE: { keys: [publicJwk, urlSigningKey], urlSigningKey },
    ANON_KEY: anonKey,
    SERVICE_ROLE_KEY: serviceRoleKey,
  }),
);
