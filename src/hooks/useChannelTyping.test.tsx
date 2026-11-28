/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  handlers: 0,
  onAfterSubscribe: 0,
  subscribed: false,
  created: 0,
  pendingRemovals: [] as Array<() => void>,
  settle: () => {
    for (const finish of harness.pendingRemovals.splice(0)) finish();
  },
}));

vi.mock("api-calls/chat/channelTyping", () => ({
  subscribeToChannelTyping: () => {
    if (harness.subscribed) {
      // This is the realtime-js failure the hook must avoid.
      harness.onAfterSubscribe += 1;
      throw new Error("cannot add 'presence' callbacks after subscribe()");
    }
    harness.subscribed = true;
    harness.created += 1;
    harness.handlers += 1;
    let removed = false;
    return {
      notifyTyping: () => {},
      stopTyping: () => {},
      unsubscribe: async () => {
        if (removed) return;
        removed = true;
        await new Promise<void>((resolve) => {
          harness.pendingRemovals.push(() => {
            harness.handlers -= 1;
            harness.subscribed = false;
            resolve();
          });
        });
      },
    };
  },
}));

const state = {
  auth: { uid: "player-1", user: { displayName: "Sam" } },
  chat: { channels: [], membersByChannel: {}, drafts: {} },
  campaigns: { currentCampaign: { currentCampaign: { gmIds: [] as string[] } } },
  users: { userMap: {} },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));

import { useChannelTyping } from "./useChannelTyping";

function TypingConsumer() {
  useChannelTyping("channel-1");
  return null;
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useChannelTyping teardown serialization", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    harness.handlers = 0;
    harness.onAfterSubscribe = 0;
    harness.subscribed = false;
    harness.created = 0;
    harness.pendingRemovals.splice(0);
  });

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<TypingConsumer />));
  }

  function unmount() {
    act(() => root?.unmount());
    root = undefined;
  }

  it("waits through mount/unmount/mount/unmount/mount with deferred removals", async () => {
    mount();
    expect(harness.handlers).toBe(1);
    unmount();
    // Removal is pending; the channel is still joined.
    expect(harness.handlers).toBe(1);

    mount();
    // Setup waits for the pending teardown, so it has not subscribed yet.
    expect(harness.created).toBe(1);
    unmount(); // cancelled while waiting; the flag must stay set

    mount();
    expect(harness.created).toBe(1);
    await act(async () => {
      harness.settle();
      await Promise.resolve();
    });

    expect(harness.onAfterSubscribe).toBe(0);
    // The two old subscriptions left; the third is the only live one.
    expect(harness.handlers).toBe(1);
    // The middle mount was cancelled while waiting and never subscribed.
    expect(harness.created).toBe(2);
    expect(harness.pendingRemovals).toHaveLength(0);
  });
});
