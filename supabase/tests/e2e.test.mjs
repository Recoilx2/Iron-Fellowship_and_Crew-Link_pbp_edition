import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(dir, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const rootExists = (p) => existsSync(join(root, p));

describe("browser tests (Playwright) in CI", () => {
  it("wires an npm script and the Playwright dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.ok(
      typeof pkg.scripts?.["test:e2e"] === "string" &&
        pkg.scripts["test:e2e"].length > 0,
      "package.json needs a test:e2e script; plain npm test stays unchanged"
    );
    assert.ok(
      pkg.devDependencies?.["@playwright/test"],
      "package.json needs @playwright/test in devDependencies"
    );
  });

  it("configures Playwright against the running copy with failure artifacts", () => {
    assert.ok(rootExists("playwright.config.ts"), "playwright.config.ts missing");
    const text = read("playwright.config.ts");
    assert.ok(/testDir.*e2e/.test(text), "Playwright testDir is not e2e/");
    assert.ok(
      /E2E_SITE_URL/.test(text),
      "Playwright does not target the running site copy"
    );
    assert.ok(
      /retain-on-failure/.test(text),
      "Playwright does not keep traces on failure"
    );
    assert.ok(
      /only-on-failure/.test(text),
      "Playwright does not keep screenshots on failure"
    );
  });

  it("covers the campaign access flow without skips or a mail server", () => {
    assert.ok(
      rootExists("e2e/campaign-access.spec.ts"),
      "e2e/campaign-access.spec.ts missing"
    );
    const text = read("e2e/campaign-access.spec.ts");
    assert.ok(
      /Campaign not Found/.test(text),
      "the outsider case does not assert the not-found screen"
    );
    for (const skipped of [
      ".skip",
      "test.skip",
      "describe.skip",
      "test.fixme",
      "test.describe.skip",
      "test.only",
      "describe.only",
    ]) {
      assert.ok(
        !text.includes(skipped),
        `e2e spec must never skip, but contains ${skipped}`
      );
    }
    assert.ok(rootExists("e2e/fixtures.ts"), "e2e/fixtures.ts missing");
    const fixtures = read("e2e/fixtures.ts");
    assert.ok(
      /auth\.admin\.createUser/.test(fixtures),
      "e2e does not create test people through the Auth Admin API"
    );
    assert.ok(
      /localStorage/.test(fixtures),
      "e2e does not hand the session to the browser"
    );
    assert.ok(
      !/smtp|maildev|mailslurp|mailhog/i.test(fixtures),
      "e2e must not need a mail server"
    );
  });

  it("runs the browser tests against one copy and fails on skips", () => {
    assert.ok(rootExists("supabase/tests/e2e.sh"), "supabase/tests/e2e.sh missing");
    const mode = statSync(join(root, "supabase/tests/e2e.sh")).mode;
    assert.ok(
      // eslint-disable-next-line no-bitwise
      mode & 0o111,
      "supabase/tests/e2e.sh is not executable"
    );
    const text = read("supabase/tests/e2e.sh");
    assert.ok(/ENV_FILE/.test(text), "e2e.sh does not read the per-copy env");
    assert.ok(/playwright/.test(text), "e2e.sh does not run Playwright");
    assert.ok(/skipped/i.test(text), "e2e.sh does not fail when tests skip");
  });

  it("runs in CI on every pull request and keeps failure artifacts", () => {
    const text = read(".github/workflows/supabase-smoke.yml");
    assert.ok(/^  e2e:/m.test(text), "no e2e job in supabase-smoke.yml");
    const job = text.slice(text.search(/^  e2e:/m));
    assert.ok(
      /upload-artifact/.test(job),
      "e2e job does not upload failure artifacts"
    );
    assert.ok(
      /test-results|playwright-report/.test(job),
      "e2e job does not keep Playwright traces/screenshots"
    );
    assert.ok(/e2e\.sh/.test(job), "e2e job does not run the e2e runner script");
  });

  it("keeps browser-test output out of git and the site image", () => {
    const gitignore = read(".gitignore");
    assert.ok(
      gitignore.includes("test-results"),
      ".gitignore does not ignore Playwright test-results"
    );
    assert.ok(
      gitignore.includes("playwright-report"),
      ".gitignore does not ignore the Playwright report"
    );
    const dockerignore = readFileSync(join(dir, "..", ".dockerignore"), "utf8");
    assert.ok(
      dockerignore.includes("test-results"),
      ".dockerignore does not keep test-results out of the site build"
    );
  });
});
