/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";
import { classic } from "@datasworn-community/ironsworn-classic";
import { starforged } from "@datasworn-community/starforged";
import { Datasworn } from "@datasworn-community/core";
import { createRulesSlice } from "stores/rules/rules.slice";

const rulesetsMock = vi.hoisted(() => ({
  ruleset: undefined,
  defaultExpansions: {},
  thirdPartyExpansions: {},
  loadIncludedRuleset: vi.fn(),
  loadIncludedExpansion: vi.fn(),
}));
vi.mock("hooks/useGameSystem", () => ({ getSystem: () => "ironsworn" }));
vi.mock("data/rulesets", () => rulesetsMock);

const rollStat = vi.fn();
const rollOracleTable = vi.fn();
const openDialog = vi.fn();
vi.mock("stores/appState/useRoller", () => ({
  useRoller: () => ({ rollStat, rollOracleTable }),
}));
vi.mock("providers/HeadProvider/Head", () => ({ Head: () => null }));
vi.mock("components/shared/Layout/PageHeader", () => ({
  PageHeader: (props: { label?: string }) => <h1>{props.label}</h1>,
}));

type TestState = {
  rules: ReturnType<typeof createRulesSlice>;
  homebrew: { collections: Record<string, unknown>; expansions: Record<string, unknown> };
  [key: string]: unknown;
};

/** Builds the rules exactly as rebuildRules does at runtime. */
function buildState(
  withCharacter: boolean,
  ruleset: Datasworn.Ruleset = classic
): TestState {
  const state = {
    homebrew: { collections: {}, expansions: {} },
  } as TestState;
  state.rules = createRulesSlice(
    ((updater: (store: TestState) => void) => updater(state)) as never,
    (() => state) as never,
    undefined as never
  );
  state.rules.setBaseRuleset(ruleset);
  state.rules.expansionIds = [];
  state.rules.rebuildRules();

  state.appState = { openDialog };
  state.settings = { pinnedOraclesIds: {}, togglePinnedOracle: vi.fn() };
  state.campaigns = {
    currentCampaign: {
      currentCampaign: undefined,
      updateHiddenOracles: vi.fn(),
      assets: { assets: {} },
    },
  };
  // A character being open elsewhere must not turn the page into a roller.
  state.characters = {
    currentCharacter: {
      currentCharacterId: withCharacter ? "char-1" : undefined,
      currentCharacter: withCharacter
        ? {
            campaignId: undefined,
            adds: 0,
            stats: { edge: 2, heart: 2, iron: 1, shadow: 1, wits: 3 },
            conditionMeters: { health: 5, spirit: 5, supply: 5 },
          }
        : undefined,
      updateCurrentCharacter: vi.fn(),
      assets: { assets: {} },
    },
  };
  return state;
}

let state: TestState = buildState(false);
vi.mock("stores/store", () => ({
  useStore: (selector: (store: TestState) => unknown) => selector(state),
}));

import { RulesPage } from "../RulesPage";

