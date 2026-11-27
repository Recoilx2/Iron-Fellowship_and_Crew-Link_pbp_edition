import { afterEach, describe, expect, it } from "vitest";
import {
  applyMountedBranding,
  getAppBranding,
  resetBranding,
} from "../branding.config";
import {
  resetActiveRulesetId,
  setActiveRulesetId,
} from "data/activeRuleset";
import { Themes } from "providers/ThemeProvider/themes/theme.types";

afterEach(() => {
  resetBranding();
  resetActiveRulesetId();
});

describe("branding selection", () => {
  it("keeps the shipped games' branding", () => {
    setActiveRulesetId("classic");
    expect(getAppBranding()).toMatchObject({
      appName: "Iron Fellowship",
      title: "Iron Fellowship for Ironsworn",
      faviconPath: "/theme/sunset.svg",
      theme: Themes.Sunset,
    });

    setActiveRulesetId("starforged");
    expect(getAppBranding()).toMatchObject({
      appName: "Crew Link",
      title: "Crew Link for Starforged",
      faviconPath: "/theme/eidolon.svg",
      theme: Themes.Eidolon,
    });
  });

  it("falls back to Ironsworn branding for an unknown id", () => {
    setActiveRulesetId("frontier");
    expect(getAppBranding()).toMatchObject({
      appName: "Iron Fellowship",
      title: "Iron Fellowship for Ironsworn",
      theme: Themes.Sunset,
    });
  });

  it("uses the active ruleset package's title, favicon and theme", () => {
    setActiveRulesetId("frontier");
    applyMountedBranding({
      appName: "Frontier Fellowship",
      title: "Frontier Fellowship",
      description: "A game of frontier oaths",
      faviconPath: "/config/rulesets/frontier-favicon.svg",
      theme: Themes.Hinterlands,
    });

    const branding = getAppBranding();
    expect(branding.appName).toBe("Frontier Fellowship");
    expect(branding.title).toBe("Frontier Fellowship");
    expect(branding.description).toBe("A game of frontier oaths");
    expect(branding.faviconPath).toBe("/config/rulesets/frontier-favicon.svg");
    expect(branding.theme).toBe(Themes.Hinterlands);
  });
});
