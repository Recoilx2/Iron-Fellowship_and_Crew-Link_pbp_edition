import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, accessSync, constants } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const sup = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(sup, "..");
const read = (p) => readFileSync(join(repo, p), "utf8");
const isExec = (p) => {
  accessSync(join(repo, p), constants.X_OK);
  return true;
};

const liveFiles = [
  "src/api-calls/realtime/listenToRows.live.test.ts",
  "src/api-calls/campaign/campaignMembers.live.test.ts",
  "src/api-calls/campaign/campaigns.live.test.ts",
  "src/api-calls/campaign/campaignTables.live.test.ts",
  "src/api-calls/game-log/campaignRolls.live.test.ts",
  "src/api-calls/user/settings/userSettings.live.test.ts",
  "src/api-calls/character/characters.live.test.ts",
  "src/api-calls/character/characterChildren.live.test.ts",
  "src/api-calls/character/portraits.live.test.ts",
];

describe("docker behavior tests", () => {
  it("every area this ticket covers has a behavior test", () => {
    for (const file of liveFiles) {
      assert.ok(existsSync(join(repo, file)), `${file} missing`);
    }
  });
  it("behavior tests skip without a stack, so plain runs stay green", () => {
    for (const file of liveFiles) {
      const text = read(file);
      assert.ok(text.includes("skipIf"), `${file} does not skip`);
      assert.ok(
        text.includes("SUPABASE_URL") || text.includes("liveStackConfig"),
        `${file} does not gate on the stack environment`
      );
    }
  });

  it("the harness signs in as different people with per-person clients", () => {
    const text = read("src/api-calls/testing/liveHarness.ts");
    for (const api of [
      "createPerson",
      "deletePerson",
      "signInWithPassword",
      "grantMembership",
      "randomCampaignId",
      "personClient",
      "adminClient",
      "waitFor",
    ]) {
      assert.ok(text.includes(api), `harness does not expose ${api}`);
    }
    for (const role of ["gm", "player", "outsider", "owner"]) {
      const found = liveFiles.some((file) => read(file).includes(role));
      assert.ok(found, `no behavior test signs in as ${role}`);
    }
  });

  it("live.sh runs every behavior test against a running stack copy", () => {
    assert.ok(isExec("supabase/tests/live.sh"), "tests/live.sh not executable");
    const text = read("supabase/tests/live.sh");
    assert.ok(text.includes(".live.test.ts"), "does not discover live tests");
    assert.ok(text.includes("SUPABASE_URL"), "does not point at the stack");
    assert.ok(text.includes("SERVICE_ROLE_KEY"), "does not use the service key");
    assert.ok(
      text.includes("VITE_SUPABASE_URL"),
      "does not configure the data-layer client"
    );
    assert.ok(/^set -euo? pipefail/m.test(text), "not fail-fast");
  });

  it("live.sh fails the run when any behavior test is skipped", () => {
    const text = read("supabase/tests/live.sh");
    assert.ok(
      text.includes("--reporter=json"),
      "does not capture a machine-readable report"
    );
    assert.ok(text.includes("--outputFile"), "does not save the report to a file");
    assert.ok(
      text.includes("numPendingTests"),
      "does not check the skipped-test count"
    );
    assert.ok(/skipped/i.test(text), "no failure message for skipped tests");
  });
});

describe("live-test ci job", () => {
  const workflow = ".github/workflows/supabase-smoke.yml";

  it("runs the behavior tests against one stack copy on every pull request", () => {
    assert.ok(existsSync(join(repo, workflow)), "workflow missing");
    const text = read(workflow);
    assert.ok(/pull_request/.test(text), "does not trigger on pull_request");
    assert.ok(text.includes("live.sh"), "does not run the behavior tests");
    assert.ok(text.includes("gen-env.py"), "does not generate the copy env file");
  });

  it("tears the copy down including volumes and never prints generated keys", () => {
    const text = read(workflow);
    assert.ok(text.includes("down -v"), "does not remove volumes on teardown");
    assert.ok(text.includes("add-mask"), "does not mask generated keys in logs");
  });
});
