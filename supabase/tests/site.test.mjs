import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(dir, p), "utf8");
const exists = (p) => existsSync(join(dir, p));

describe("site container", () => {
  it("ships per-system branding env files", () => {
    for (const [copy, title, favicon, opengraph] of [
      [
        "ironsworn",
        "Iron Fellowship for Ironsworn",
        "/theme/sunset.svg",
        "/assets/ironsworn/opengraph-default.png",
      ],
      [
        "starforged",
        "Crew Link for Starforged",
        "/theme/eidolon.svg",
        "/assets/starforged/opengraph-default.png",
      ],
    ]) {
      const path = `site/game-${copy}.env`;
      assert.ok(exists(path), `missing ${path}`);
      const text = read(path);
      assert.ok(
        text.includes(`VITE_GAME_SYSTEM=${copy}`),
        `${path} does not select ${copy}`
      );
      assert.ok(text.includes(title), `${path} misses the site title`);
      assert.ok(text.includes(favicon), `${path} misses the favicon`);
      assert.ok(text.includes(opengraph), `${path} misses the opengraph image`);
    }
  });

  it("builds the site for the configured game system", () => {
    assert.ok(exists("site/Dockerfile"), "site/Dockerfile missing");
    const text = read("site/Dockerfile");
    assert.ok(/ARG GAME_SYSTEM/.test(text), "no GAME_SYSTEM build arg");
    assert.ok(
      text.includes("game-${GAME_SYSTEM}.env") ||
        text.includes("game-$GAME_SYSTEM.env"),
      "branding is not selected from GAME_SYSTEM"
    );
    assert.ok(/npm run build/.test(text), "does not build the site");
    assert.ok(
      /nginx|serve/.test(text),
      "does not serve the built site"
    );
    assert.ok(
      /VITE_SUPABASE_URL/.test(text) && /VITE_SUPABASE_ANON_KEY/.test(text),
      "Supabase connection is not baked in at build time"
    );
  });

  it("serves app routes from index.html", () => {
    assert.ok(exists("site/nginx.conf"), "site/nginx.conf missing");
    const text = read("site/nginx.conf");
    assert.ok(
      /try_files[^;]*\/index\.html/.test(text),
      "no SPA fallback to index.html"
    );
  });

  it("compose runs one site per copy for its game system", () => {
    const text = read("docker-compose.yml");
    assert.ok(/^  site:\s*$/m.test(text), "site service missing");
    const block = text.slice(text.search(/^  site:\s*$/m));
    assert.ok(/GAME_SYSTEM/.test(block), "site is not told its game system");
    assert.ok(
      block.includes("${SITE_HTTP_PORT"),
      "site port is not per-copy"
    );
  });

  it("env example configures the site per copy", () => {
    const text = read(".env.example");
    assert.ok(/^GAME_SYSTEM=$/m.test(text), "GAME_SYSTEM blank missing");
    assert.ok(
      /^SITE_HTTP_PORT=\d+$/m.test(text),
      "SITE_HTTP_PORT default missing"
    );
  });

  it("smoke test serves both sites with their own branding", () => {
    const text = read("tests/smoke.sh");
    assert.ok(text.includes("SITE_HTTP_PORT"), "sites are not checked");
    assert.ok(
      text.includes("Iron Fellowship") && text.includes("Crew Link"),
      "site branding is not verified per copy"
    );
  });

  it("keeps secrets and bulk out of the site build context", () => {
    assert.ok(exists("../.dockerignore"), "root .dockerignore missing");
    const text = readFileSync(join(dir, "..", ".dockerignore"), "utf8");
    assert.ok(
      text.includes("supabase/.env"),
      "per-copy env files not excluded"
    );
    assert.ok(
      text.includes("!supabase/.env.example"),
      "the example env file must stay includable"
    );
  });
});
