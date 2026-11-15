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
const rolls = vi.hoisted(() => ({
  rollStat: vi.fn(),
  rollOracleTable: vi.fn(),
  openDialog: vi.fn(),
  togglePinnedOracle: vi.fn(() => Promise.resolve()),
}));
vi.mock("stores/appState/useRoller", () => ({ useRoller: () => rolls }));
const mobile = vi.hoisted(() => ({ isMobile: false }));
vi.mock("hooks/useIsMobile", () => ({ useIsMobile: () => mobile.isMobile }));
vi.mock("hooks/useSystemOracle", () => ({
  useSystemOracles: () => ({
    askTheOracle: new Proxy({}, { get: () => "oracle_rollable:x/y" }),
  }),
}));
vi.mock(
  "components/features/charactersAndCampaigns/LinkedDialog/LinkedDialogContent/LinkedDialogContentTitle",
  () => ({
    LinkedDialogContentTitle: (props: {
      actions?: React.ReactNode;
      children?: React.ReactNode;
    }) => (
      <div>
        {props.children}
        {props.actions}
      </div>
    ),
  })
);
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
state.settings = {
  pinnedOraclesIds: {},
  togglePinnedOracle: rolls.togglePinnedOracle,
};
(
  state.rules.assetMaps.assetMap as Record<string, unknown>
)["asset:x/mule"] = {
  name: "Mule",
  controls: { load: { field_type: "condition_meter", value: 2 } },
};
state.appState = {
  openDialog: rolls.openDialog,
  openDialogState: { isOpen: true, previousIds: [], openId: "move:x" },
  prevDialog: vi.fn(),
  closeDialog: vi.fn(),
};
state.campaigns = {
  currentCampaign: {
    currentCampaign: undefined,
    assets: { assets: {} },
    updateHiddenOracles: vi.fn(),
  },
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
    assets: {
      assets: { a1: { id: "asset:x/mule", controlValues: { load: 3 } } },
    },
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: TestState) => unknown) => selector(state),
}));

import { MoveRollers } from "../LinkedDialog/LinkedDialogContent/MoveDialogContent/MoveRollers";
import { OracleButton } from "../OracleSection/OracleButton";
import { LinkedDialog } from "../LinkedDialog";
import { MoveAssetControl } from "../LinkedDialog/LinkedDialogContent/MoveDialogContent/MoveAssetControl";
import { OracleDialogContent } from "../LinkedDialog/LinkedDialogContent/OracleDialogContent";
import { OracleListItem } from "../OracleSection/OracleListItem";
import { OracleSelectableRollableCollectionListItem } from "../OracleSection/OracleSelectableRollableCollectionListItem";
import { OracleSection } from "../OracleSection";
import { CATEGORY_VISIBILITY } from "../OracleSection/useFilterOracles";
import { Datasworn } from "@datasworn-community/core";

