import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, accessSync, constants } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sup = join(repo, "supabase");
const read = (p) => readFileSync(p, "utf8");
const isExec = (p) => {
  accessSync(p, constants.X_OK);
  return true;
};

describe("smoke test", () => {
  const smoke = join(sup, "tests", "smoke.sh");

  it("script exists and is executable", () => {
    assert.ok(existsSync(smoke), "tests/smoke.sh missing");
    assert.ok(isExec(smoke), "tests/smoke.sh not executable");
  });

  it("starts both copies side by side from the template", () => {
    const text = read(smoke);
    assert.ok(text.includes("ironsworn") && text.includes("starforged"), "both copies not covered");
    assert.ok(text.includes("docker-compose.yml"), "does not use the template compose file");
  });

  it("checks health through both gateways and cleans up", () => {
    const text = read(smoke);
    for (const endpoint of ["auth/v1/health", "rest/v1/", "storage/v1/", "functions/v1/", "hocuspocus/"]) {
      assert.ok(text.includes(endpoint), `no check for ${endpoint}`);
    }
    // The gateway's OpenAPI route only admits the service key.
    assert.ok(text.includes("SERVICE_ROLE_KEY"), "rest probe does not use the service key");
    assert.ok(/realtime.*health|health.*realtime/i.test(text), "no realtime health check");
    assert.ok(/migrate/.test(text), "no migration check");
    assert.ok(/trap|CLEANUP/.test(text), "no cleanup handling");
    assert.ok(/^set -euo? pipefail/m.test(text), "not fail-fast");
  });
});

describe("ci workflow", () => {
  const workflow = join(repo, ".github", "workflows", "supabase-smoke.yml");

  it("runs the smoke test on every pull request", () => {
    assert.ok(existsSync(workflow), "workflow missing");
    const text = read(workflow);
    assert.ok(/pull_request/.test(text), "does not trigger on pull_request");
    assert.ok(text.includes("smoke.sh"), "does not run the smoke test");
    assert.ok(text.includes("gen-env.py"), "does not generate per-copy env files");
    assert.ok(/ironsworn/.test(text) && /starforged/.test(text), "does not start both copies");
  });
});

describe("operator docs", () => {
  it("README documents start, backup, restore and admin", () => {
    const path = join(sup, "README.md");
    assert.ok(existsSync(path), "supabase/README.md missing");
    const text = read(path).toLowerCase();
    for (const topic of ["ironsworn", "starforged", "backup", "restore", "psql", "studio"]) {
      assert.ok(text.includes(topic), `README does not document ${topic}`);
    }
  });
});
