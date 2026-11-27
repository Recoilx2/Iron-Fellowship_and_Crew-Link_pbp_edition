import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  defaultExpansions,
  findIncludedExpansionConfig,
  loadIncludedExpansion,
  loadIncludedRuleset,
  preloadActiveRuleset,
  registerMountedPackages,
  resetMountedPackagesRegistration,
  thirdPartyExpansions,
} from "../rulesets";
import {
  getActiveRulesetId,
  resetActiveRulesetId,
} from "data/activeRuleset";
import { getAppBranding, resetBranding } from "config/branding.config";
import { getMechanics, resetMechanics } from "config/mechanics.config";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../supabase/site/${name}`, import.meta.url),
      "utf8",
    ),
  );

vi.mock("hooks/useGameSystem", () => ({
  getSystem: () => "ironsworn",
}));

describe("ruleset lazy loaders", () => {
  beforeEach(() => {
    resetMountedPackagesRegistration();
    resetActiveRulesetId();
    resetBranding();
    resetMechanics();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetActiveRulesetId();
    resetBranding();
    resetMechanics();
  });

  it("loads the active base ruleset on demand", async () => {
    const ruleset = await loadIncludedRuleset();

    expect(ruleset._id).toMatch(/^(classic|starforged)$/);
    expect(Object.keys(ruleset.rules.stats).length).toBeGreaterThan(0);
  });

  it("preloads the active base ruleset at startup", async () => {
    const ruleset = await preloadActiveRuleset();

    expect(ruleset._id).toBe("classic");
    expect(Object.keys(ruleset.rules.stats).length).toBeGreaterThan(0);
  });

  it("can identify included expansions before their data is cached", () => {
    delete defaultExpansions.delve;
    delete thirdPartyExpansions.delve;

    expect(findIncludedExpansionConfig("delve")?.id).toBe("delve");
    expect(defaultExpansions.delve).toBeUndefined();
    expect(thirdPartyExpansions.delve).toBeUndefined();
  });

  it("loads included official expansions into the default expansion cache", async () => {
    delete defaultExpansions.delve;

    const expansion = await loadIncludedExpansion("delve");

    expect(expansion?._id).toBe("delve");
    expect(defaultExpansions.delve?._id).toBe("delve");
  });

  it("loads included third-party expansions into the third-party expansion cache", async () => {
    delete thirdPartyExpansions.ironsmith;

    const expansion = await loadIncludedExpansion("ironsmith");

    expect(expansion?._id).toBe("ironsmith");
    expect(thirdPartyExpansions.ironsmith?._id).toBe("ironsmith");
  });

  it("can identify lodestar as an included expansion before its data is cached", () => {
    delete defaultExpansions.lodestar;

    expect(findIncludedExpansionConfig("lodestar")?.id).toBe("lodestar");
    expect(defaultExpansions.lodestar).toBeUndefined();
  });

  it("loads lodestar into the default expansion cache", async () => {
    delete defaultExpansions.lodestar;

    const expansion = await loadIncludedExpansion("lodestar");

    expect(expansion?._id).toBe("lodestar");
    expect(defaultExpansions.lodestar?._id).toBe("lodestar");
  });

  it("registers a mounted expansion in the registries and expansion cache", async () => {
    const pkg = JSON.parse(
      readFileSync(
        new URL(
          "../../../supabase/site/config/rulesets/mounted_e2e.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url === "/config/rulesets/manifest.json"
            ? {
                version: 1,
                expansions: [
                  {
                    id: "mounted_e2e",
                    path: "/config/rulesets/mounted_e2e.json",
                    name: "Mounted Test Expansion",
                    type: "expansion",
                    isHomebrew: true,
                  },
                ],
              }
            : pkg,
      })),
    );

    try {
      await registerMountedPackages();

      expect(findIncludedExpansionConfig("mounted_e2e")?.name).toBe(
        "Mounted Test Expansion",
      );
      expect(thirdPartyExpansions.mounted_e2e?._id).toBe("mounted_e2e");
      expect((await loadIncludedExpansion("mounted_e2e"))?._id).toBe(
        "mounted_e2e",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("registers a replacing base ruleset and its branding and mechanics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path =
          url === "/config/rulesets/manifest.json"
            ? "config-replacement/manifest.json"
            : url.endsWith("/frontier.json")
              ? "config-replacement/frontier.json"
              : undefined;
        return {
          ok: path !== undefined,
          status: path === undefined ? 404 : 200,
          json: async () => (path === undefined ? {} : fixture(path)),
        };
      }),
    );

    await registerMountedPackages();

    expect(getActiveRulesetId()).toBe("frontier");
    expect((await loadIncludedRuleset())._id).toBe("frontier");
    expect(getAppBranding().title).toBe("Frontier Fellowship");
    expect(getMechanics().progressTracks).toEqual(["Oath", "Trail", "Peril"]);
    expect(getMechanics().actionTotalCap).toBe(12);
  });
});
