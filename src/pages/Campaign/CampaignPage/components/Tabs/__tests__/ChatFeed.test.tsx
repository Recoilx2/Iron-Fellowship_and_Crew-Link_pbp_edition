/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

const editPost = vi.fn();
const deletePost = vi.fn();

import type { PostWithId } from "api-calls/chat/listenToChannelPosts";

function post(overrides: Partial<PostWithId> = {}): PostWithId {
  return {
    id: "post-1",
    channelId: "ic",
    authorId: "player-1",
    speakerCharacterId: null,
    speakerNpcId: null,
    text: "We push on through the bog.",
    createdAt: "2026-11-13T12:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

const state = {
  auth: { uid: "player-1" },
  appState: { openDialog: vi.fn() },
  chat: {
    postsByChannel: { ic: [post()] } as Record<string, PostWithId[]>,
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
    userMap: {
      "player-1": { doc: { displayName: "Sam" } },
      "gm-1": { doc: { displayName: "Grem" } },
    } as Record<string, { doc: { displayName: string } } | undefined>,
    loadUserDocument: vi.fn(),
    loadUserDocuments: vi.fn(),
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock("api-calls/chat/editPost", () => ({
  editPost: (...args: unknown[]) => editPost(...args),
}));
vi.mock("api-calls/chat/deletePost", () => ({
  deletePost: (...args: unknown[]) => deletePost(...args),
}));

import { ChatFeed } from "../ChatFeed";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";

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

const ic: ChannelWithId = {
  id: "ic",
  name: "In character",
  kind: "IC",
  visibility: "public",
  isStarting: true,
  archived: false,
};

// Seam under test: the feed readers see. A GM's NPC voice shows the NPC's
// name and portrait with a GM tag beside the author. Edited posts show
// their new text with an edited marker, soft-deleted posts keep a "post
// deleted" marker in place of their content, and authors and GMs get the
// controls the access rules allow them to use. Posting itself is covered by
// the data-layer live tests and the browser test; here the mutations are
// stubbed.
describe("ChatFeed NPC voices", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    state.chat.postsByChannel = { ic: [post()] };
    vi.clearAllMocks();
  });

  function render() {
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

  it("shows the NPC as speaker and that a GM posted it", () => {
    state.chat.postsByChannel = {
      ic: [
        post({
          authorId: "gm-1",
          speakerNpcId: "elder",
          text: "The bog remembers.",
        }),
      ],
    };
    const view = render();

    expect(view.textContent).toContain("Elder Moss");
    expect(view.textContent).toContain("Grem");
    expect(view.textContent).toContain("GM");
    expect(view.textContent).toContain("The bog remembers.");

    const portrait = view.querySelector('img[alt="Elder Moss"]');
    expect(portrait?.getAttribute("src")).toBe("https://img/elder.png");
  });

  it("falls back to an initial when the NPC has no portrait", () => {
    state.chat.postsByChannel = {
      ic: [
        post({
          authorId: "gm-1",
          speakerNpcId: "elder",
          text: "The bog remembers.",
        }),
      ],
    };
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

describe("ChatFeed edits and deletes", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    state.auth.uid = "player-1";
    state.chat.postsByChannel = { ic: [post()] };
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

  function buttons(view: HTMLDivElement, label: string): HTMLButtonElement[] {
    return Array.from(
      view.querySelectorAll(`button[aria-label="${label}"]`)
    ) as HTMLButtonElement[];
  }

  it("marks edited posts without hiding their text", () => {
    state.chat.postsByChannel = {
      ic: [post({ editedAt: "2026-11-13T12:05:00.000Z" })],
    };
    const view = render();
    expect(view.textContent).toContain("We push on through the bog.");
    expect(view.textContent).toContain("(edited)");
  });

  it("shows a deleted marker in place of deleted content", () => {
    state.chat.postsByChannel = {
      ic: [post({ text: "", deletedAt: "2026-11-13T12:06:00.000Z" })],
    };
    const view = render();
    expect(view.textContent).toContain("post deleted");
    expect(view.textContent).not.toContain("We push on through the bog.");
    // Nothing left to edit or delete on a deleted post.
    expect(buttons(view, "Edit post")).toHaveLength(0);
    expect(buttons(view, "Delete post")).toHaveLength(0);
  });

  it("offers the author edit and delete controls", () => {
    const view = render();
    expect(buttons(view, "Edit post")).toHaveLength(1);
    expect(buttons(view, "Delete post")).toHaveLength(1);
  });

  it("offers GMs delete but never edit on others' posts", () => {
    state.auth.uid = "gm-1";
    const view = render();
    expect(buttons(view, "Edit post")).toHaveLength(0);
    expect(buttons(view, "Delete post")).toHaveLength(1);
  });

  it("offers no controls to members who may neither edit nor delete", () => {
    state.auth.uid = "player-2";
    const view = render();
    expect(buttons(view, "Edit post")).toHaveLength(0);
    expect(buttons(view, "Delete post")).toHaveLength(0);
  });

  it("edits through the edit control", async () => {
    editPost.mockResolvedValue(undefined);
    const view = render();
    act(() => {
      buttons(view, "Edit post")[0]?.click();
    });
    const box = view.querySelector(
      'textarea[aria-label="Edit post text"]'
    ) as HTMLTextAreaElement | null;
    if (!box) {
      throw new Error("no edit box");
    }
    expect(box.value).toBe("We push on through the bog.");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(box, "We push on through the bog, quietly.");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = view.querySelector(
      'button[aria-label="Save edit"]'
    ) as HTMLButtonElement | null;
    if (!save) {
      throw new Error("no save button");
    }
    await act(async () => {
      save.click();
    });
    expect(editPost).toHaveBeenCalledWith({
      postId: "post-1",
      text: "We push on through the bog, quietly.",
    });
  });

  it("deletes through a confirm step", async () => {
    deletePost.mockResolvedValue(undefined);
    const view = render();
    act(() => {
      buttons(view, "Delete post")[0]?.click();
    });
    const confirm = view.querySelector(
      'button[aria-label="Confirm delete"]'
    ) as HTMLButtonElement | null;
    if (!confirm) {
      throw new Error("no delete confirm");
    }
    await act(async () => {
      confirm.click();
    });
    expect(deletePost).toHaveBeenCalledWith({ postId: "post-1" });
  });
});
