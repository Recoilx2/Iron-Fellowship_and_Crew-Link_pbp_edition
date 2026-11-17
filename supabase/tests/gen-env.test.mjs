import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const genEnv = join(dir, "bin", "gen-env.py");

function parseEnv(text) {
  const vars = {};
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line) || !line.includes("=")) continue;
    const i = line.indexOf("=");
    vars[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return vars;
}

describe("bin/gen-env.py", () => {
  let tmp;
  let iron;
  let star;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "gen-env-"));
    const ironOut = join(tmp, ".env.ironsworn");
    const starOut = join(tmp, ".env.starforged");
    execFileSync("python3", [genEnv, "--copy", "ironsworn", "--port", "8000", "--out", ironOut], { stdio: "pipe" });
    execFileSync("python3", [genEnv, "--copy", "starforged", "--port", "8001", "--out", starOut], { stdio: "pipe" });
    iron = parseEnv(readFileSync(ironOut, "utf8"));
    star = parseEnv(readFileSync(starOut, "utf8"));
    // The private signing JWK lives in a GoTrue-only file beside the main one.
    iron.gotrue = parseEnv(readFileSync(join(tmp, ".env.ironsworn.gotrue"), "utf8"));
    star.gotrue = parseEnv(readFileSync(join(tmp, ".env.starforged.gotrue"), "utf8"));
    iron.__tmp = tmp;
  });

  it("fills every secret with a fresh random value", () => {
    for (const v of [
      "POSTGRES_PASSWORD",
      "JWT_JWKS",
      "AUTH_JWT_SECRET",
      "ANON_KEY",
      "SERVICE_ROLE_KEY",
      "METRICS_JWT_SECRET",
      "SECRET_KEY_BASE",
      "REALTIME_DB_ENC_KEY_GCM",
      "S3_PROTOCOL_ACCESS_KEY_ID",
      "S3_PROTOCOL_ACCESS_KEY_SECRET",
      "PG_META_CRYPTO_KEY",
    ]) {
      assert.ok(iron[v], `${v} blank`);
      assert.ok(star[v], `${v} blank in second copy`);
      assert.notEqual(iron[v], star[v], `${v} identical across copies`);
    }
    assert.ok(iron.AUTH_JWT_SECRET.length >= 32, "AUTH_JWT_SECRET too short");
    assert.ok(iron.METRICS_JWT_SECRET.length >= 32, "METRICS_JWT_SECRET too short");
    assert.equal(iron.REALTIME_DB_ENC_KEY_GCM.length, 32, "GCM key must be exactly 32 chars");
  });

  it("keeps the private signing key out of the shared env file", () => {
    assert.equal(iron.JWT_KEYS, undefined, "shared env file carries JWT_KEYS");
    assert.match(iron.JWT_KEYS_FILE, /^\.env\.ironsworn\.gotrue$/);
    assert.ok(iron.gotrue.GOTRUE_JWT_KEYS, "GoTrue-only env file has no signing key");
    assert.notEqual(iron.gotrue.GOTRUE_JWT_KEYS, star.gotrue.GOTRUE_JWT_KEYS, "same key in both copies");
    const shared = Object.keys(iron).filter((key) => key.startsWith("GOTRUE_JWT_KEYS"));
    assert.deepEqual(shared, [], "shared env file carries a GoTrue signing variable");
  });

  it("generates one RSA key pair of at least 3072 bits per copy", () => {
    const keys = JSON.parse(iron.gotrue.GOTRUE_JWT_KEYS);
    assert.equal(keys.length, 1, "exactly one signing key");
    const [privateJwk] = keys;
    assert.equal(privateJwk.kty, "RSA");
    assert.equal(privateJwk.alg, "RS256");
    assert.equal(privateJwk.key_ops?.[0], "sign");
    const modulusBytes = Buffer.from(privateJwk.n, "base64url").length;
    assert.ok(modulusBytes >= 384, `RSA modulus must be at least 3072 bits, got ${modulusBytes * 8}`);
    for (const field of ["d", "p", "q", "dp", "dq", "qi"]) {
      assert.ok(privateJwk[field], `private JWK missing ${field}`);
    }
  });

  it("keeps the private key out of the public JWKS", () => {
    const [privateJwk] = JSON.parse(iron.gotrue.GOTRUE_JWT_KEYS);
    const jwks = JSON.parse(iron.JWT_JWKS);
    assert.equal(jwks.keys.length, 1);
    const [publicJwk] = jwks.keys;
    assert.equal(publicJwk.kid, privateJwk.kid, "public key must carry the signing key's kid");
    assert.equal(publicJwk.alg, "RS256");
    assert.equal(publicJwk.key_ops?.[0], "verify");
    for (const field of ["d", "p", "q", "dp", "dq", "qi"]) {
      assert.equal(publicJwk[field], undefined, `public JWKS leaks ${field}`);
    }
  });

  it("mints RS256 anon/service keys signed by the GoTrue-only private key", () => {
    const [privateJwk] = JSON.parse(iron.gotrue.GOTRUE_JWT_KEYS);
    const publicKey = createPublicKey({ key: { ...privateJwk, key_ops: undefined }, format: "jwk" });
    for (const [key, role] of [["ANON_KEY", "anon"], ["SERVICE_ROLE_KEY", "service_role"]]) {
      const [h, p, s] = iron[key].split(".");
      const header = JSON.parse(Buffer.from(h, "base64url").toString());
      const payload = JSON.parse(Buffer.from(p, "base64url").toString());
      assert.equal(header.alg, "RS256");
      assert.equal(header.kid, privateJwk.kid, `${key} must carry the signing key's kid`);
      assert.equal(payload.role, role);
      assert.equal(payload.iss, "supabase");
      const ok = cryptoVerify("sha256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"));
      assert.ok(ok, `${key} signature invalid`);
    }
  });
});
