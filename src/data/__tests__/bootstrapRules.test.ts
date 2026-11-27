import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapRules } from "../bootstrapRules";
import {
  resetActiveRulesetId,
  setActiveRulesetId,
} from "data/activeRuleset";
import { resetMechanics } from "config/mechanics.config";
import { getBaseRulesDefaults } from "stores/rules/baseRules";

const replacementRuleset = {
  _id: "frontier",
  oracles: {},
  moves: {},
  assets: {},
  rules: {
    stats: { grit: { label: "Grit" } },
    condition_meters: {},
    special_tracks: {},
    impacts: {},
  },
};

const rulesetsMock = vi.hoisted(() => ({
  ruleset: undefined,
  registerMountedPackages: vi.fn(),
  loadIncludedRuleset: vi.fn(),
}));
vi.mock("hooks/useGameSystem", () => ({ getSystem: () => "ironsworn" }));
vi.mock("data/rulesets", () => rulesetsMock);

describe("async ruleset bootstrap", () => {
  beforeEach(() => {
    resetActiveRulesetId();
    resetMechanics();
    rulesetsMock.registerMountedPackages.mockReset();
    rulesetsMock.loadIncludedRuleset.mockReset();
    rulesetsMock.registerMountedPackages.mockResolvedValue(undefined);
    rulesetsMock.loadIncludedRuleset.mockResolvedValue(replacementRuleset);
  });

  afterEach(() => {
    resetActiveRulesetId();
    resetMechanics();
  });

  it("registers mounted packages before reading the active ruleset", async () => {
    await bootstrapRules();

    expect(rulesetsMock.registerMountedPackages).toHaveBeenCalledOnce();
    expect(
      rulesetsMock.registerMountedPackages.mock.invocationCallOrder[0],
    ).toBeLessThan(rulesetsMock.loadIncludedRuleset.mock.invocationCallOrder[0]);
  });

  it("derives defaults from the replacing ruleset after it is registered", async () => {
    rulesetsMock.registerMountedPackages.mockImplementation(async () => {
      setActiveRulesetId("frontier");
    });

    const ruleset = await bootstrapRules();

    expect(ruleset._id).toBe("frontier");
    expect(rulesetsMock.loadIncludedRuleset).toHaveBeenCalledWith();
    expect(getBaseRulesDefaults().ruleset).toBe(replacementRuleset);
    expect(getBaseRulesDefaults().stats).toHaveProperty("grit");
  });
});
