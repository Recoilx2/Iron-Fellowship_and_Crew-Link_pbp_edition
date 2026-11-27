import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHomebrewSlice } from "../homebrew.slice";
import { defaultHomebrewSlice } from "../homebrew.slice.default";
import { createRulesSlice } from "../../rules/rules.slice";

const mountedExpansion = JSON.parse(
  readFileSync(
    new URL(
      "../../../../supabase/site/config/rulesets/mounted_e2e.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

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

const MOUNTED_MOVE_ID = "move:mounted_e2e/mounted/check_the_mount";

const rulesetsMock = vi.hoisted(() => ({
  ruleset: undefined,
  defaultExpansions: {} as Record<string, unknown>,
  thirdPartyExpansions: {} as Record<string, unknown>,
  findIncludedExpansionConfig: vi.fn(),
  loadIncludedRuleset: vi.fn(),
  loadIncludedExpansion: vi.fn(),
  registerMountedPackages: vi.fn(),
}));

vi.mock("hooks/useGameSystem", () => ({
  getSystem: () => "ironsworn",
}));

vi.mock("data/rulesets", () => rulesetsMock);

type TestState = {
  homebrew: ReturnType<typeof createHomebrewSlice>;
  rules: ReturnType<typeof createRulesSlice>;
};

function createTestState(): TestState {
  const state = {
    homebrew: { ...defaultHomebrewSlice },
    rules: {},
  } as TestState;
  const set = (updater: (store: TestState) => void) => updater(state);
  state.homebrew = createHomebrewSlice(
    set as never,
    (() => state) as never,
    undefined as never,
  );
  state.rules = createRulesSlice(
    set as never,
    (() => state) as never,
    undefined as never,
  );
  return state;
}

describe("homebrew listener teardown", () => {
  beforeEach(() => {
    rulesetsMock.defaultExpansions = {};
    rulesetsMock.thirdPartyExpansions = {};
    rulesetsMock.findIncludedExpansionConfig.mockReset();
    rulesetsMock.findIncludedExpansionConfig.mockImplementation((id: string) =>
      id === "mounted_e2e"
        ? { id, name: "Mounted Test Expansion", type: "expansion" }
        : undefined,
    );
    rulesetsMock.loadIncludedRuleset.mockResolvedValue(baseRuleset);
    rulesetsMock.loadIncludedExpansion.mockImplementation(async (id: string) => {
      if (id !== "mounted_e2e") return undefined;
      rulesetsMock.thirdPartyExpansions[id] = mountedExpansion;
      return mountedExpansion;
    });
    rulesetsMock.registerMountedPackages.mockResolvedValue(undefined);
  });

  it("keeps a mounted expansion and its rules after listener cleanup", async () => {
    const state = createTestState();
    await state.rules.loadBaseRuleset();

    const unsubscribe = state.homebrew.subscribeToHomebrewContent([
      "mounted_e2e",
    ]);
    expect(state.rules.expansionIds).toContain("mounted_e2e");
    expect(state.rules.moveMaps.moveMap).toHaveProperty(MOUNTED_MOVE_ID);

    unsubscribe();

    expect(state.rules.expansionIds).toContain("mounted_e2e");
    expect(state.rules.moveMaps.moveMap).toHaveProperty(MOUNTED_MOVE_ID);
  });
});