const grey = {
  light: "#666",
  main: "#444",
  dark: "#222",
  contrastText: "#fff",
};
const theme = createTheme({
  palette: { darkGrey: grey },
  fontFamilyTitle: "serif",
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; oracle rows measure themselves with one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

// Rendering the whole move and oracle lists of a real ruleset is slow when the
// full suite runs in parallel.
vi.setConfig({ testTimeout: 30000 });

describe("RulesPage", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    state = buildState(false);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  function render() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <RulesPage />
        </ThemeProvider>
      );
    });
    return container;
  }

  function click(element: Element) {
    act(() => {
      (element as HTMLElement).click();
    });
  }

  function buttonNamed(view: HTMLElement, name: string) {
    const match = Array.from(view.querySelectorAll("button, [role='button']")).find(
      (button) => button.textContent?.trim() === name
    );
    if (!match) {
      throw new Error(`No button named ${name}`);
    }
    return match;
  }

  /** The list a section heading names with aria-labelledby. */
  function listNamed(view: HTMLElement, name: string) {
    const list = Array.from(view.querySelectorAll("ul[role='list']")).find(
      (candidate) =>
        document.getElementById(
          candidate.getAttribute("aria-labelledby") ?? ""
        )?.textContent === name
    );
    if (!list) {
      throw new Error(`No list named ${name}`);
    }
    return list;
  }

  /** Opens every move category, then every move, the way a reader would. */
  function expandEveryMove(view: HTMLElement) {
    view
      .querySelectorAll<HTMLElement>("[aria-controls]:not([aria-expanded='true'])")
      .forEach((header) => {
        if (header.getAttribute("aria-expanded") === "false") {
          click(header);
        }
      });
    view
      .querySelectorAll<HTMLElement>("[aria-expanded='false']")
      .forEach((move) => click(move));
  }

  it("lists the moves and expands one in place to its full text", () => {
    const view = render();

    click(buttonNamed(view, "Adventure Moves"));
    const faceDanger = buttonNamed(view, "Face Danger");
    expect(faceDanger.getAttribute("aria-expanded")).toBe("false");

    click(faceDanger);

    expect(faceDanger.getAttribute("aria-expanded")).toBe("true");
    const text = document
      .getElementById(faceDanger.getAttribute("aria-controls") ?? "")
      ?.textContent;
    expect(text).toContain("When you attempt something risky");
    // It expanded in place: no move dialog was asked for.
    expect(openDialog).not.toHaveBeenCalled();
  });

  it("shows the stats and condition meters of the ruleset with their descriptions", () => {
    const view = render();

    const stats = listNamed(view, "Stats");
    // The rules name stats in lower case; the page capitalizes them.
    expect(stats?.textContent).toContain("edge");
    expect(stats?.textContent).toContain("Quickness, agility, and prowess");
    expect(stats?.textContent).toContain("wits");

    const meters = listNamed(view, "Condition Meters");
    expect(meters?.textContent).toContain("Health represents your current");
    expect(meters?.textContent).toContain("Spirit is your current mental state");
    expect(meters?.textContent).toContain("Supply is an abstract");
  });

  it("has one h1 and only the four section headings as h2", () => {
    const view = render();

    const headings = (level: string) =>
      Array.from(view.querySelectorAll(level)).map((heading) =>
        heading.textContent?.trim()
      );
    expect(headings("h1")).toEqual(["Rules"]);
    expect(headings("h2")).toEqual([
      "Stats",
      "Condition Meters",
      "Moves",
      "Oracles",
    ]);
  });

  it("follows the game system: Starforged stats, meters and moves", () => {
    state = buildState(false, starforged);
    const view = render();

    const stats = listNamed(view, "Stats");
    expect(stats.textContent).toContain("edge");
    expect(stats.textContent).toContain(
      "Quickness, agility, and prowess when fighting at a distance."
    );
    expect(listNamed(view, "Condition Meters").textContent).toContain(
      "Health represents your current physical condition and stamina."
    );

    click(buttonNamed(view, "Adventure Moves"));
    const faceDanger = buttonNamed(view, "Face Danger");
    click(faceDanger);
    expect(faceDanger.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(faceDanger.getAttribute("aria-controls") ?? "")
        ?.textContent
    ).toContain("When you attempt something risky");
  });

  it("lists the oracles and opens a table to read, without rolling", () => {
    const view = render();

    expect(view.querySelector("input[aria-label='Filter Oracles']")).not.toBe(
      null
    );
    // The "Ask the Oracle" buttons roll, so they are not part of the page.
    const askButtons = ["Small Chance", "Unlikely", "50/50", "Likely"].filter(
      (label) =>
        Array.from(view.querySelectorAll("button")).some(
          (button) => button.textContent === label
        )
    );
    expect(askButtons).toEqual([]);

    click(buttonNamed(view, "Action and Theme Oracles"));
    const row = buttonNamed(view, "Action");
    click(row);

    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(rollOracleTable).not.toHaveBeenCalled();
  });

  describe.each([
    ["without a character", false],
    ["with a character open elsewhere", true],
  ])("%s", (_label, withCharacter) => {
    beforeEach(() => {
      state = buildState(withCharacter);
    });

    it("has no roll, save or edit control anywhere on the page", () => {
      const view = render();
      expandEveryMove(view);
      click(buttonNamed(view, "Action and Theme Oracles"));

      // Oracle buttons are named after the oracle, so a name match alone
      // cannot prove the page rolls nothing; the dice icon is what every
      // roll control carries (ticket #151). No dice icon anywhere.
      expect(view.querySelectorAll('[data-testid="CasinoIcon"]')).toHaveLength(
        0
      );
      const names = Array.from(
        view.querySelectorAll("button, a, input, select, textarea")
      ).map(
        (control) =>
          control.getAttribute("aria-label") ?? control.textContent ?? ""
      );
      expect(names.filter((name) => /\broll\b/i.test(name))).toEqual([]);
      expect(names.filter((name) => /^(save|add|update)/i.test(name))).toEqual(
        []
      );
      // Only the two filter boxes are inputs; nothing is editable.
      const inputs = Array.from(view.querySelectorAll("input, textarea")).map(
        (input) => input.getAttribute("aria-label")
      );
      expect(inputs.sort()).toEqual(["Filter Moves", "Filter Oracles"]);
      expect(rollStat).not.toHaveBeenCalled();
      expect(rollOracleTable).not.toHaveBeenCalled();
    });
  });
});
