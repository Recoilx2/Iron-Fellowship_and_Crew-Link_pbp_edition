/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

const setOpenChannelId = vi.fn();

const state = {
  chat: {
    channels: [
      {
        id: "ic",
        name: "In character",
        kind: "IC",
        visibility: "public",
        isStarting: true,
        archived: false,
      },
      {
        id: "ooc",
        name: "Out of character",
        kind: "OOC",
        visibility: "public",
        isStarting: true,
        archived: false,
      },
      {
        id: "quest",
        name: "Side quest",
        kind: "IC",
        visibility: "private",
        isStarting: false,
        archived: false,
      },
      {
        id: "dm-1",
        name: "Direct message",
        kind: "OOC",
        visibility: "dm",
        isStarting: false,
        archived: false,
      },
      {
        id: "side",
        name: "Side scene",
        kind: "OOC",
        visibility: "public",
        isStarting: false,
        archived: true,
      },
    ],
    membersByChannel: {
      quest: ["gm-1", "player-1"],
      "dm-1": ["gm-1", "player-2"],
    },
    openChannelId: "ic",
    loading: false,
    error: undefined,
    setOpenChannelId,
  },
  campaigns: {
    currentCampaign: {
      currentCampaignId: "campaign-1",
      currentCampaign: {
        gmIds: ["gm-1"],
        users: ["gm-1", "player-1", "player-2"],
      },
    },
  },
  auth: { uid: "gm-1" },
  users: {
    userMap: {
      "gm-1": { doc: { displayName: "Gus" } },
      "player-1": { doc: { displayName: "Ava" } },
      "player-2": { doc: { displayName: "Bo" } },
    },
    loadUserDocuments: () => {},
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock("stores/chat/useListenToChatChannels", () => ({
  useListenToChatChannels: () => {},
}));
vi.mock("stores/chat/useListenToChannelPosts", () => ({
  useListenToChannelPosts: () => {},
}));
vi.mock("../ChatFeed", () => ({
  ChatFeed: ({ channel }: { channel: { id: string } }) => (
    <div>{`Feed for ${channel.id}`}</div>
  ),
}));
vi.mock("../ChatComposer", () => ({
  ChatComposer: ({ channel }: { channel: { name: string } }) => (
    <div>{`Composer for ${channel.name}`}</div>
  ),
}));
vi.mock("api-calls/chat/createChannel", () => ({
  createChannel: vi.fn(),
}));
vi.mock("api-calls/chat/createPrivateChannel", () => ({
  createPrivateChannel: vi.fn(),
}));
vi.mock("api-calls/chat/getOrCreateDirectChannel", () => ({
  getOrCreateDirectChannel: vi.fn(),
}));
vi.mock("api-calls/chat/setChannelMembers", () => ({
  setChannelMembers: vi.fn(),
}));
vi.mock("api-calls/chat/renameChannel", () => ({
  renameChannel: vi.fn(),
}));
vi.mock("api-calls/chat/archiveChannel", () => ({
  archiveChannel: vi.fn(),
}));
vi.mock("../CharacterTab", () => ({ CharacterTab: () => null }));
vi.mock("../TracksTab", () => ({ TracksTab: () => null }));
vi.mock("../MyNotesTab", () => ({
  MyNotesTab: () => <div>My notes pane</div>,
}));
vi.mock("../WorldTab", () => ({ WorldTab: () => null }));
vi.mock("components/shared/UserAvatar", () => ({
  UserAvatar: ({ uid }: { uid: string }) => <span>{`Avatar ${uid}`}</span>,
}));

import { ChatTab } from "../ChatTab";
import { createPrivateChannel } from "api-calls/chat/createPrivateChannel";
import { getOrCreateDirectChannel } from "api-calls/chat/getOrCreateDirectChannel";
import { setChannelMembers } from "api-calls/chat/setChannelMembers";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Width-aware matchMedia stub: MUI answers useMediaQuery from the query
 * string, so parsing the min/max width out of it simulates a viewport.
 * 1400 behaves like a wide desktop, 1000 like a mid-width tablet or
 * window, 390 like a phone.
 */
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

describe("ChatTab channels", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    // Wide viewport: the desktop side screens with the campaign screens
    // are part of the DOM, like the phone bottom navigation below it.
    mockViewport(1400);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  function render() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <ChatTab openInviteDialog={() => {}} />
        </ThemeProvider>
      );
    });
    return container;
  }

  function channelButtons(view: HTMLDivElement) {
    return Array.from(view.querySelectorAll("button")).filter((button) =>
      /^[#@] /.test(button.textContent ?? "")
    );
  }

  function renderAs(uid: string) {
    (state.auth as { uid: string }).uid = uid;
    const box = document.createElement("div");
    document.body.appendChild(box);
    const sub = createRoot(box);
    act(() => {
      sub.render(
        <ThemeProvider theme={theme}>
          <ChatTab openInviteDialog={() => {}} />
        </ThemeProvider>
      );
    });
    return {
      box,
      done: () => {
        (state.auth as { uid: string }).uid = "gm-1";
        act(() => sub.unmount());
        box.remove();
      },
    };
  }

  it("groups open channels under In character and Out of character", () => {
    const view = render();

    expect(view.textContent).toContain("In character");
    expect(view.textContent).toContain("Out of character");
    const names = channelButtons(view).map((button) => button.textContent);
    expect(names).toContain("# In character");
    expect(names).toContain("# Out of character");
    // The archived scene stays out of the open lists until expanded.
    expect(names).not.toContain("# Side scene");
    expect(view.textContent).toContain("Show archived");
  });

  it("groups private channels and direct channels under their own sections", () => {
    const view = render();

    expect(view.textContent).toContain("Private");
    expect(view.textContent).toContain("Direct messages");
    const names = channelButtons(view).map((button) => button.textContent);
    expect(names).toContain("# Side quest");
    // Direct channels wear the other person's name, never the stored placeholder.
    expect(names).toContain("@ Bo");
    expect(names).not.toContain("Direct message");
  });

  it("lists every member as someone to message", () => {
    const view = render();

    expect(view.textContent).toContain("People");
    expect(view.textContent).toContain("Ava");
    expect(view.textContent).toContain("Bo");
  });

  it("shows GM channel controls to GMs only", () => {
    const gmView = render();
    expect(
      gmView.querySelectorAll("button[aria-label^='New']").length
    ).toBeGreaterThan(0);

    const player = renderAs("player-1");
    expect(
      player.box.querySelectorAll("button[aria-label^='New']").length
    ).toBe(0);
    player.done();
  });

  it("switches channels when a channel is picked", () => {
    const view = render();

    const ooc = channelButtons(view).find(
      (button) => button.textContent === "# Out of character"
    );
    expect(ooc).toBeTruthy();
    act(() => {
      ooc?.click();
    });
    expect(setOpenChannelId).toHaveBeenCalledWith("ooc");
  });

  it("opens a direct channel from the People list", async () => {
    vi.mocked(getOrCreateDirectChannel).mockResolvedValue("dm-9");
    const view = render();

    const bo = Array.from(view.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("Bo") &&
        button.textContent?.includes("message")
    );
    expect(bo).toBeTruthy();
    await act(async () => {
      bo?.click();
    });
    expect(getOrCreateDirectChannel).toHaveBeenCalledWith({
      campaignId: "campaign-1",
      otherUserId: "player-2",
    });
    expect(setOpenChannelId).toHaveBeenCalledWith("dm-9");
  });

  function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function dialogButton(name: string) {
    return Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === name && button.closest("[role='dialog']")
    );
  }

  function dialogCheckbox(label: string) {
    const item = Array.from(document.body.querySelectorAll("label")).find(
      (entry) =>
        entry.textContent === label && entry.closest("[role='dialog']")
    );
    return item?.querySelector("input");
  }

  it("creates a private channel for chosen people", async () => {
    vi.mocked(createPrivateChannel).mockResolvedValue("quest-9");
    const view = render();

    act(() => {
      view
        .querySelector("button[aria-label='New Private channel']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("New private channel");
    expect(document.body.textContent).toContain(
      "Who's in it (GMs can always see it)"
    );

    const name = document.body.querySelector("[role='dialog'] input");
    expect(name).toBeTruthy();
    typeInto(name as HTMLInputElement, "Harbor debt");
    act(() => {
      dialogCheckbox("Ava")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    await act(async () => {
      dialogButton("Create")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(createPrivateChannel).toHaveBeenCalledWith({
      campaignId: "campaign-1",
      name: "Harbor debt",
      kind: "IC",
      memberIds: ["player-1"],
    });
    expect(setOpenChannelId).toHaveBeenCalledWith("quest-9");
  });

  it("manages a private channel roster from its header", async () => {
    vi.mocked(setChannelMembers).mockResolvedValue(undefined);
    (state.chat as { openChannelId: string }).openChannelId = "quest";
    const view = render();

    act(() => {
      Array.from(view.querySelectorAll("button"))
        .find((button) => button.textContent === "Members")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Who's in Side quest");
    expect(document.body.textContent).toContain(
      "Anyone you remove loses access straight away."
    );

    // Ava starts checked (she is in the roster); Bo joins her.
    expect(dialogCheckbox("Ava")?.checked).toBe(true);
    act(() => {
      dialogCheckbox("Bo")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    await act(async () => {
      dialogButton("Save")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(setChannelMembers).toHaveBeenCalledWith({
      channelId: "quest",
      memberIds: ["gm-1", "player-1", "player-2"],
    });
    (state.chat as { openChannelId: string }).openChannelId = "ic";
  });

  it("names the open channel above its live feed and composer", () => {
    const view = render();

    expect(view.textContent).toContain("# In character");
    expect(view.textContent).toContain("Feed for ic");
    expect(view.textContent).toContain("Composer for In character");
  });

  it("opens My notes from the chat right pane in one step (desktop)", () => {
    const view = render();

    const myNotesTab = view.querySelectorAll('[role="tab"]');
    const names = Array.from(myNotesTab).map(
      (tab) => tab.textContent ?? ""
    );
    expect(names).toContain("My notes");

    act(() => {
      Array.from(myNotesTab)
        .find((tab) => tab.textContent === "My notes")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(view.textContent).toContain("My notes pane");
  });

  it("opens My notes from the bottom navigation in one step (phone)", () => {
    const view = render();

    const myNotesAction = Array.from(view.querySelectorAll("button")).find(
      (button) => button.textContent === "My notes"
    );
    expect(myNotesAction).toBeTruthy();
    act(() => {
      myNotesAction?.click();
    });
    expect(view.textContent).toContain("My notes pane");
    expect(view.textContent).not.toContain("Posts in this channel appear here");
  });

  it("shows the side screens beside chat at mid widths (md, below lg)", () => {
    mockViewport(1000);
    const view = render();

    const tabs = view.querySelectorAll('[role="tab"]');
    const names = Array.from(tabs).map((tab) => tab.textContent ?? "");
    expect(names).toContain("My notes");

    act(() => {
      Array.from(tabs)
        .find((tab) => tab.textContent === "My notes")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(view.textContent).toContain("My notes pane");
  });

  it("leaves the side screens out below md, where the bottom bar takes over", () => {
    mockViewport(390);
    const view = render();

    expect(view.querySelectorAll('[role="tab"]').length).toBe(0);
    const myNotesAction = Array.from(view.querySelectorAll("button")).find(
      (button) => button.textContent === "My notes"
    );
    expect(myNotesAction).toBeTruthy();
    act(() => {
      myNotesAction?.click();
    });
    expect(view.textContent).toContain("My notes pane");
  });
});
