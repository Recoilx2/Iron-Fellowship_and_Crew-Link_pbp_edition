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
});
