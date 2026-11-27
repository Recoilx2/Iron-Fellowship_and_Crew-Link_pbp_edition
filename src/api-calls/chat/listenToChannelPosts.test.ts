import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  channelPostBroadcastChange,
  listenToChannelPosts,
} from "api-calls/chat/listenToChannelPosts";
import {
  broadcastRowsBinding,
  RECONCILE_INTERVAL_MS,
} from "api-calls/realtime/listenToRows";
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
  const broadcastCbs: Array<(payload: unknown) => void> = [];
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
    on: (type: string, _filter: unknown, cb: (payload: unknown) => void) => {
      if (type === "broadcast") broadcastCbs.push(cb);
      return channel;
    },
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
    fireBroadcast: (event: string, payload: unknown) => {
      for (const cb of broadcastCbs) cb({ event, payload });
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

describe("GM-only post broadcasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const secretPost = (): PostRow => ({
    ...newestFirst(1)[0],
    id: "secret-1",
    gms_only: true,
  });

  it("drops GM-only upserts and delete keys for players, not GMs", () => {
    const row = secretPost();
    expect(
      channelPostBroadcastChange(false, {
        event: "INSERT",
        payload: { operation: "INSERT", table: "chat_posts", record: row },
      })
    ).toBeNull();
    expect(
      channelPostBroadcastChange(false, {
        event: "DELETE",
        payload: {
          operation: "DELETE",
          table: "chat_posts",
          old_record: row,
        },
      })
    ).toBeNull();
    // A key-only delete with just the flag must not leak the id either.
    expect(
      channelPostBroadcastChange(false, {
        event: "DELETE",
        payload: {
          operation: "DELETE",
          table: "chat_posts",
          id: "secret-1",
          gms_only: true,
        },
      })
    ).toBeNull();
    expect(
      channelPostBroadcastChange(true, {
        event: "INSERT",
        payload: { operation: "INSERT", table: "chat_posts", record: row },
      })
    ).toEqual({ kind: "upsert", row });
    expect(
      channelPostBroadcastChange(true, {
        event: "DELETE",
        payload: {
          operation: "DELETE",
          table: "chat_posts",
          old_record: row,
        },
      })
    ).toEqual({ kind: "remove", key: "secret-1" });
    expect(
      channelPostBroadcastChange(false, {
        event: "INSERT",
        payload: {
          operation: "INSERT",
          table: "chat_posts",
          record: { ...row, gms_only: false },
        },
      })
    ).toEqual({ kind: "upsert", row: { ...row, gms_only: false } });
  });

  it("turns accepted broadcast rows into refreshes, dropping GM-only ones", () => {
    const message = {
      event: "INSERT",
      payload: {
        operation: "INSERT",
        table: "chat_posts",
        record: secretPost(),
      },
    };
    const binding = (isGM: boolean) =>
      broadcastRowsBinding<PostRow>({
        topic: "channel-shared:channel-1",
        refreshOnly: true,
        getKey: (row) => row.id,
        toChange: (received) => channelPostBroadcastChange(isGM, received),
      });
    expect(binding(true).toChange(message)).toEqual({ kind: "refresh" });
    expect(binding(false).toChange(message)).toBeNull();
  });

  it("never applies a broadcast row to the feed", async () => {
    for (const isGM of [false, true]) {
      const client = setUpClient();
      const onPosts = vi.fn();
      const onError = vi.fn();
      const stop = listenToChannelPosts(
        "channel-1",
        30,
        { onPosts, onHasOlder: vi.fn(), onLoaded: vi.fn() },
        onError,
        { isGM }
      );
      client.fireSubscribed();
      await vi.advanceTimersByTimeAsync(0);
      const fetchesBefore = client.seenLimits.length;
      onPosts.mockClear();

      client.fireBroadcast("INSERT", {
        operation: "INSERT",
        table: "chat_posts",
        record: secretPost(),
      });
      // A GM's accepted broadcast queues an RLS-filtered re-fetch; a
      // player's GM-only broadcast is dropped before that. Neither path
      // inserts raw broadcast row data into the feed.
      expect(client.seenLimits.length).toBe(fetchesBefore + (isGM ? 1 : 0));
      expect(onPosts).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      stop();
    }
  });
});
