/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

const createPost = vi.fn();
const uploadChatImage = vi.fn();
const removeChatImage: Mock = vi.fn(() => Promise.resolve());

const state = {
  auth: { uid: "player-1", user: { displayName: "Sam" } },
  campaigns: {
    currentCampaign: {
      characters: {
        characterMap: {
          kira: { uid: "player-1", name: "Kira Vey" },
        },
      },
      currentCampaign: {
        gmIds: [] as string[],
        worldId: undefined as string | undefined,
      },
    },
  },
  worlds: {
    currentWorld: {
      currentWorldNPCs: {
        npcMap: {} as Record<string, { name: string }>,
      },
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
vi.mock("api-calls/chat/chatImages", () => ({
  uploadChatImage: (...args: unknown[]) => uploadChatImage(...args),
  removeChatImage: (...args: unknown[]) => removeChatImage(...args),
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
// draft per channel for the session. GMs alone get a simple picker over
// the campaign world's NPC list. Images attach by drop, paste or picker,
// preview above the text box, and go up with the post; removing one before
// posting discards its upload. Posting itself is covered by the
// data-layer live tests and the browser test; here the composer and the
// storage calls are stubs around mocked functions.
describe("ChatComposer", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    state.auth.uid = "player-1";
    state.campaigns.currentCampaign.currentCampaign.gmIds = [];
    state.campaigns.currentCampaign.currentCampaign.worldId = undefined;
    state.worlds.currentWorld.currentWorldNPCs.npcMap = {};
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
          <ChatComposer channel={channel} campaignId={"campaign-1"} />
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
      postId: undefined,
      text: "we push on",
      speakerCharacterId: "kira",
      speakerNpcId: null,
      imagePaths: [],
    });
    expect(state.chat.drafts["ic"]).toBeUndefined();
  });

  function becomeGMWithNPCs() {
    state.auth.uid = "gm-1";
    state.campaigns.currentCampaign.currentCampaign.gmIds = ["gm-1"];
    state.campaigns.currentCampaign.currentCampaign.worldId = "world-1";
    state.worlds.currentWorld.currentWorldNPCs.npcMap = {
      elder: { name: "Elder Moss" },
      drifter: { name: "Drifter" },
    };
  }

  function voicePicker(view: HTMLDivElement): HTMLSelectElement {
    const picker = view.querySelector('select[aria-label="Posting as"]');
    if (!picker) {
      throw new Error("no voice picker");
    }
    return picker as HTMLSelectElement;
  }

  function pickVoice(picker: HTMLSelectElement, value: string) {
    act(() => {
      picker.value = value;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("offers GMs a voice picker over the campaign world's NPC list", async () => {
    becomeGMWithNPCs();
    createPost.mockResolvedValue("post-1");
    const view = render(ic);

    const picker = voicePicker(view);
    expect(Array.from(picker.options).map((option) => option.text)).toEqual([
      "Yourself",
      "Drifter",
      "Elder Moss",
    ]);

    pickVoice(picker, "elder");
    expect(view.textContent).toContain("Elder Moss");

    typeText(textBox(view), "the bog remembers");
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
      postId: undefined,
      text: "the bog remembers",
      speakerCharacterId: null,
      speakerNpcId: "elder",
      imagePaths: [],
    });
  });

  it("posts as self when the GM keeps the yourself voice", async () => {
    becomeGMWithNPCs();
    createPost.mockResolvedValue("post-1");
    const view = render(ic);
    expect(view.textContent).toContain("Posting as");

    typeText(textBox(view), "a wonder");
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
      postId: undefined,
      text: "a wonder",
      speakerCharacterId: null,
      speakerNpcId: null,
      imagePaths: [],
    });
  });

  it("shows players no voice picker, even with a world of NPCs", () => {
    state.campaigns.currentCampaign.currentCampaign.worldId = "world-1";
    state.worlds.currentWorld.currentWorldNPCs.npcMap = {
      elder: { name: "Elder Moss" },
    };
    const view = render(ic);
    expect(view.textContent).toContain("Kira Vey");
    expect(
      view.querySelector('select[aria-label="Posting as"]')
    ).toBeNull();
  });

  it("shows GMs no voice picker without a world or without NPCs", () => {
    state.auth.uid = "gm-1";
    state.campaigns.currentCampaign.currentCampaign.gmIds = ["gm-1"];

    // No world on the campaign: no NPC list to pick from.
    expect(
      render(ic).querySelector('select[aria-label="Posting as"]')
    ).toBeNull();

    // A world with no NPCs: nothing to voice.
    state.campaigns.currentCampaign.currentCampaign.worldId = "world-1";
    expect(
      render(ic).querySelector('select[aria-label="Posting as"]')
    ).toBeNull();
  });

  it("resets the GM voice when the channel switches", () => {
    becomeGMWithNPCs();
    const view = render(ic);
    pickVoice(voicePicker(view), "elder");
    expect(view.textContent).toContain("Posting as Elder Moss");

    render(ooc);
    expect(voicePicker(view).value).toBe("");
    expect(view.textContent).toContain("Posting as Sam");
  });

  function imageFile(name = "lantern.png"): File {
    return new File(["fake-bytes"], name, { type: "image/png" });
  }

  function dropFiles(view: HTMLDivElement, files: File[]) {
    const target = view.firstElementChild;
    if (!target) {
      throw new Error("no composer drop target");
    }
    const event = new Event("drop", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files, types: ["Files"] },
    });
    act(() => {
      target.dispatchEvent(event);
    });
  }

  function pasteFiles(box: HTMLTextAreaElement, files: File[]) {
    const event = new Event("paste", { bubbles: true });
    Object.defineProperty(event, "clipboardData", { value: { files } });
    act(() => {
      box.dispatchEvent(event);
    });
  }

  function pickFiles(view: HTMLDivElement, files: File[]) {
    const input = view.querySelector(
      'input[aria-label="Attach images"]'
    ) as HTMLInputElement | null;
    if (!input) {
      throw new Error("no file picker");
    }
    Object.defineProperty(input, "files", { value: files, configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function flushUploads() {
    await act(async () => {});
  }

  function removeButton(view: HTMLDivElement, name: string) {
    const button = view.querySelector(
      `button[aria-label="Remove ${name}"]`
    ) as HTMLButtonElement | null;
    if (!button) {
      throw new Error(`no remove button for ${name}`);
    }
    return button;
  }

  it("attaches a dropped image and previews it", async () => {
    uploadChatImage.mockResolvedValue("campaign-1/post-1/lantern.png");
    const view = render(ic);
    dropFiles(view, [imageFile()]);

    expect(uploadChatImage).toHaveBeenCalledWith(
      "campaign-1",
      expect.any(String),
      expect.objectContaining({ name: "lantern.png" })
    );
    await flushUploads();
    expect(
      view.querySelector('img[alt="lantern.png"]')
    ).not.toBeNull();
  });

  it("attaches a pasted image", async () => {
    uploadChatImage.mockResolvedValue("campaign-1/post-1/pasted.png");
    const view = render(ic);
    pasteFiles(textBox(view), [imageFile("pasted.png")]);

    await flushUploads();
    expect(uploadChatImage).toHaveBeenCalledWith(
      "campaign-1",
      expect.any(String),
      expect.objectContaining({ name: "pasted.png" })
    );
    expect(
      view.querySelector('img[alt="pasted.png"]')
    ).not.toBeNull();
  });

  it("attaches a picked image", async () => {
    uploadChatImage.mockResolvedValue("campaign-1/post-1/picked.png");
    const view = render(ic);
    pickFiles(view, [imageFile("picked.png")]);

    await flushUploads();
    expect(uploadChatImage).toHaveBeenCalledWith(
      "campaign-1",
      expect.any(String),
      expect.objectContaining({ name: "picked.png" })
    );
    expect(
      view.querySelector('img[alt="picked.png"]')
    ).not.toBeNull();
  });

  it("removing an image before posting discards its upload", async () => {
    uploadChatImage.mockResolvedValue("campaign-1/post-1/lantern.png");
    removeChatImage.mockResolvedValue(undefined);
    const view = render(ic);
    dropFiles(view, [imageFile()]);
    await flushUploads();
    expect(
      view.querySelector('img[alt="lantern.png"]')
    ).not.toBeNull();

    act(() => {
      removeButton(view, "lantern.png").click();
    });

    expect(removeChatImage).toHaveBeenCalledWith(
      "campaign-1/post-1/lantern.png"
    );
    expect(view.querySelector('img[alt="lantern.png"]')).toBeNull();
  });

  it("sends attached images with the post", async () => {
    uploadChatImage.mockResolvedValue("campaign-1/post-1/lantern.png");
    createPost.mockResolvedValue("post-1");
    const view = render(ic);
    dropFiles(view, [imageFile()]);
    await flushUploads();
    typeText(textBox(view), "see this");
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

    expect(createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "ic",
        text: "see this",
        imagePaths: ["campaign-1/post-1/lantern.png"],
      })
    );
    // Sent attachments leave with the post: no upload is discarded after.
    expect(removeChatImage).not.toHaveBeenCalled();
    expect(view.querySelector('img[alt="lantern.png"]')).toBeNull();
  });

  it("refuses oversized and foreign images with a clear error", async () => {
    const view = render(ic);
    const big = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    const svg = new File(["<svg/>"], "sketch.svg", {
      type: "image/svg+xml",
    });
    dropFiles(view, [big]);
    expect(view.textContent).toContain("10 MB");
    expect(uploadChatImage).not.toHaveBeenCalled();

    dropFiles(view, [svg]);
    expect(view.textContent).toMatch(/PNG, JPEG, GIF or WebP/);
    expect(uploadChatImage).not.toHaveBeenCalled();

    // The error clears so the next attempt starts clean.
    const close = view.querySelector(
      ".MuiAlert-action button"
    ) as HTMLButtonElement | null;
    if (!close) {
      throw new Error("no error dismiss button");
    }
    act(() => {
      close.click();
    });
    expect(view.textContent).not.toContain("10 MB");
  });
});
