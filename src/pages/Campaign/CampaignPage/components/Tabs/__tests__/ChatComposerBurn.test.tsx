/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";
import { ROLL_RESULT, ROLL_TYPE } from "types/DieRolls.type";

const updateCharacter = vi.fn();
const createPost = vi.fn((params: unknown) => {
  void params;
  return Promise.resolve("post-1");
});
const success = vi.fn();

const state = {
  auth: { uid: "player-1", user: { displayName: "Sam" } },
  accessibilitySettings: { settings: { verboseRollResults: false } },
  appState: { openDialog: vi.fn() },
  characters: { currentCharacter: { assets: { assets: {} } } },
  rules: {
    rootMoveCollectionIds: [],
    moveMaps: { moveCategoryMap: {} },
    stats: { edge: { label: "Edge" } },
    conditionMeters: {},
    oracleMaps: { oracleRollableMap: {} },
    assetMaps: { assetMap: {} },
  },
  campaigns: {
    currentCampaign: {
      assets: { assets: {} },
      characters: {
        characterMap: {
          kira: {
            uid: "player-1",
            name: "Kira Vey",
            stats: { edge: 2 },
            conditionMeters: {},
            momentum: 5,
            debilities: {},
          },
        },
      },
      currentCampaign: {
        gmIds: [] as string[],
        worldId: undefined as string | undefined,
        conditionMeters: {},
      },
    },
  },
  worlds: { currentWorld: { currentWorldNPCs: { npcMap: {} } } },
  chat: {
    drafts: {} as Record<string, string>,
    pendingRolls: {
      ic: {
        type: ROLL_TYPE.STAT,
        rollLabel: "Edge",
        action: 2,
        challenge1: 3,
        challenge2: 8,
        result: ROLL_RESULT.MISS,
        timestamp: new Date("2026-11-13T12:00:00.000Z"),
        characterId: "kira",
        uid: "player-1",
        gmsOnly: false,
      },
    } as Record<string, unknown>,
    setDraft: vi.fn(),
    setPendingRoll: (channelId: string, roll: unknown) => {
      if (roll === null || roll === undefined) {
        delete state.chat.pendingRolls[channelId];
      } else {
        state.chat.pendingRolls[channelId] = roll;
      }
    },
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock("api-calls/chat/createPost", () => ({
  createPost: (params: unknown) => createPost(params),
}));
vi.mock("api-calls/chat/chatImages", () => ({
  uploadChatImage: () => Promise.resolve("path"),
  removeChatImage: () => Promise.resolve(),
}));
vi.mock("api-calls/character/updateCharacter", () => ({
  updateCharacter: (...args: unknown[]) => updateCharacter(...args),
}));
vi.mock("providers/SnackbarProvider", () => ({
  useSnackbar: () => ({ success, error: vi.fn() }),
}));
vi.mock("hooks/useHide3dDice", () => ({
  useHide3dDice: () => true,
}));

import { ChatComposer } from "../ChatComposer";

const grey = { light: "#666", main: "#444", dark: "#222", contrastText: "#fff" };
const theme = createTheme({
  palette: { darkGrey: grey },
  fontFamilyTitle: "serif",
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ic = {
  id: "ic",
  name: "In character",
  kind: "IC" as const,
  visibility: "public" as const,
  isStarting: true,
  archived: false,
};

// Seam under test: the composer burn button (ticket #125). A waiting action
// roll that momentum would lift offers a burn; burning stamps the draft
// with the recalculated outcome without spending anything, so sending
// posts the burned result and the database spends the momentum in the same
// transaction. Discarding the draft or a failed send spends nothing.
describe("ChatComposer burn momentum", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.clearAllMocks();
    state.chat.drafts = {};
    state.chat.pendingRolls = {
      ic: {
        type: ROLL_TYPE.STAT,
        rollLabel: "Edge",
        action: 2,
        challenge1: 3,
        challenge2: 8,
        result: ROLL_RESULT.MISS,
        timestamp: new Date("2026-11-13T12:00:00.000Z"),
        characterId: "kira",
        uid: "player-1",
        gmsOnly: false,
      },
    };
  });

  function render(): HTMLDivElement {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <ChatComposer channel={ic} campaignId={"campaign-1"} />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  it("offers a burn on a useful draft roll", () => {
    const view = render();
    const buttons = Array.from(view.querySelectorAll("button"));
    expect(
      buttons.some((b) => b.textContent === "Burn momentum")
    ).toBe(true);
  });

  it("stamps the draft without spending momentum", async () => {
    updateCharacter.mockResolvedValue(undefined);
    const view = render();
    const button = Array.from(view.querySelectorAll("button")).find(
      (b) => b.textContent === "Burn momentum"
    ) as HTMLButtonElement;
    if (!button) {
      throw new Error("no burn button");
    }
    await act(async () => {
      button.click();
    });
    // Nothing is spent until the post is sent: the character update must
    // never fire from the draft button, so a discarded draft or a failed
    // send loses no momentum. The mock stays as a regression guard.
    expect(updateCharacter).not.toHaveBeenCalled();
    const pending = state.chat.pendingRolls["ic"] as {
      momentumBurned: number;
      result: number;
    };
    expect(pending.momentumBurned).toBe(5);
    expect(pending.result).toBe(ROLL_RESULT.WEAK_HIT);
    expect(success).toHaveBeenCalled();
  });

  it("keeps the burned draft and shows a referenced error when sending fails", async () => {
    createPost.mockRejectedValueOnce(new Error("database down"));
    state.chat.drafts = { ic: "Kira dives." };
    const view = render();
    // Stamp the burn first: the failed send below must spend nothing.
    const burn = Array.from(view.querySelectorAll("button")).find(
      (b) => b.textContent === "Burn momentum"
    ) as HTMLButtonElement;
    await act(async () => {
      burn.click();
    });
    expect(updateCharacter).not.toHaveBeenCalled();
    const send = view.querySelector(
      'button[aria-label="Send"]'
    ) as HTMLButtonElement;
    await act(async () => {
      send.click();
    });
    expect(createPost).toHaveBeenCalled();
    const alerts = Array.from(view.querySelectorAll('[role="alert"]'));
    expect(
      alerts.some((a) => /ref: [A-Z0-9]{6}/.test(a.textContent ?? ""))
    ).toBe(true);
    // The draft survives for a retry: words kept, burn stamp kept.
    expect(state.chat.setDraft).not.toHaveBeenCalledWith("ic", "");
    const pending = state.chat.pendingRolls["ic"] as {
      momentumBurned: number;
    };
    expect(pending.momentumBurned).toBe(5);
  });
});
