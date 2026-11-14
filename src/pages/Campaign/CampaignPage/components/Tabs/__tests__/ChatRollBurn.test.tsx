/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

const burnPostMomentum = vi.fn();

import type { PostWithId } from "api-calls/chat/listenToChannelPosts";
import { ROLL_RESULT, ROLL_TYPE } from "types/DieRolls.type";

function missPost(): PostWithId {
  return {
    id: "post-1",
    channelId: "ic",
    authorId: "player-1",
    speakerCharacterId: "kira",
    speakerNpcId: null,
    text: "Kira dives for cover.",
    imagePaths: [],
    roll: {
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
    gmsOnly: false,
    createdAt: "2026-11-13T12:00:00.000Z",
    editedAt: null,
    deletedAt: null,
  };
}

const state = {
  auth: { uid: "player-1" },
  appState: { openDialog: vi.fn() },
  chat: {
    postsByChannel: { ic: [missPost()] } as Record<string, PostWithId[]>,
    hasOlderByChannel: {} as Record<string, boolean>,
    postsLoading: false,
    postsError: undefined as string | undefined,
    loadOlderPosts: vi.fn(),
  },
  campaigns: {
    currentCampaign: {
      characters: {
        characterMap: {
          kira: { uid: "player-1", name: "Kira Vey", momentum: 5 },
        },
      },
      currentCampaign: { gmIds: [] as string[] },
    },
  },
  worlds: { currentWorld: { currentWorldNPCs: { npcMap: {} } } },
  users: {
    userMap: { "player-1": { doc: { displayName: "Sam" } } },
    loadUserDocument: vi.fn(),
    loadUserDocuments: vi.fn(),
  },
  characters: { loadCharacterPortrait: vi.fn(), characterPortraitMap: {} },
  rules: { oracleMaps: { oracleRollableMap: {} } },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock("api-calls/chat/editPost", () => ({
  editPost: () => Promise.resolve(),
}));
vi.mock("api-calls/chat/deletePost", () => ({
  deletePost: () => Promise.resolve(),
}));
vi.mock("api-calls/chat/burnPostMomentum", () => ({
  burnPostMomentum: (...args: unknown[]) => burnPostMomentum(...args),
}));
vi.mock("providers/SnackbarProvider", () => ({
  useSnackbar: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { ChatFeed } from "../ChatFeed";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";

const grey = { light: "#666", main: "#444", dark: "#222", contrastText: "#fff" };
const theme = createTheme({
  palette: { darkGrey: grey },
  fontFamilyTitle: "serif",
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ic: ChannelWithId = {
  id: "ic",
  name: "In character",
  kind: "IC",
  visibility: "public",
  isStarting: true,
  archived: false,
};

// Seam under test: the posted-roll burn button (ticket #125). Only the
// author's own character roll offers a burn, and only when the burn would
// change the outcome. Burns by others, on NPC voices and on already-burned
// rolls offer nothing. The database lock behind the burn is covered by the
// live access-rule tests; here the burn call is stubbed.
describe("ChatFeed posted-roll burn", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    state.auth.uid = "player-1";
    state.chat.postsByChannel = { ic: [missPost()] };
    state.campaigns.currentCampaign.characters.characterMap = {
      kira: { uid: "player-1", name: "Kira Vey", momentum: 5 },
    } as never;
    vi.clearAllMocks();
  });

  function render(): HTMLDivElement {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <ChatFeed channel={ic} />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  function expandRoll(view: HTMLDivElement) {
    const oneLiner = view.querySelector(
      'button[aria-expanded]'
    ) as HTMLButtonElement | null;
    if (!oneLiner) {
      throw new Error("no roll one-liner");
    }
    act(() => {
      oneLiner.click();
    });
  }

  function burnButton(view: HTMLDivElement): HTMLButtonElement | null {
    const buttons = Array.from(view.querySelectorAll("button"));
    return (
      (buttons.find((b) => b.textContent === "Burn momentum") as HTMLButtonElement) ??
      null
    );
  }

  it("offers a burn on the author's own useful roll", () => {
    const view = render();
    expandRoll(view);
    expect(burnButton(view)).not.toBeNull();
  });

  it("offers no burn on nobody else's roll", () => {
    state.auth.uid = "player-2";
    const view = render();
    expandRoll(view);
    expect(burnButton(view)).toBeNull();
  });

  it("offers no burn when momentum would change nothing", () => {
    state.campaigns.currentCampaign.characters.characterMap = {
      kira: { uid: "player-1", name: "Kira Vey", momentum: 1 },
    } as never;
    const view = render();
    expandRoll(view);
    expect(burnButton(view)).toBeNull();
  });

  it("offers no burn on an already-burned roll", () => {
    const burned = missPost();
    if (burned.roll && burned.roll.type === ROLL_TYPE.STAT) {
      burned.roll = {
        ...burned.roll,
        momentumBurned: 5,
        result: ROLL_RESULT.WEAK_HIT,
      };
    }
    state.chat.postsByChannel = { ic: [burned] };
    const view = render();
    expandRoll(view);
    expect(burnButton(view)).toBeNull();
  });

  it("burns through the burn call", async () => {
    burnPostMomentum.mockResolvedValue(undefined);
    const view = render();
    expandRoll(view);
    const button = burnButton(view);
    if (!button) {
      throw new Error("no burn button");
    }
    await act(async () => {
      button.click();
    });
    expect(burnPostMomentum).toHaveBeenCalledWith({ postId: "post-1" });
  });
});
