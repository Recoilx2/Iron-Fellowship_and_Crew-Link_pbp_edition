import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const genEnv = join(dir, "bin", "gen-env.py");

const b64url = (b64) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sign = (secret, data) => b64url(createHmac("sha256", secret).update(data).digest("base64"));

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
    iron.__out = ironOut;
  });

  it("fills every secret with a fresh random value", () => {
    for (const v of [
      "POSTGRES_PASSWORD",
      "JWT_SECRET",
      "ANON_KEY",
      "SERVICE_ROLE_KEY",
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
    assert.ok(iron.JWT_SECRET.length >= 32, "JWT_SECRET too short");
    assert.equal(iron.REALTIME_DB_ENC_KEY_GCM.length, 32, "GCM key must be exactly 32 chars");
  });

  it("mints HS256 anon/service keys signed by JWT_SECRET", () => {
    for (const [key, role] of [["ANON_KEY", "anon"], ["SERVICE_ROLE_KEY", "service_role"]]) {
      const [h, p, s] = iron[key].split(".");
      assert.equal(JSON.parse(Buffer.from(h, "base64url").toString()).alg, "HS256");
      assert.equal(JSON.parse(Buffer.from(p, "base64url").toString()).role, role);
      assert.equal(sign(iron.JWT_SECRET, `${h}.${p}`), s, `${key} signature invalid`);
    }
  });

  it("points each copy at its own gateway port", () => {
    assert.equal(iron.API_GW_HTTP_PORT, "8000");
    assert.equal(star.API_GW_HTTP_PORT, "8001");
    assert.equal(iron.SUPABASE_PUBLIC_URL, "http://localhost:8000");
    assert.equal(star.API_EXTERNAL_URL, "http://localhost:8001/auth/v1");
    assert.equal(iron.ENV_FILE, basename(iron.__out));
  });
});
