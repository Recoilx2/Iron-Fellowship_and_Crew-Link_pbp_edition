/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

const createPost = vi.fn();

const state = {
  auth: { uid: "player-1", user: { displayName: "Sam" } },
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
    setDraft: (channelId: string, text: string) => {
      if (text.length === 0) {
        delete state.chat.drafts[channelId];
      } else {
        state.chat.drafts[channelId] = text;
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
  visibility: "public" as const,
  isStarting: true,
  archived: false,
};
const ooc = {
  id: "ooc",
  name: "Out of character",
  kind: "OOC" as const,
  visibility: "public" as const,
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
    });
    expect(state.chat.drafts["ic"]).toBeUndefined();
  });
});
