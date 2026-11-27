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

  it("builds an arbitrary ruleset id with generic branding", () => {
    const dockerfile = read("site/Dockerfile");
    assert.ok(
      dockerfile.includes("game-${GAME_SYSTEM}.env"),
      "built-in game env is not selected by id"
    );
    assert.ok(
      dockerfile.includes("game-default.env"),
      "no fallback for an unknown ruleset id"
    );
    assert.ok(
      dockerfile.includes("ENV VITE_GAME_SYSTEM=${GAME_SYSTEM}"),
      "the configured ruleset id is not passed to the client"
    );
    const fallback = read("site/game-default.env");
    assert.ok(/^VITE_TITLE=\S+/m.test(fallback), "no generic title");
    assert.ok(
      /^VITE_FAVICON_PATH=\/theme\//m.test(fallback),
      "no generic favicon"
    );
  });

  it("ships a replacement ruleset fixture with branding and mechanics", () => {
    const manifest = JSON.parse(read("site/config-replacement/manifest.json"));
    assert.equal(manifest.version, 1);
    const ref = manifest.ruleset;
    assert.equal(ref.type, "ruleset");
    assert.equal(ref.replacesBase, true);
    assert.equal(ref.path, "/config/rulesets/frontier.json");

    const pkg = JSON.parse(read(`site/config-replacement/${ref.path.split("/").pop()}`));
    assert.equal(pkg._id, ref.id);
    assert.equal(pkg.datasworn_version, "0.3.0");
    assert.equal(pkg["x-branding"].theme, "hinterlands");
    assert.equal(pkg["x-branding"].appName, "Frontier Fellowship");
    assert.deepEqual(pkg["x-mechanics"].progressTracks, ["Oath", "Trail", "Peril"]);
    assert.equal(pkg["x-mechanics"].actionTotalCap, 12);
    assert.ok(exists(`site/config-replacement/${pkg["x-branding"].faviconPath.split("/").pop()}`), "fixture favicon missing");
    assert.equal(
      pkg.moves.frontier_moves.contents.swear_an_oath.name,
      "Swear a Frontier Oath",
      "fixture has no move to render on the Rules page"
    );
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

  it("serves the per-copy ruleset volume read-only", () => {
    const nginx = read("site/nginx.conf");
    assert.ok(
      /location \/config\/ \{/.test(nginx),
      "nginx has no /config/ location"
    );
    assert.ok(
      nginx.includes("alias /usr/share/nginx/config/;"),
      "/config/ is not aliased to the mounted volume"
    );

    const text = read("docker-compose.yml");
    const m = text.match(/^  site:\s*$/m);
    assert.ok(m, "site service missing");
    const after = text.slice(m.index + m[0].length);
    const next = after.search(/^  [a-z][a-z-]*:\s*$/m);
    const block = next === -1 ? after : after.slice(0, next);
    assert.ok(
      block.includes(":/usr/share/nginx/config:ro"),
      "site does not mount the ruleset volume read-only"
    );
    assert.ok(
      block.includes("${RULESETS_CONFIG_DIR"),
      "the ruleset volume is not per-copy"
    );
    assert.ok(
      /^RULESETS_CONFIG_DIR=\S+$/m.test(read(".env.example")),
      "RULESETS_CONFIG_DIR is not documented in .env.example"
    );
  });

  it("ships a mounted manifest and Datasworn package fixture", () => {
    const manifest = JSON.parse(read("site/config/rulesets/manifest.json"));
    assert.equal(manifest.version, 1);
    const ref = manifest.expansions.find((e) => e.id === "mounted_e2e");
    assert.ok(ref, "manifest does not name the mounted_e2e expansion");
    assert.equal(ref.type, "expansion");
    assert.equal(ref.path, "/config/rulesets/mounted_e2e.json");

    const pkg = JSON.parse(read("site/config/rulesets/mounted_e2e.json"));
    assert.equal(pkg._id, ref.id);
    assert.equal(pkg.type, ref.type);
    assert.equal(pkg.datasworn_version, "0.3.0");
    assert.equal(pkg.ruleset, "classic");
    assert.equal(
      pkg.moves.mounted?.contents?.check_the_mount?.name,
      "Check the Mount",
      "fixture has no move to render on the Rules page"
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
