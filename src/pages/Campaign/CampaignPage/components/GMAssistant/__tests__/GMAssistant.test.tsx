/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

const state = {
  auth: { uid: "gm-1" },
  campaigns: {
    currentCampaign: {
      currentCampaignId: "campaign-1",
      currentCampaign: { gmIds: ["gm-1"] } as { gmIds: string[] },
    },
  },
  chat: {
    openChannelId: "ic" as string | undefined,
    drafts: {} as Record<string, string>,
    setDraft: vi.fn((channelId: string, text: string) => {
      if (text.length === 0) {
        delete state.chat.drafts[channelId];
      } else {
        state.chat.drafts[channelId] = text;
      }
    }),
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));

vi.mock("api-calls/assistant/gmAssistantClient", () => ({
  fetchAssistantModels: vi.fn(),
  streamAssistantChat: vi.fn(),
  AssistantRequestError: class extends Error {
    code: string;
    status: number;
    ref: string | null;
    constructor(
      code: string,
      message: string,
      options: { status: number; ref?: string | null }
    ) {
      super(message);
      this.code = code;
      this.status = options.status;
      this.ref = options.ref ?? null;
    }
  },
}));
vi.mock("api-calls/assistant/listenToConversations", () => ({
  listenToConversations: vi.fn(),
}));
vi.mock("api-calls/assistant/listenToMessages", () => ({
  listenToMessages: vi.fn(),
}));
vi.mock("api-calls/assistant/assistantSettings", () => ({
  fetchAssistantSettings: vi.fn(),
  saveAssistantSettings: vi.fn(),
}));
vi.mock("api-calls/assistant/createConversation", () => ({
  createConversation: vi.fn(),
}));
vi.mock("api-calls/assistant/deleteConversation", () => ({
  deleteConversation: vi.fn(),
}));

