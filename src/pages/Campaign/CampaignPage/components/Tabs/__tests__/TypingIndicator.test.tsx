/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const harness = vi.hoisted(() => ({
  emit: (uids: string[]) => {
    void uids;
  },
  stopTyping: vi.fn(),
  unsubscribe: vi.fn(async () => {}),
}));

vi.mock("api-calls/chat/channelTyping", () => ({
  subscribeToChannelTyping: ({
    onTyping,
  }: {
    onTyping: (uids: string[]) => void;
  }) => {
    harness.emit = onTyping;
    return {
      notifyTyping: vi.fn(),
      stopTyping: harness.stopTyping,
      unsubscribe: harness.unsubscribe,
    };
  },
}));

const state = {
  auth: { uid: "me", user: { displayName: "Me" } },
  chat: {
    channels: [
      { id: "channel-1", visibility: "public" as ChannelVisibility },
    ],
    membersByChannel: {} as Record<string, string[]>,
    drafts: {} as Record<string, string>,
  },
  campaigns: {
    currentCampaign: {
      currentCampaign: {
        users: ["me", "sam", "rae", "outsider"],
        gmIds: [] as string[],
      },
    },
  },
  users: {
    userMap: {
      me: { doc: { displayName: "Me" } },
      sam: { doc: { displayName: "Sam" } },
      rae: { doc: { displayName: "Rae" } },
      outsider: { doc: { displayName: "Outsider" } },
    } as Record<string, { doc: { displayName: string } }>,
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));

import type { ChannelVisibility } from "api-calls/chat/_chat.type";
import { useChannelTyping } from "hooks/useChannelTyping";
import { TypingIndicator } from "../TypingIndicator";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function TypingHarness() {
  const { typingNames } = useChannelTyping("channel-1");
  return <TypingIndicator typingNames={typingNames} />;
}

describe("TypingIndicator", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    state.chat.channels[0].visibility = "public";
    state.chat.membersByChannel = {};
    state.campaigns.currentCampaign.currentCampaign.gmIds = [];
    vi.clearAllMocks();
  });

  function render(node: React.ReactNode) {
    if (!container) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
    act(() => {
      root?.render(node);
    });
    return container as HTMLDivElement;
  }

  function indicator(view: HTMLDivElement): HTMLElement {
    const element = view.querySelector('[data-testid="typing-indicator"]');
    if (!element) {
      throw new Error("no typing indicator");
    }
    return element as HTMLElement;
  }

  it("is a polite live region that is empty when nobody is typing", () => {
    const view = render(<TypingIndicator typingNames={[]} />);
    const element = indicator(view);
    expect(element.getAttribute("aria-live")).toBe("polite");
    expect(element.textContent).toBe("");
  });

  it("formats one, two and three or more typists", () => {
    const view = render(<TypingIndicator typingNames={["Sam"]} />);
    expect(indicator(view).textContent).toBe("Sam is typing…");

    render(<TypingIndicator typingNames={["Sam", "Rae"]} />);
    expect(indicator(view).textContent).toBe("Sam and Rae are typing…");

    render(<TypingIndicator typingNames={["Sam", "Rae", "Outsider"]} />);
    expect(indicator(view).textContent).toBe("3 people are typing…");
  });

  it("shows only readable members, never the reader or unknown uids", () => {
    const view = render(<TypingHarness />);
    act(() => {
      harness.emit(["me", "sam", "ghost"]);
    });
    // Public: the campaign roster decides. Self and unknown uids are dropped.
    expect(indicator(view).textContent).toBe("Sam is typing…");
  });

  it("adds GMs to a private channel's roster and keeps outsiders out", () => {
    state.chat.channels[0].visibility = "private";
    state.chat.membersByChannel = { "channel-1": ["me", "rae"] };
    state.campaigns.currentCampaign.currentCampaign.gmIds = ["sam"];
    const view = render(<TypingHarness />);

    act(() => {
      harness.emit(["outsider", "rae", "sam", "me"]);
    });
    expect(indicator(view).textContent).toBe("Rae and Sam are typing…");
  });

  it("restricts a direct message to its two members, even with a GM present", () => {
    state.chat.channels[0].visibility = "dm";
    state.chat.membersByChannel = { "channel-1": ["me", "sam"] };
    state.campaigns.currentCampaign.currentCampaign.gmIds = ["sam"];
    const view = render(<TypingHarness />);

    act(() => {
      harness.emit(["rae", "sam", "me"]);
    });
    // Rae is on the campaign roster but not in this direct message.
    expect(indicator(view).textContent).toBe("Sam is typing…");
  });

  it("takes the name from the user map, not the presence payload", () => {
    const view = render(<TypingHarness />);
    state.users.userMap["sam"] = { doc: { displayName: "Renamed Sam" } };
    act(() => {
      harness.emit(["sam"]);
    });
    expect(indicator(view).textContent).toBe("Renamed Sam is typing…");
    state.users.userMap["sam"] = { doc: { displayName: "Sam" } };
  });
});
