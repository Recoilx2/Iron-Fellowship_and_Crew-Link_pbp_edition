/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

import { NormalRollActions } from "./NormalRollActions";
import { ROLL_RESULT, ROLL_TYPE, type StatRoll } from "types/DieRolls.type";

function missRoll(): StatRoll {
  return {
    type: ROLL_TYPE.STAT,
    rollLabel: "Edge",
    action: 2,
    modifier: 0,
    challenge1: 3,
    challenge2: 8,
    result: ROLL_RESULT.MISS,
    timestamp: new Date("2026-11-13T12:00:00.000Z"),
    characterId: "kira",
    uid: "player-1",
    gmsOnly: false,
    matchedNegativeMomentum: false,
  };
}

const state = {
  auth: { uid: "player-1" },
  accessibilitySettings: { settings: { verboseRollResults: false } },
  characters: {
    currentCharacter: {
      currentCharacterId: "kira",
      currentCharacter: { momentum: 5 },
      momentumResetValue: 2,
      updateCurrentCharacter: vi.fn(),
    },
  },
  campaigns: {
    currentCampaign: {
      currentCampaignId: undefined as string | undefined,
      currentCampaign: undefined as
        | { gmIds: string[]; type: string }
        | undefined,
      characters: { characterMap: {} },
    },
  },
  worlds: { currentWorld: {} },
  gameLog: { updateRoll: vi.fn(), removeRoll: vi.fn() },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Seam under test: a campaign roll log entry is a chat roll post with
// immutable dice, so the log offers no reroll, momentum burn or delete --
// only copying. Solo entries keep every action. The dice rules behind the
// buttons are covered elsewhere; here only the menu differs.
describe("NormalRollActions in the campaign roll log", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    document.body.innerHTML = "";
    root = undefined;
    container = undefined;
    state.campaigns.currentCampaign.currentCampaignId = undefined;
    state.campaigns.currentCampaign.currentCampaign = undefined;
    vi.clearAllMocks();
  });

  function render() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <NormalRollActions rollId="post-1" roll={missRoll()} />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  function openMenu(view: HTMLDivElement) {
    const more = view.querySelector(
      'button[aria-label="More Roll Options"]'
    ) as HTMLButtonElement;
    act(() => {
      more.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("keeps every action on a solo roll", () => {
    const view = render();
    openMenu(view);

    expect(document.body.textContent).toContain("Reroll Die");
    expect(document.body.textContent).toContain("Burn Momentum");
    expect(document.body.textContent).toContain("Delete Roll");
  });

  it("offers only copying on a campaign roll post", () => {
    state.campaigns.currentCampaign.currentCampaignId = "campaign-1";
    state.campaigns.currentCampaign.currentCampaign = {
      gmIds: [],
      type: "guided",
    };
    const view = render();

    expect(
      view.querySelector('button[aria-label="Copy Roll Result"]')
    ).not.toBeNull();
    openMenu(view);

    expect(document.body.textContent).not.toContain("Reroll Die");
    expect(document.body.textContent).not.toContain("Burn Momentum");
    expect(document.body.textContent).not.toContain("Delete Roll");
  });
});
