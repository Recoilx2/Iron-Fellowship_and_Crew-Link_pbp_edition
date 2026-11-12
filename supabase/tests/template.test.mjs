import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(dir, p), "utf8");
const exists = (p) => existsSync(join(dir, p));
// Config text without full-line comments: checks target the configuration,
// while comments stay free to name dropped services honestly.
const code = (text) =>
  text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

describe("supabase compose template", () => {
  it("template files exist", () => {
    for (const f of [
      "docker-compose.yml",
      ".env.example",
      "envoy/envoy.yaml",
      "envoy/cds.yaml",
      "envoy/lds.template.yaml",
      "envoy/docker-entrypoint.sh",
      "studio.docker-compose.yml",
      "migrate/apply.sh",
      "migrations/README.md",
      "site/Dockerfile",
      "site/nginx.conf",
      "site/game-ironsworn.env",
      "site/game-starforged.env",
    ]) {
      assert.ok(exists(f), `missing ${f}`);
    }
  });

  const compose = () => read("docker-compose.yml");
  const serviceBlock = (text, name) => {
    const m = text.match(new RegExp(`^  ${name}:\\s*$`, "m"));
    assert.ok(m, `service ${name} missing`);
  };

  it("keeps exactly the trimmed service set", () => {
    const text = compose();
    for (const s of ["db", "auth", "rest", "realtime", "storage", "api-gw", "functions", "migrate", "site"]) {
      serviceBlock(text, s);
    }
    for (const s of ["studio", "meta", "imgproxy", "supavisor", "analytics", "vector", "pooler", "kong"]) {
      assert.ok(!new RegExp(`^  ${s}:\\s*$`, "m").test(text), `dropped service ${s} present`);
    }
  });

  it("has no fixed container names and no fixed project name", () => {
    const text = compose();
    assert.ok(!/container_name\s*:/.test(text), "fixed container_name found");
    assert.ok(!/^name\s*:/m.test(text), "fixed project name found");
  });

  it("is per-copy: gateway port is interpolated and no db ports are published", () => {
    const text = compose();
    assert.ok(text.includes("${API_GW_HTTP_PORT"), "API_GW_HTTP_PORT not interpolated");
    assert.ok(!text.includes("6543"), "pooler port still referenced");
  });

  it("state lives in named volumes, not shared bind mounts", () => {
    const text = compose();
    assert.ok(/^  db-data:\s*$/m.test(text), "db-data named volume missing");
    assert.ok(/^  storage-data:\s*$/m.test(text), "storage-data named volume missing");
    assert.ok(!text.includes("./volumes/db/data"), "db data still a bind mount");
    assert.ok(!text.includes("./volumes/storage:/var/lib/storage"), "storage data still a bind mount");
  });

  it("realtime uses AES-256-GCM only, never the ECB default", () => {
    const text = compose();
    assert.ok(/DB_ENC_KEY_GCM\s*:/.test(text), "DB_ENC_KEY_GCM missing");
    assert.ok(/DB_ENC_WRITE_GCM\s*:\s*["']?true["']?/.test(text), "DB_ENC_WRITE_GCM not true");
    assert.ok(!/DB_ENC_KEY\s*:/.test(text.replace(/DB_ENC_KEY_GCM/g, "")), "legacy ECB DB_ENC_KEY still set");
    assert.ok(!/REALTIME_DB_ENC_KEY(?!_GCM)/.test(text), "legacy REALTIME_DB_ENC_KEY still referenced");
  });

  it("realtime limits are set explicitly", () => {
    const text = compose();
    for (const v of [
      "TENANT_MAX_BYTES_PER_SECOND",
      "TENANT_MAX_CHANNELS_PER_CLIENT",
      "TENANT_MAX_CONCURRENT_USERS",
      "TENANT_MAX_EVENTS_PER_SECOND",
      "TENANT_MAX_JOINS_PER_SECOND",
    ]) {
      assert.ok(text.includes(v), `${v} missing`);
    }
  });

  it("realtime keeps its Host-header network alias", () => {
    assert.ok(compose().includes("realtime-dev.supabase-realtime"), "realtime alias missing in compose");
    assert.ok(
      read("envoy/lds.template.yaml").includes("host_rewrite_literal: realtime-dev.supabase-realtime"),
      "host_rewrite_literal missing in gateway routes",
    );
  });

  it("storage image transformation is off with no imgproxy dependency", () => {
    const text = code(compose());
    assert.ok(/ENABLE_IMAGE_TRANSFORMATION\s*:\s*["']false["']/.test(text), "transformation not off");
    assert.ok(!/imgproxy/i.test(text), "imgproxy still referenced");
  });

  it("gateway has no dependency on dropped services", () => {
    const text = code(compose());
    assert.ok(!/studio/.test(text), "studio still referenced");
  });

  it("functions runtime has a lowered memory ceiling", () => {
    const text = compose();
    assert.ok(text.includes("FUNCTIONS_MEMORY_LIMIT"), "FUNCTIONS_MEMORY_LIMIT missing");
    assert.ok(!text.includes(":-2g"), "default 2g memory ceiling still present");
  });

  it("migrations apply automatically and gate the data services", () => {
    const text = code(compose());
    serviceBlock(text, "migrate");
    assert.ok(/service_completed_successfully/.test(text), "nothing waits for migrate");
    // Storage brings its own schema (storage.buckets) at boot, and the
    // portrait and homebrew migrations need it, so storage boots before
    // migrate runs instead of waiting for it. PostgREST tolerates an empty
    // schema and reloads as migrate applies, so rest boots early too.
    for (const s of ["rest", "storage"]) {
      const m = text.match(new RegExp(`^  ${s}:\\s*$`, "m"));
      assert.ok(m, `service ${s} missing`);
      const after = text.slice(m.index + m[0].length);
      const next = after.search(/^  [a-z][a-z-]*:\s*$/m);
      const block = next === -1 ? after : after.slice(0, next);
      assert.ok(!block.includes("migrate"), `${s} must not wait for migrate`);
    }
    for (const s of ["realtime"]) {
      const m = text.match(new RegExp(`^  ${s}:\\s*$`, "m"));
      assert.ok(m, `service ${s} missing`);
      const after = text.slice(m.index + m[0].length);
      const next = after.search(/^  [a-z][a-z-]*:\s*$/m);
      const block = next === -1 ? after : after.slice(0, next);
      assert.ok(block.includes("migrate"), `${s} does not wait for migrate`);
    }
    // Migrate runs after storage is healthy so the bucket migrations land
    // on a storage schema that already exists.
    {
      const m = text.match(/^  migrate:\s*$/m);
      assert.ok(m, "service migrate missing");
      const after = text.slice(m.index + m[0].length);
      const next = after.search(/^  [a-z][a-z-]*:\s*$/m);
      const block = next === -1 ? after : after.slice(0, next);
      assert.ok(block.includes("storage"), "migrate does not wait for storage");
    }
  });

  it("every compose variable is documented in .env.example", () => {
    const text = compose() + "\n" + read("studio.docker-compose.yml");
    const used = new Set([...text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    const example = read(".env.example");
    const documented = new Set([...example.matchAll(/^#?\s*([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]));
    for (const v of used) {
      assert.ok(documented.has(v), `${v} used in compose but missing from .env.example`);
    }
  });

  it("secrets are blank in .env.example", () => {
    const example = read(".env.example");
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
      assert.ok(new RegExp(`^${v}=\\s*$`, "m").test(example), `${v} is not blank`);
    }
  });
});

describe("trimmed envoy config", () => {
  it("has no meta or studio clusters", () => {
    const cds = read("envoy/cds.yaml");
    for (const c of ["auth", "rest", "realtime", "storage", "functions"]) {
      assert.ok(new RegExp(`name:\\s*${c}\\b`).test(cds), `cluster ${c} missing`);
    }
    assert.ok(!/name:\s*(meta|studio)\b/.test(cds), "meta/studio cluster still present");
    assert.ok(!/address:\s*(meta|studio)\b/.test(cds), "meta/studio address still present");
  });

  it("has no routes to dropped services", () => {
    const lds = read("envoy/lds.template.yaml");
    assert.ok(!/cluster:\s*(meta|studio)\b/.test(lds), "route to meta/studio still present");
    assert.ok(!/- name: pg-protected/.test(lds), "pg-protected route still present");
    assert.ok(!/prefix: \/api\/mcp/.test(lds), "/api/mcp route still present");
    assert.ok(!/prefix: \/mcp\b/.test(lds), "/mcp route still present");
    for (const c of ["auth", "rest", "realtime", "storage", "functions"]) {
      assert.ok(new RegExp(`cluster:\\s*${c}\\b`).test(lds), `route to ${c} missing`);
    }
  });

  it("entrypoint still renders the key placeholders", () => {
    const entry = read("envoy/docker-entrypoint.sh");
    assert.ok(entry.includes("ANON_KEY") && entry.includes("SERVICE_ROLE_KEY"), "key substitution missing");
  });
});

describe("studio add-on", () => {
  it("defines only studio and meta, with no fixed names", () => {
    const text = read("studio.docker-compose.yml");
    assert.ok(/^  studio:\s*$/m.test(text), "studio service missing");
    assert.ok(/^  meta:\s*$/m.test(text), "meta service missing");
    assert.ok(!/container_name\s*:/.test(text), "fixed container_name found");
  });
});
