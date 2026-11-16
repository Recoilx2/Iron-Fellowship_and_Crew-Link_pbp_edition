/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

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
    ],
    membersByChannel: {},
    openChannelId: "ic",
    loading: false,
    error: undefined,
    setOpenChannelId: vi.fn(),
  },
  campaigns: {
    currentCampaign: {
      currentCampaignId: "campaign-1",
      currentCampaign: { gmIds: ["gm-1"], users: ["gm-1"] },
    },
  },
  auth: { uid: "gm-1" },
  users: { userMap: {}, loadUserDocuments: () => {} },
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
vi.mock("../../Tabs/ChatFeed", () => ({
  ChatFeed: () => <div data-testid={"feed"}>Feed</div>,
}));
vi.mock("../../Tabs/ChatComposer", () => ({ ChatComposer: () => null }));
vi.mock("api-calls/chat/createChannel", () => ({ createChannel: vi.fn() }));
vi.mock("api-calls/chat/createPrivateChannel", () => ({
  createPrivateChannel: vi.fn(),
}));
vi.mock("api-calls/chat/getOrCreateDirectChannel", () => ({
  getOrCreateDirectChannel: vi.fn(),
}));
vi.mock("api-calls/chat/setChannelMembers", () => ({
  setChannelMembers: vi.fn(),
}));
vi.mock("api-calls/chat/renameChannel", () => ({ renameChannel: vi.fn() }));
vi.mock("api-calls/chat/archiveChannel", () => ({ archiveChannel: vi.fn() }));
vi.mock("../../Tabs/CharacterTab", () => ({
  CharacterTab: () => <div>Character pane</div>,
}));
vi.mock("../../Tabs/TracksTab", () => ({ TracksTab: () => null }));
vi.mock("../../Tabs/MyNotesTab", () => ({ MyNotesTab: () => null }));
vi.mock("../../Tabs/WorldTab", () => ({ WorldTab: () => null }));
vi.mock("components/features/worlds/Locations", () => ({
  LocationsSection: () => null,
}));
vi.mock("components/features/worlds/NPCSection", () => ({
  NPCSection: () => null,
}));
vi.mock("components/features/worlds/Lore", () => ({
  LoreSection: () => null,
}));
vi.mock("hooks/useCampaignType", () => ({
  useCampaignType: () => ({ showGuideTips: false, showGuidedPlayerView: false }),
}));
vi.mock("components/shared/UserAvatar", () => ({ UserAvatar: () => null }));
vi.mock("../GMAssistantPanel", () => ({
  GMAssistantPanel: (props: { onClose: () => void }) => (
    <div data-testid={"panel"}>
      <button aria-label={"Close assistant"} onClick={props.onClose} />
    </div>
  ),
}));

import { ChatTab } from "../../Tabs/ChatTab";
import { GMAssistant } from "../GMAssistant";
import { GMAssistantDockProvider } from "../GMAssistantDock";

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

// Seam under test (ticket #150): the campaign screen's header button and
// the Chat tab's side pane, joined by the dock provider. On desktop the
// open assistant takes the side pane's place; on phones it stays a
// full-screen dialog and the Chat tab is untouched.
describe("GM assistant docking", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

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
          <GMAssistantDockProvider>
            <GMAssistant />
            <ChatTab openInviteDialog={() => {}} />
          </GMAssistantDockProvider>
        </ThemeProvider>
      );
    });
    return container;
  }

  const trigger = (view: HTMLElement) =>
    Array.from(view.querySelectorAll("button")).find(
      (button) => button.textContent === "Assistant"
    ) as HTMLButtonElement;

  const click = (element: Element) =>
    act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  it("docks the panel in the side pane's place on desktop", () => {
    mockViewport(1400);
    const view = render();
    expect(view.querySelector('[data-testid="chat-side-pane"]')).not.toBeNull();

    click(trigger(view));

    const dock = view.querySelector('[data-testid="assistant-dock"]');
    expect(dock).not.toBeNull();
    expect(dock?.querySelector('[data-testid="panel"]')).not.toBeNull();
    expect(view.querySelector('[data-testid="chat-side-pane"]')).toBeNull();
    // Docked inside the Chat card beside the feed, not floating over it.
    expect(view.querySelector(".MuiDrawer-root")).toBeNull();
    expect(view.querySelector('[data-testid="feed"]')).not.toBeNull();
    // Focus moved into the panel region.
    const region = dock?.querySelector('[role="complementary"]');
    expect(document.activeElement).toBe(region);
  });

  it("brings the side pane back and refocuses the button on close", () => {
    mockViewport(1400);
    const view = render();
    click(trigger(view));

    click(view.querySelector('button[aria-label="Close assistant"]') as Element);

    expect(view.querySelector('[data-testid="assistant-dock"]')).toBeNull();
    expect(view.querySelector('[data-testid="chat-side-pane"]')).not.toBeNull();
    expect(document.activeElement).toBe(trigger(view));
  });

  it("keeps the full-screen dialog on phones and leaves the chat alone", () => {
    mockViewport(390);
    const view = render();

    click(trigger(view));

    expect(view.querySelector('[data-testid="assistant-dock"]')).toBeNull();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('[data-testid="panel"]')).not.toBeNull();
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });
});
