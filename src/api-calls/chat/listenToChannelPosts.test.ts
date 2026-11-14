import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listenToChannelPosts,
} from "api-calls/chat/listenToChannelPosts";
import { RECONCILE_INTERVAL_MS } from "api-calls/realtime/listenToRows";
import type { PostRow } from "api-calls/chat/_postRef";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedClient = vi.mocked(getSupabaseClient);

// Seam under test: the post listener's fetch asks for its live window (plus
// one lookahead row) on every fetch -- first load and reconcile tick -- so
// the live subscription stays one page and older pages arrive through the
// one-off query instead. The shared reconcile loop itself is covered by its
// own tests; here the realtime channel and the posts table are stubs.
function newestFirst(count: number): PostRow[] {
  const base = Date.parse("2026-11-13T12:00:00.000Z");
  return Array.from({ length: count }, (_, i) => {
    const n = count - 1 - i;
    const stamp = new Date(base + n * 1000).toISOString();
    return {
      id: `post-${n}`,
      channel_id: "channel-1",
      author_id: "player-1",
      speaker_character_id: null,
      speaker_npc_id: null,
      text: `post ${n}`,
      image_paths: [],
      roll: null,
      gms_only: false,
      created_at: stamp,
      updated_at: stamp,
      edited_at: null,
      deleted_at: null,
    };
  });
}

type StatusCallback = (status: string, error?: unknown) => void;

function setUpClient() {
  const subscribeCbs: StatusCallback[] = [];
  const seenLimits: number[] = [];
  let rows: PostRow[] = [];
  const terminal = {
    limit: (n: number) => {
      seenLimits.push(n);
      return Promise.resolve({ data: rows.slice(0, n), error: null });
    },
  };
  const chained = {
    select: () => ({
      eq: () => ({ order: () => ({ order: () => terminal }) }),
    }),
  };
  const channel = {
    on: () => channel,
    subscribe: (cb: StatusCallback) => {
      subscribeCbs.push(cb);
      return channel;
    },
  };
  mockedClient.mockReturnValue({
    channel: () => channel,
    from: () => chained,
    removeChannel: () => Promise.resolve("ok"),
  } as never);
  return {
    seenLimits,
    setRows: (next: PostRow[]) => {
      rows = next;
    },
    fireSubscribed: () => {
      for (const cb of subscribeCbs.splice(0)) {
        cb("SUBSCRIBED");
      }
    },
  };
}

describe("chat post window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("re-fetches the whole loaded window on every tick, capped", async () => {
    const client = setUpClient();
    const onPosts = vi.fn();
    const onHasOlder = vi.fn();
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const handler = { onPosts, onHasOlder, onLoaded };

    // The latest page loads first, with one lookahead row for the flag.
    client.setRows(newestFirst(31));
    const stopPage1 = listenToChannelPosts("channel-1", 30, handler, onError);
    client.fireSubscribed();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.seenLimits).toEqual([31]);
    expect(onPosts).toHaveBeenCalledTimes(1);
    expect(onPosts.mock.calls[0][0]).toHaveLength(30);
    expect(onHasOlder).toHaveBeenCalledWith(true);

    // Paging back re-subscribes with the wider window (the slice stops the
    // old feed first): older pages join the front, with the new oldest row
    // held back as the has-older lookahead.
    stopPage1();
    client.setRows(newestFirst(61));
    const stopPage2 = listenToChannelPosts("channel-1", 60, handler, onError);
    client.fireSubscribed();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.seenLimits).toContain(61);
    const widened = onPosts.mock.calls[onPosts.mock.calls.length - 1][0];
    expect(widened).toHaveLength(60);
    expect(widened[0].id).toBe("post-1");

    // The reconcile tick re-fetches that same window, so the live page
    // stays; with nothing changed nothing re-emits.
    const callsBeforeTick = onPosts.mock.calls.length;
    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);
    expect(
      client.seenLimits[client.seenLimits.length - 1]
    ).toBe(61);
    expect(onPosts.mock.calls.length).toBe(callsBeforeTick);
    const retained = onPosts.mock.calls[onPosts.mock.calls.length - 1][0];
    expect(retained).toHaveLength(60);
    expect(retained[0].id).toBe("post-1");

    // The window is not capped: a caller asking for more gets more, and the
    // lookahead row still rides along.
    listenToChannelPosts("channel-1", 99_999, handler, onError);
    client.fireSubscribed();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.seenLimits[client.seenLimits.length - 1]).toBe(100_000);

    stopPage2();
    expect(onError).not.toHaveBeenCalled();
  });
});
