/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

const loadUserDocuments = vi.fn();

const state = {
  appState: { openDialog: vi.fn() },
  chat: {
    postsByChannel: {
      ic: [
        {
          id: "post-1",
          channelId: "ic",
          authorId: "gm-1",
          speakerCharacterId: null,
          speakerNpcId: "elder",
          text: "The bog remembers.",
          createdAt: "2026-11-13T12:00:00.000Z",
        },
      ],
    } as Record<string, Array<Record<string, unknown>>>,
    hasOlderByChannel: {} as Record<string, boolean>,
    postsLoading: false,
    postsError: undefined as string | undefined,
    loadOlderPosts: vi.fn(),
  },
  campaigns: {
    currentCampaign: {
      characters: { characterMap: {} },
      currentCampaign: { gmIds: ["gm-1"] },
    },
  },
  worlds: {
    currentWorld: {
      currentWorldNPCs: {
        npcMap: {
          elder: { name: "Elder Moss", imageUrl: "https://img/elder.png" },
        } as Record<string, { name: string; imageUrl?: string }>,
      },
    },
  },
  users: {
    userMap: { "gm-1": { doc: { displayName: "Grem" } } },
    loadUserDocuments,
    loadUserDocument: vi.fn(),
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));

import { ChatFeed } from "../ChatFeed";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const channel = {
  id: "ic",
  name: "In character",
  kind: "IC" as const,
  isStarting: true,
  archived: false,
};

// Seam under test: the feed readers see. A GM's NPC voice shows the NPC's
// name and portrait with a GM tag beside the author, in any channel. Plain
// character and self posts keep the shapes the earlier tickets gave them.
describe("ChatFeed NPC voices", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.clearAllMocks();
  });

  function render() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <ChatFeed channel={channel} />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  it("shows the NPC as speaker and that a GM posted it", () => {
    const view = render();

    expect(view.textContent).toContain("Elder Moss");
    expect(view.textContent).toContain("Grem");
    expect(view.textContent).toContain("GM");
    expect(view.textContent).toContain("The bog remembers.");

    const portrait = view.querySelector('img[alt="Elder Moss"]');
    expect(portrait?.getAttribute("src")).toBe("https://img/elder.png");
  });

  it("falls back to an initial when the NPC has no portrait", () => {
    const npcs = state.worlds.currentWorld.currentWorldNPCs.npcMap;
    const withPortrait = npcs["elder"];
    npcs["elder"] = { name: "Elder Moss" };
    try {
      const view = render();
      expect(view.textContent).toContain("Elder Moss");
      expect(view.querySelector('img[alt="Elder Moss"]')).toBeNull();
      expect(view.textContent).toContain("GM");
    } finally {
      npcs["elder"] = withPortrait;
    }
  });
});
