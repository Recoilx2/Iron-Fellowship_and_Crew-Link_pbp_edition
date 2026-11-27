import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRulesSlice } from "../rules.slice";
import {
  resetActiveRulesetId,
  setActiveRulesetId,
} from "data/activeRuleset";
import { applyMechanics, resetMechanics } from "config/mechanics.config";

const baseRuleset = {
  _id: "classic",
  oracles: {},
  moves: {},
  assets: {},
  truths: {},
  rules: {
    stats: { edge: { label: "Edge" } },
    condition_meters: {},
    special_tracks: {},
    impacts: {},
  },
};

const delveExpansion = {
  _id: "delve",
  oracles: {},
  moves: {},
  assets: {},
  truths: {},
  rules: {
    stats: { shadow: { label: "Shadow" } },
    condition_meters: {},
    special_tracks: {},
    impacts: {},
  },
};

const replacementRuleset = {
  _id: "frontier",
  oracles: {},
  moves: {},
  assets: {},
  truths: {},
  rules: {
    stats: { grit: { label: "Grit" } },
    condition_meters: {},
    special_tracks: {},
    impacts: {},
  },
};

const mountedExpansion = {
  _id: "mounted_e2e",
  oracles: {},
  moves: {},
  assets: {},
  truths: {},
  rules: {
    stats: { mounted_stat: { label: "Mounted" } },
    condition_meters: {},
    special_tracks: {},
    impacts: {},
  },
};

const rulesetsMock = vi.hoisted(() => ({
  ruleset: undefined,
  defaultExpansions: {} as Record<string, unknown>,
  thirdPartyExpansions: {} as Record<string, unknown>,
  loadIncludedRuleset: vi.fn(),
  loadIncludedExpansion: vi.fn(),
  registerMountedPackages: vi.fn(),
}));

vi.mock("hooks/useGameSystem", () => ({
  getSystem: () => "ironsworn",
}));

vi.mock("data/rulesets", () => rulesetsMock);

type TestState = {
  rules: ReturnType<typeof createRulesSlice>;
  homebrew: {
    collections: Record<string, unknown>;
    expansions: Record<string, typeof delveExpansion>;
  };
};

function createTestState(): TestState {
  const state = {
    homebrew: {
      collections: {},
      expansions: {},
    },
  } as TestState;

  const set = (updater: (store: TestState) => void) => {
    updater(state);
  };

  state.rules = createRulesSlice(
    set as never,
    (() => state) as never,
    undefined as never,
  );

  return state;
}

describe("createRulesSlice lazy loading", () => {
  beforeEach(() => {
    resetActiveRulesetId();
    resetMechanics();
    delete rulesetsMock.defaultExpansions.delve;
    delete rulesetsMock.thirdPartyExpansions.delve;
    delete rulesetsMock.thirdPartyExpansions.mounted_e2e;
    rulesetsMock.loadIncludedRuleset.mockClear();
    rulesetsMock.loadIncludedExpansion.mockClear();
    rulesetsMock.registerMountedPackages.mockReset();
    rulesetsMock.registerMountedPackages.mockResolvedValue(undefined);
    rulesetsMock.loadIncludedRuleset.mockResolvedValue(baseRuleset);
    rulesetsMock.loadIncludedExpansion.mockImplementation(async (id: string) => {
      if (id !== "delve") {
        return undefined;
      }

      rulesetsMock.defaultExpansions.delve = delveExpansion;
      return delveExpansion;
    });
  });

  afterEach(() => {
    resetActiveRulesetId();
    resetMechanics();
  });

  it("loads and applies the base ruleset on demand", async () => {
    const state = createTestState();

    await state.rules.loadBaseRuleset();

    expect(rulesetsMock.loadIncludedRuleset).toHaveBeenCalled();
    expect(state.rules.baseRuleset?._id).toBe("classic");
    expect(state.rules.stats).toHaveProperty("edge");
  });

  it("registers mounted packages before building the base rules", async () => {
    rulesetsMock.registerMountedPackages.mockImplementation(async () => {
      rulesetsMock.thirdPartyExpansions.mounted_e2e = mountedExpansion;
    });

    const state = createTestState();

    await state.rules.loadBaseRuleset();

    expect(rulesetsMock.registerMountedPackages).toHaveBeenCalledOnce();
    expect(
      rulesetsMock.registerMountedPackages.mock.invocationCallOrder[0],
    ).toBeLessThan(rulesetsMock.loadIncludedRuleset.mock.invocationCallOrder[0]);
    state.rules.setExpansionIds(["mounted_e2e"]);
    expect(state.rules.stats).toHaveProperty("mounted_stat");
  });

  it("loads included expansions and rebuilds rules after they resolve", async () => {
    const state = createTestState();
    state.rules.setBaseRuleset(baseRuleset as never);
    state.rules.expansionIds = ["delve"];

    await state.rules.loadIncludedExpansions(["delve"]);

    expect(rulesetsMock.loadIncludedExpansion).toHaveBeenCalledWith("delve");
    expect(state.rules.stats).toHaveProperty("edge");
    expect(state.rules.stats).toHaveProperty("shadow");
  });

  it("applies a replacing ruleset and rebuilds its progress tracks", async () => {
    rulesetsMock.registerMountedPackages.mockImplementation(async () => {
      setActiveRulesetId("frontier");
      applyMechanics({ progressTracks: ["Oath", "Trail", "Peril"] });
    });
    rulesetsMock.loadIncludedRuleset.mockResolvedValue(replacementRuleset);

    const state = createTestState();

    await state.rules.loadBaseRuleset();

    expect(state.rules.activeRulesetId).toBe("frontier");
    expect(state.rules.baseRuleset?._id).toBe("frontier");
    expect(state.rules.stats).toHaveProperty("grit");
    expect(state.rules.progressTracks).toEqual(["Oath", "Trail", "Peril"]);
  });

  it("triggers included expansion loading when expansion IDs change", async () => {
    const state = createTestState();
    state.rules.setBaseRuleset(baseRuleset as never);

    state.rules.setExpansionIds(["delve"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rulesetsMock.loadIncludedExpansion).toHaveBeenCalledWith("delve");
    expect(state.rules.stats).toHaveProperty("shadow");
  });
});
