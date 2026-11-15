/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";
import { MemoryRouter } from "react-router-dom";
import { classic } from "@datasworn-community/ironsworn-classic";
import { createRulesSlice } from "stores/rules/rules.slice";
import { ReferenceModeContext, useReferenceMode } from "hooks/useReferenceMode";

/**
 * Reference mode (the Rules page) switches rolling and character values off.
 * These tests pin the other half: outside it, every caller is unchanged.
 */

const rulesetsMock = vi.hoisted(() => ({
  ruleset: undefined,
  defaultExpansions: {},
  thirdPartyExpansions: {},
  loadIncludedRuleset: vi.fn(),
  loadIncludedExpansion: vi.fn(),
}));
vi.mock("hooks/useGameSystem", () => ({ getSystem: () => "ironsworn" }));
vi.mock("data/rulesets", () => rulesetsMock);
vi.mock("stores/appState/useRoller", () => ({
  useRoller: () => ({ rollStat: vi.fn(), rollOracleTable: vi.fn() }),
}));
vi.mock("@datasworn-community/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@datasworn-community/core")>()),
  IdParser: {
    get: () => ({
      type: "oracle_rollable",
      oracle_type: "table_text",
      name: "Action",
    }),
  },
}));
vi.mock(
  "components/features/charactersAndCampaigns/LinkedDialog/LinkedDialogContent",
  async () => {
    const { useReferenceMode: useMode } = await import("hooks/useReferenceMode");
    return {
      LinkedDialogContent: () => (
        <p data-testid={"mode"}>{String(useMode())}</p>
      ),
    };
  }
);

type TestState = {
  rules: ReturnType<typeof createRulesSlice>;
  [key: string]: unknown;
};

const state = {
  homebrew: { collections: {}, expansions: {} },
} as unknown as TestState;
state.rules = createRulesSlice(
  ((updater: (store: TestState) => void) => updater(state)) as never,
  (() => state) as never,
  undefined as never
);
state.rules.setBaseRuleset(classic);
state.rules.expansionIds = [];
state.rules.rebuildRules();
state.appState = {
  openDialogState: { isOpen: true, previousIds: [], openId: "move:x" },
  prevDialog: vi.fn(),
  closeDialog: vi.fn(),
};
state.campaigns = {
  currentCampaign: { currentCampaign: undefined, assets: { assets: {} } },
};
state.characters = {
  currentCharacter: {
    currentCharacterId: "char-1",
    currentCharacter: {
      campaignId: undefined,
      adds: 0,
      stats: { edge: 2, heart: 2, iron: 1, shadow: 1, wits: 3 },
      conditionMeters: { health: 5, spirit: 5, supply: 5 },
    },
    updateCurrentCharacter: vi.fn(),
    assets: { assets: {} },
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: TestState) => unknown) => selector(state),
}));

import { MoveRollers } from "../LinkedDialog/LinkedDialogContent/MoveDialogContent/MoveRollers";
import { OracleButton } from "../OracleSection/OracleButton";
import { LinkedDialog } from "../LinkedDialog";

const theme = createTheme({
  palette: {
    darkGrey: { light: "#666", main: "#444", dark: "#222", contrastText: "#fff" },
  },
  fontFamilyTitle: "serif",
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("reference mode", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  function render(node: React.ReactNode, path = "/characters/abc") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
        </ThemeProvider>
      );
    });
    return container;
  }

  const faceDanger = classic.moves.adventure.contents.face_danger;
  const rollButtons = (view: HTMLElement) =>
    Array.from(view.querySelectorAll("button"))
      .map((button) => button.getAttribute("aria-label") ?? button.textContent)
      .filter((name) => /^roll\b/i.test(name ?? ""));

  it("is off by default", () => {
    let seen: boolean | undefined;
    function Probe() {
      seen = useReferenceMode();
      return null;
    }
    render(<Probe />);
    expect(seen).toBe(false);
  });

  describe("a move's stats", () => {
    it("still roll from the character's values outside reference mode", () => {
      const view = render(<MoveRollers move={faceDanger} />);
      expect(rollButtons(view)).toEqual([
        "Roll edge +2",
        "Roll heart +2",
        "Roll iron +1",
        "Roll shadow +1",
        "Roll wits +3",
      ]);
    });

    it("show by name only, with no character values, in reference mode", () => {
      const view = render(
        <ReferenceModeContext.Provider value={true}>
          <MoveRollers move={faceDanger} />
        </ReferenceModeContext.Provider>
      );
      expect(rollButtons(view)).toEqual([]);
      expect(view.textContent).toBe("edgeheartironshadowwits");
      expect(view.textContent).not.toContain("Adds");
    });
  });

  describe("an oracle's roll button", () => {
    it("rolls outside reference mode", () => {
      const view = render(<OracleButton oracleId={"oracle_rollable:x/y"} />);
      expect(view.querySelectorAll("button")).toHaveLength(1);
    });

    it("is not there in reference mode", () => {
      const view = render(
        <ReferenceModeContext.Provider value={true}>
          <OracleButton oracleId={"oracle_rollable:x/y"} />
        </ReferenceModeContext.Provider>
      );
      expect(view.querySelectorAll("button")).toHaveLength(0);
    });
  });

  describe("the move and oracle dialog", () => {
    it("is for reading only when opened from the Rules page", () => {
      render(<LinkedDialog />, "/rules");
      expect(document.body.querySelector("[data-testid='mode']")?.textContent).toBe(
        "true"
      );
    });

    it("rolls as before when opened from any other page", () => {
      render(<LinkedDialog />, "/characters/abc");
      expect(document.body.querySelector("[data-testid='mode']")?.textContent).toBe(
        "false"
      );
    });
  });
});
