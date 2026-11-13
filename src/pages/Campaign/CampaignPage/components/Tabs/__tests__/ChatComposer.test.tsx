/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

const createPost = vi.fn();

const state = {
  auth: { uid: "player-1", user: { displayName: "Sam" } },
  accessibilitySettings: { settings: { verboseRollResults: false } },
  campaigns: {
    currentCampaign: {
      characters: {
        characterMap: {
          kira: { uid: "player-1", name: "Kira Vey" },
        },
      },
      currentCampaign: { gmIds: [] as string[] },
    },
  },
  chat: {
    drafts: {} as Record<string, string>,
    pendingRolls: {} as Record<string, unknown>,
    setDraft: (channelId: string, text: string) => {
      if (text.length === 0) {
        delete state.chat.drafts[channelId];
      } else {
        state.chat.drafts[channelId] = text;
      }
    },
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
  createPost: (...args: unknown[]) => createPost(...args),
}));

import { ChatComposer } from "../ChatComposer";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ic = {
  id: "ic",
  name: "In character",
  kind: "IC" as const,
  isStarting: true,
  archived: false,
};
const ooc = {
  id: "ooc",
  name: "Out of character",
  kind: "OOC" as const,
  isStarting: true,
  archived: false,
};

// Seam under test: the composer artists see. The channel kind picks the
// speaker (players have no picker), and the text box keeps its unsent
// draft per channel for the session. Posting itself is covered by the
// data-layer live tests and the browser test; here the composer is a stub
// around a mocked post call.
describe("ChatComposer", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    state.chat.drafts = {};
    state.chat.pendingRolls = {};
    state.auth.uid = "player-1";
    state.campaigns.currentCampaign.currentCampaign.gmIds = [];
    vi.clearAllMocks();
  });

  function render(channel: ChannelWithId) {
    if (!container) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <ChatComposer channel={channel} />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  function textBox(view: HTMLDivElement): HTMLTextAreaElement {
    const box = view.querySelector("textarea");
    if (!box) {
      throw new Error("no composer text box");
    }
    return box as HTMLTextAreaElement;
  }

  function typeText(box: HTMLTextAreaElement, text: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(box, text);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("posts in character as the player's campaign character", () => {
    const view = render(ic);
    expect(view.textContent).toContain("Posting as");
    expect(view.textContent).toContain("Kira Vey");
  });

  it("posts out of character as self", () => {
    const view = render(ooc);
    expect(view.textContent).toContain("Posting as");
    expect(view.textContent).toContain("Sam");
    // The player's character stands beside the OOC name, so readers know
    // whose voice the table talk sits next to.
    expect(view.textContent).toContain("Kira Vey (out of character)");
  });

  it("keeps the unsent draft when channels switch", () => {
    const view = render(ic);
    typeText(textBox(view), "half a post");
    expect(state.chat.drafts["ic"]).toBe("half a post");

    render(ooc);
    expect(textBox(view).value).toBe("");

    typeText(textBox(view), "ooc thought");
    render(ic);
    expect(textBox(view).value).toBe("half a post");

    render(ooc);
    expect(textBox(view).value).toBe("ooc thought");
  });

  it("clears the draft after sending", async () => {
    createPost.mockResolvedValue("post-1");
    const view = render(ic);
    typeText(textBox(view), "we push on");
    // The mocked store holds the draft outside React: re-render so the
    // composer picks the typed text up and enables Send.
    render(ic);

    const send = view.querySelector(
      'button[aria-label="Send"]'
    ) as HTMLButtonElement | null;
    if (!send) {
      throw new Error("no send button");
    }
    await act(async () => {
      send.click();
    });

    expect(createPost).toHaveBeenCalledWith({
      channelId: "ic",
      text: "we push on",
      speakerCharacterId: "kira",
      roll: null,
      gmsOnly: undefined,
    });
    expect(state.chat.drafts["ic"]).toBeUndefined();
  });

  it("offers the player move and stat rolls beside the oracle buttons", () => {
    const view = render(ic);
    for (const label of ["Move", "Stat", "Ask the Oracle", "Oracles", "Dice"]) {
      const button = Array.from(view.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === label
      );
      if (!button) {
        throw new Error(`no ${label} roll button`);
      }
    }
  });

  it("offers the GM only oracle buttons behind the eye toggle", () => {
    state.auth.uid = "gm-1";
    state.campaigns.currentCampaign.currentCampaign.gmIds = ["gm-1"];
    const view = render(ic);
    const labels = Array.from(view.querySelectorAll("button")).map(
      (button) => button.textContent
    );
    expect(labels).not.toContain("Move");
    expect(labels).not.toContain("Stat");
    for (const label of ["Ask the Oracle", "Oracles", "Dice"]) {
      expect(labels).toContain(label);
    }
    // The eye toggle starts open: the GM's rolls reach the players.
    const toggle = view.querySelector(
      'button[aria-label="Hide my rolls from players"]'
    );
    if (!toggle) {
      throw new Error("no GM eye toggle");
    }
  });
});
