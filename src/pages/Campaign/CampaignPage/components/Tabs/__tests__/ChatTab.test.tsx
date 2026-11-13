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
        isStarting: true,
        archived: false,
      },
      {
        id: "ooc",
        name: "Out of character",
        kind: "OOC",
        isStarting: true,
        archived: false,
      },
      {
        id: "side",
        name: "Side scene",
        kind: "OOC",
        isStarting: false,
        archived: true,
      },
    ],
    openChannelId: "ic",
    loading: false,
    error: undefined,
    setOpenChannelId,
  },
  campaigns: {
    currentCampaign: {
      currentCampaignId: "campaign-1",
      currentCampaign: { gmIds: ["gm-1"] },
    },
  },
  auth: { uid: "gm-1" },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock("stores/chat/useListenToChatChannels", () => ({
  useListenToChatChannels: () => {},
}));
vi.mock("api-calls/chat/createChannel", () => ({
  createChannel: vi.fn(),
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

import { ChatTab } from "../ChatTab";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChatTab channels", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    // Wide viewport: the desktop right pane with the campaign screens is
    // part of the DOM, like the phone bottom navigation below it.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
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
      /^# /.test(button.textContent ?? "")
    );
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

  it("shows GM channel controls to GMs only", () => {
    const gmView = render();
    expect(
      gmView.querySelectorAll("button[aria-label^='New']").length
    ).toBeGreaterThan(0);

    (state.auth as { uid: string }).uid = "player-1";
    const playerContainer = document.createElement("div");
    document.body.appendChild(playerContainer);
    const playerRoot = createRoot(playerContainer);
    act(() => {
      playerRoot.render(
        <ThemeProvider theme={theme}>
          <ChatTab openInviteDialog={() => {}} />
        </ThemeProvider>
      );
    });
    expect(
      playerContainer.querySelectorAll("button[aria-label^='New']").length
    ).toBe(0);
    (state.auth as { uid: string }).uid = "gm-1";
    act(() => playerRoot.unmount());
    playerContainer.remove();
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

  it("names the open channel above the feed placeholder", () => {
    const view = render();

    expect(view.textContent).toContain("# In character");
    // Posts land in the next ticket; the tab holds their place.
    expect(view.textContent).toContain("Posts in this channel appear here");
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
});