const theme = createTheme({
  palette: {
    darkGrey: { light: "#666", main: "#444", dark: "#222", contrastText: "#fff" },
  },
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

function inReferenceMode(node: React.ReactNode, on: boolean) {
  return (
    <ReferenceModeContext.Provider value={on}>{node}</ReferenceModeContext.Provider>
  );
}

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

    it("still offers the character's Adds outside reference mode", () => {
      const view = render(<MoveRollers move={faceDanger} />);
      expect(view.textContent).toContain("Adds");
    });
  });

  describe("a move's asset control", () => {
    it("is the character's asset, rolling, outside reference mode", () => {
      const view = render(
        <MoveAssetControl move={faceDanger} control={"load"} />
      );
      expect(rollButtons(view)).toEqual(["Roll Mule +3"]);
    });

    it("is a name chip in reference mode", () => {
      const view = render(
        inReferenceMode(
          <MoveAssetControl move={faceDanger} control={"load"} />,
          true
        )
      );
      expect(rollButtons(view)).toEqual([]);
      expect(view.textContent).toBe("load");
    });
  });

  const actionOracleId = "oracle_rollable:classic/action_and_theme/action";
  const oracles = state.rules.oracleMaps.oracleRollableMap;

  describe("an oracle row", () => {
    function row(on: boolean) {
      return render(
        inReferenceMode(
          <OracleListItem
            oracleId={actionOracleId}
            oracles={oracles}
            visibleOracles={{}}
            collectionVisibility={CATEGORY_VISIBILITY.ALL}
          />,
          on
        )
      );
    }

    it("rolls the oracle when clicked outside reference mode", () => {
      const view = row(false);
      act(() => view.querySelector<HTMLElement>("[role='button']")?.click());
      expect(rolls.rollOracleTable).toHaveBeenCalledTimes(1);
      expect(rolls.openDialog).not.toHaveBeenCalled();
    });

    it("opens the table to read, without rolling, in reference mode", () => {
      const view = row(true);
      act(() => view.querySelector<HTMLElement>("[role='button']")?.click());
      expect(rolls.openDialog).toHaveBeenCalledWith(actionOracleId);
      expect(rolls.rollOracleTable).not.toHaveBeenCalled();
    });
  });

  describe("a shared-text oracle row", () => {
    const collection = {
      _id: "oracle_collection:x/shared",
      name: "Shared",
      oracle_type: "table_shared_text",
      contents: { a: { _id: "oracle_rollable:x/shared.a", name: "A" } },
    } as unknown as Datasworn.OracleTableSharedText;

    function row(on: boolean) {
      return render(
        inReferenceMode(
          <OracleSelectableRollableCollectionListItem collection={collection} />,
          on
        )
      );
    }

    it("rolls the chosen option outside reference mode, with its picker", () => {
      const view = row(false);
      expect(
        view.querySelector("[aria-label='Shared Option']")
      ).not.toBeNull();
      act(() => view.querySelector<HTMLElement>("[role='button']")?.click());
      expect(rolls.rollOracleTable).toHaveBeenCalledWith(
        "oracle_rollable:x/shared.a",
        true
      );
    });

    it("opens the table, with no picker and no roll, in reference mode", () => {
      const view = row(true);
      expect(view.querySelector("[aria-label='Shared Option']")).toBeNull();
      act(() => view.querySelector<HTMLElement>("[role='button']")?.click());
      expect(rolls.openDialog).toHaveBeenCalledWith(collection._id);
      expect(rolls.rollOracleTable).not.toHaveBeenCalled();
    });
  });

  describe("the oracle list header", () => {
    const askButtons = (view: HTMLElement) =>
      Array.from(view.querySelectorAll("button")).filter((button) =>
        ["Small Chance", "Unlikely", "50/50", "Likely", "Almost Certain"].includes(
          button.textContent ?? ""
        )
      );

    it("has the Ask the Oracle buttons outside reference mode", () => {
      expect(askButtons(render(<OracleSection />))).toHaveLength(5);
    });

    it("has none in reference mode, but keeps the filter", () => {
      const view = render(inReferenceMode(<OracleSection />, true));
      expect(askButtons(view)).toHaveLength(0);
      expect(view.querySelector("input[aria-label='Filter Oracles']")).not.toBeNull();
    });
  });

  describe("an oracle's dialog", () => {
    // The oracle's roll button is labelled with the oracle's name.
    const oracleRollButtons = (view: HTMLElement) =>
      Array.from(view.querySelectorAll("button"))
        .map((button) => button.textContent)
        .filter((name) => name === "Action");

    function dialog(on: boolean) {
      return render(
        inReferenceMode(
          <OracleDialogContent
            id={actionOracleId}
            handleBack={vi.fn()}
            handleClose={vi.fn()}
            isLastItem
          />,
          on
        )
      );
    }

    it("can pin the oracle, and roll it, outside reference mode", () => {
      const view = dialog(false);
      expect(view.querySelector("[aria-label='Pin Oracle']")).not.toBeNull();
      expect(oracleRollButtons(view)).toEqual(["Action"]);
    });

    it("has no Pin button and no roll button in reference mode", () => {
      const view = dialog(true);
      expect(view.querySelector("[aria-label='Pin Oracle']")).toBeNull();
      expect(oracleRollButtons(view)).toEqual([]);
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

    it.each(["/rules/", "/rules/anything"])(
      "is also for reading only on %s",
      (path) => {
        render(<LinkedDialog />, path);
        expect(
          document.body.querySelector("[data-testid='mode']")?.textContent
        ).toBe("true");
      }
    );

    it("is a named dialog on phones too, not an unnamed drawer", () => {
      mobile.isMobile = true;
      try {
        render(<LinkedDialog />, "/rules");
        const dialog = document.body.querySelector("[role='dialog']");
        expect(dialog?.getAttribute("aria-modal")).toBe("true");
        expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
        expect(
          document.body.querySelector("[data-testid='mode']")?.textContent
        ).toBe("true");
      } finally {
        mobile.isMobile = false;
      }
    });

    it("rolls as before when opened from any other page", () => {
      render(<LinkedDialog />, "/characters/abc");
      expect(document.body.querySelector("[data-testid='mode']")?.textContent).toBe(
        "false"
      );
    });
  });
});