import { GMAssistant } from "../GMAssistant";
import { fetchAssistantModels } from "api-calls/assistant/gmAssistantClient";
import {
  fetchAssistantSettings,
  saveAssistantSettings,
} from "api-calls/assistant/assistantSettings";
import { listenToConversations } from "api-calls/assistant/listenToConversations";
import { listenToMessages } from "api-calls/assistant/listenToMessages";
import { createConversation } from "api-calls/assistant/createConversation";
import { deleteConversation } from "api-calls/assistant/deleteConversation";
import { emptyAssistantContextChoice } from "api-calls/assistant/_assistant.type";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mockViewport(width: number) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const minWidth = query.match(/min-width:\s*([\d.]+)px/);
      const maxWidth = query.match(/max-width:\s*([\d.]+)px/);
      let matches = true;
      if (minWidth) {
        matches = width >= parseFloat(minWidth[1]);
      } else if (maxWidth) {
        matches = width <= parseFloat(maxWidth[1]);
      }
      return {
        matches,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function selectModel(view: HTMLDivElement, id: string) {
  const picker = view.querySelector(
    'select[aria-label="Model"]'
  ) as HTMLSelectElement | null;
  if (!picker) {
    throw new Error("no model picker");
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  )?.set;
  act(() => {
    setter?.call(picker, id);
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// Seam under test: the panel header. The model list comes from the
// server; the GM's choice is saved to assistant_settings beside their
// saved context choice. When the server has no model server the panel
// says so plainly, and every other failure shows a short generic
// message with the reference code.
describe("GMAssistant model picker", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  const savedContext = emptyAssistantContextChoice();

  beforeEach(() => {
    mockViewport(1400);
    state.auth.uid = "gm-1";
    state.campaigns.currentCampaign.currentCampaign = { gmIds: ["gm-1"] };
    vi.mocked(fetchAssistantModels).mockResolvedValue([
      { id: "m1", contextTokens: 4096 },
      { id: "m2", contextTokens: 16384 },
    ]);
    vi.mocked(fetchAssistantSettings).mockResolvedValue({
      model: "m2",
      context: savedContext,
      updatedAt: "2026-11-14T00:00:00Z",
    });
    vi.mocked(saveAssistantSettings).mockResolvedValue(undefined);
    vi.mocked(listenToConversations).mockImplementation(
      (_campaignId, handlers) => {
        handlers.onConversations([]);
        handlers.onLoaded();
        return () => {};
      }
    );
    vi.mocked(listenToMessages).mockImplementation(
      (_conversationId, handlers) => {
        handlers.onMessages([]);
        handlers.onLoaded();
        return () => {};
      }
    );
  });

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
          <GMAssistant />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  async function renderAndOpen() {
    const view = render();
    act(() => {
      view
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    return view;
  }

  it("shows the saved model and saves a change beside the saved context", async () => {
    const view = await renderAndOpen();

    const picker = view.querySelector(
      'select[aria-label="Model"]'
    ) as HTMLSelectElement | null;
    expect(picker?.value).toBe("m2");

    selectModel(view, "m1");
    await flush();

    expect(saveAssistantSettings).toHaveBeenCalledWith({
      campaignId: "campaign-1",
      model: "m1",
      context: savedContext,
    });
  });

  it("shows the not-set-up message when the server has no model server", async () => {
    vi.mocked(fetchAssistantModels).mockRejectedValue(
      Object.assign(new Error("The GM assistant is not set up on this server."), {
        code: "NOT_SET_UP",
        ref: "ABC123",
      })
    );
    const view = await renderAndOpen();

    expect(view.textContent).toContain("isn't set up on this server");
    expect(view.textContent).toContain("whoever runs it");
    expect(view.querySelector('select[aria-label="Model"]')).toBeNull();
  });

  it("shows a generic error with the reference when models fail", async () => {
    vi.mocked(fetchAssistantModels).mockRejectedValue(
      Object.assign(new Error("The assistant request failed."), {
        code: "UPSTREAM_ERROR",
        ref: "ZZ9Q12",
      })
    );
    const view = await renderAndOpen();

    expect(view.textContent).toContain("The assistant request failed.");
    expect(view.textContent).toContain("ZZ9Q12");
  });
});

// Seam under test: the GM assistant entry point the campaign screen
// renders. GMs get an Assistant button opening the docked panel; players
// get nothing at all -- no button, panel or settings.
describe("GMAssistant gating", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    mockViewport(1400);
    state.auth.uid = "gm-1";
    state.campaigns.currentCampaign.currentCampaign = { gmIds: ["gm-1"] };
    vi.mocked(fetchAssistantModels).mockResolvedValue([]);
    vi.mocked(fetchAssistantSettings).mockResolvedValue(null);
    vi.mocked(listenToConversations).mockImplementation(
      (_campaignId, handlers) => {
        handlers.onConversations([]);
        handlers.onLoaded();
        return () => {};
      }
    );
    vi.mocked(listenToMessages).mockImplementation(
      (_conversationId, handlers) => {
        handlers.onMessages([]);
        handlers.onLoaded();
        return () => {};
      }
    );
  });

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
          <GMAssistant />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  it("renders no button, panel or settings for a player", () => {
    state.auth.uid = "player-1";
    const view = render();

    expect(
      view.querySelectorAll('button, [role="dialog"], input, select')
    ).toHaveLength(0);
    expect(view.textContent ?? "").not.toContain("Assistant");
  });

  it("opens the panel for a GM and closes it again", () => {
    const view = render();

    const button = view.querySelector("button");
    expect(button?.textContent).toContain("Assistant");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.textContent).toContain("GM assistant");
    const close = Array.from(view.querySelectorAll("button")).find(
      (entry) => entry.getAttribute("aria-label") === "Close assistant"
    );
    expect(close).toBeDefined();
    act(() => {
      close?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(view.textContent ?? "").not.toContain("GM assistant");
  });

  it("opens full-screen with its own close button on a phone", () => {
    mockViewport(390);
    const view = render();
    act(() => {
      view
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("GM assistant");
    const close = Array.from(
      dialog?.querySelectorAll("button") ?? []
    ).find((entry) => entry.getAttribute("aria-label") === "Close assistant");
    expect(close).toBeDefined();
  });

  it("shows Chat and Outline tabs with Context disabled until its ticket", () => {
    const view = render();
    act(() => {
      view
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const tabs = Array.from(view.querySelectorAll('[role="tab"]')).map(
      (tab) => tab.textContent
    );
    expect(tabs).toContain("Chat");
    expect(tabs).toContain("Context");
    expect(tabs).toContain("Outline");
    const disabled = Array.from(view.querySelectorAll('[role="tab"]')).filter(
      (tab) => tab.hasAttribute("disabled")
    );
    expect(disabled.map((tab) => tab.textContent)).toEqual(["Context"]);
  });
});

// Seam under test: the Chat tab's conversation header and thread. The
// history menu switches between the GM's private conversations, New
// starts one, Delete removes the open one, and every assistant reply
// carries Copy and Send to composer.
describe("GMAssistant chat thread", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  const convoA = {
    id: "c-a",
    campaignId: "campaign-1",
    ownerId: "gm-1",
    title: "First plan",
    createdAt: "2026-11-14T00:00:00Z",
    updatedAt: "2026-11-14T00:01:00Z",
  };
  const convoB = {
    id: "c-b",
    campaignId: "campaign-1",
    ownerId: "gm-1",
    title: "Second plan",
    createdAt: "2026-11-14T00:02:00Z",
    updatedAt: "2026-11-14T00:03:00Z",
  };
  const messagesById: Record<string, typeof threadMessages> = {};
  const threadMessages = [
    {
      id: "m-u",
      conversationId: "c-a",
      role: "user" as const,
      content: "What happens next?",
      stoppedPartway: false,
      createdAt: "2026-11-14T00:00:00Z",
    },
    {
      id: "m-a",
      conversationId: "c-a",
      role: "assistant" as const,
      content: "The bell rings twice.",
      stoppedPartway: false,
      createdAt: "2026-11-14T00:00:01Z",
    },
  ];

  beforeEach(() => {
    mockViewport(1400);
    state.auth.uid = "gm-1";
    state.campaigns.currentCampaign.currentCampaign = { gmIds: ["gm-1"] };
    messagesById["c-a"] = threadMessages;
    messagesById["c-b"] = [];
    vi.mocked(fetchAssistantModels).mockResolvedValue([
      { id: "m1", contextTokens: 4096 },
    ]);
    vi.mocked(fetchAssistantSettings).mockResolvedValue({
      model: null,
      context: emptyAssistantContextChoice(),
      updatedAt: "2026-11-14T00:00:00Z",
    });
    vi.mocked(saveAssistantSettings).mockResolvedValue(undefined);
    vi.mocked(listenToConversations).mockImplementation(
      (_campaignId, handlers) => {
        handlers.onConversations([convoA, convoB]);
        handlers.onLoaded();
        return () => {};
      }
    );
    vi.mocked(listenToMessages).mockImplementation(
      (conversationId, handlers) => {
        handlers.onMessages(messagesById[conversationId] ?? []);
        handlers.onLoaded();
        return () => {};
      }
    );
    vi.mocked(createConversation).mockResolvedValue("c-new");
    vi.mocked(deleteConversation).mockResolvedValue(undefined);
  });

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
          <GMAssistant />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  async function renderAndOpen() {
    const view = render();
    act(() => {
      view
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    return view;
  }

  function buttonByLabel(view: HTMLDivElement, label: string) {
    const found = Array.from(view.querySelectorAll("button")).find(
      (entry) => entry.getAttribute("aria-label") === label
    );
    if (!found) {
      throw new Error(`no button labelled ${label}`);
    }
    return found as HTMLButtonElement;
  }

  it("switches conversations from the history menu", async () => {
    const view = await renderAndOpen();
    expect(view.textContent).toContain("The bell rings twice.");

    act(() => {
      buttonByLabel(view, "Conversations").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    const second = Array.from(
      view.querySelectorAll('[role="menuitem"]')
    ).find((entry) => entry.textContent?.includes("Second plan"));
    if (!second) {
      throw new Error("no history entry for the second conversation");
    }
    act(() => {
      second.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(view.textContent ?? "").not.toContain("The bell rings twice.");
  });

  it("starts a new conversation without posting anything", async () => {
    const view = await renderAndOpen();

    act(() => {
      buttonByLabel(view, "New conversation").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    await flush();

    expect(createConversation).toHaveBeenCalledWith({
      campaignId: "campaign-1",
    });
    expect(view.textContent).toContain("New conversation");
  });

  it("deletes the open conversation and moves to the next one", async () => {
    const view = await renderAndOpen();

    act(() => {
      buttonByLabel(view, "Delete conversation").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    await flush();

    expect(deleteConversation).toHaveBeenCalledWith({
      conversationId: "c-a",
    });
    expect(view.textContent).toContain("Second plan");
  });

  it("copies a reply to the clipboard", async () => {
    const view = await renderAndOpen();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      writable: true,
      configurable: true,
      value: { writeText },
    });

    act(() => {
      buttonByLabel(view, "Copy reply").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    expect(writeText).toHaveBeenCalledWith("The bell rings twice.");
  });
});

// Seam under test: sending a message. Replies stream in with a Stop
// button while they arrive, failures show a short generic message with
// the reference code, and Send to composer fills the GM's chat composer
// for the current channel without posting anything.
describe("GMAssistant streaming", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  const convoA = {
    id: "c-a",
    campaignId: "campaign-1",
    ownerId: "gm-1",
    title: "First plan",
    createdAt: "2026-11-14T00:00:00Z",
    updatedAt: "2026-11-14T00:01:00Z",
  };
  const replyText = "The bell rings twice.";
  const threadMessages = [
    {
      id: "m-u",
      conversationId: "c-a",
      role: "user" as const,
      content: "What happens next?",
      stoppedPartway: false,
      createdAt: "2026-11-14T00:00:00Z",
    },
    {
      id: "m-a",
      conversationId: "c-a",
      role: "assistant" as const,
      content: replyText,
      stoppedPartway: false,
      createdAt: "2026-11-14T00:00:01Z",
    },
  ];

  beforeEach(() => {
    mockViewport(1400);
    state.auth.uid = "gm-1";
    state.campaigns.currentCampaign.currentCampaign = { gmIds: ["gm-1"] };
    state.chat.openChannelId = "ic";
    state.chat.drafts = {};
    vi.mocked(fetchAssistantModels).mockResolvedValue([
      { id: "m1", contextTokens: 4096 },
    ]);
    vi.mocked(fetchAssistantSettings).mockResolvedValue({
      model: null,
      context: emptyAssistantContextChoice(),
      updatedAt: "2026-11-14T00:00:00Z",
    });
    vi.mocked(saveAssistantSettings).mockResolvedValue(undefined);
    vi.mocked(listenToConversations).mockImplementation(
      (_campaignId, handlers) => {
        handlers.onConversations([convoA]);
        handlers.onLoaded();
        return () => {};
      }
    );
    vi.mocked(listenToMessages).mockImplementation(
      (conversationId, handlers) => {
        handlers.onMessages(
          conversationId === "c-a" ? threadMessages : []
        );
        handlers.onLoaded();
        return () => {};
      }
    );
  });

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
          <GMAssistant />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  async function renderAndOpen() {
    const view = render();
    act(() => {
      view
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    return view;
  }

  function buttonByLabel(view: HTMLDivElement, label: string) {
    const found = Array.from(view.querySelectorAll("button")).find(
      (entry) => entry.getAttribute("aria-label") === label
    );
    if (!found) {
      throw new Error(`no button labelled ${label}`);
    }
    return found as HTMLButtonElement;
  }

  function typeMessage(view: HTMLDivElement, text: string) {
    const box = view.querySelector("textarea");
    if (!box) {
      throw new Error("no assistant input");
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(box, text);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("shows the Stop button while a reply streams and stops on click", async () => {
    let release!: (result: { text: string; aborted: boolean }) => void;
    const seen: { signal: AbortSignal | null } = { signal: null };
    const { streamAssistantChat } = await import(
      "api-calls/assistant/gmAssistantClient"
    );
    vi.mocked(streamAssistantChat).mockImplementation(
      ({ signal, onChunk }) =>
        new Promise((resolve) => {
          seen.signal = signal;
          onChunk("Partial ");
          release = resolve;
        })
    );
    const view = await renderAndOpen();
    typeMessage(view, "What happens next?");
    act(() => {
      buttonByLabel(view, "Send to assistant").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    await flush();

    buttonByLabel(view, "Stop reply");
    expect(view.textContent).toContain("Partial ");
    act(() => {
      buttonByLabel(view, "Stop reply").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(seen.signal?.aborted).toBe(true);
    await act(async () => {
      release({ text: "Partial ", aborted: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect(
      view.querySelectorAll('button[aria-label="Stop reply"]')
    ).toHaveLength(0);
  });

  it("sends a reply to the composer without posting it", async () => {
    const view = await renderAndOpen();

    act(() => {
      buttonByLabel(view, "Send to composer").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    expect(state.chat.setDraft).toHaveBeenCalledWith("ic", replyText);
    expect(state.chat.drafts["ic"]).toBe(replyText);
  });

  it("shows a generic error with the reference when sending fails", async () => {
    const { streamAssistantChat } = await import(
      "api-calls/assistant/gmAssistantClient"
    );
    vi.mocked(streamAssistantChat).mockRejectedValue(
      Object.assign(new Error("The assistant request failed."), {
        code: "UPSTREAM_ERROR",
        ref: "Q7X2KD",
      })
    );
    const view = await renderAndOpen();
    typeMessage(view, "What happens next?");
    act(() => {
      buttonByLabel(view, "Send to assistant").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    await flush();

    expect(view.textContent).toContain("The assistant request failed.");
    expect(view.textContent).toContain("Q7X2KD");
  });

  it("says which endpoint and model the material goes to", async () => {
    const view = await renderAndOpen();

    expect(view.textContent).toContain("m1");
    expect(view.textContent).toContain("configured endpoint");
  });
});
