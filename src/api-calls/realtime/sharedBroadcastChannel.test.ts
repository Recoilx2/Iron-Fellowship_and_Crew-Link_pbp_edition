import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  subscribeBroadcast,
  type BroadcastSubscriber,
} from "api-calls/realtime/sharedBroadcastChannel";

type StatusCallback = (status: string, error?: unknown) => void;

interface FakeChannel {
  topic: string;
  messages: Array<(payload: unknown) => void>;
  statuses: StatusCallback[];
  failed: boolean;
  closed: boolean;
  on(type: string, filter: unknown, cb: (payload: unknown) => void): FakeChannel;
  subscribe(cb: StatusCallback): FakeChannel;
}

/**
 * Faithful enough for the realtime-js contracts that matter here: channel()
 * reuses by topic until removeChannel resolves, a failed join never emits
 * another status, and handlers can only be added before subscribe().
 */
function makeClient() {
  const open = new Map<string, FakeChannel>();
  const created: FakeChannel[] = [];
  // realtime-js keeps returning the same object by topic until teardown
  // resolves. Resolve removals only when the test says so, so an un-awaited
  // `void client.removeChannel(...)` still sees the OLD channel object.
  const pendingRemovals: Array<() => void> = [];
  const removeChannel = vi.fn(
    (channel: FakeChannel) =>
      new Promise<string>((resolve) => {
        pendingRemovals.push(() => {
          channel.closed = true;
          if (open.get(channel.topic) === channel) open.delete(channel.topic);
          resolve("ok");
        });
      })
  );
  const client = {
    channel(topic: string): FakeChannel {
      const existing = open.get(topic);
      if (existing) return existing;
      const channel: FakeChannel = {
        topic,
        messages: [],
        statuses: [],
        failed: false,
        closed: false,
        on(_type, _filter, cb) {
          if (this.statuses.length > 0) {
            throw new Error("cannot add a broadcast handler after subscribe()");
          }
          this.messages.push(cb);
          return this;
        },
        subscribe(cb) {
          // A channel that already failed never emits another status, and
          // a closed one cannot be re-subscribed.
          if (!this.failed && !this.closed) this.statuses.push(cb);
          return this;
        },
      };
      open.set(topic, channel);
      created.push(channel);
      return channel;
    },
    removeChannel,
  } as unknown as SupabaseClient;
  const settleRemovals = () => {
    for (const finish of pendingRemovals.splice(0)) finish();
  };
  return { client, created, removeChannel, settleRemovals };
}

function makeSubscriber(optional = false) {
  const statuses: Array<{ status: string; error?: unknown }> = [];
  const subscriber: BroadcastSubscriber = {
    optional,
    onMessage: vi.fn(),
    onStatus: (status, error) => statuses.push({ status, error }),
  };
  return { subscriber, statuses };
}

function fire(channel: FakeChannel, status: string, error?: unknown) {
  if (status !== "SUBSCRIBED") channel.failed = true;
  for (const cb of [...channel.statuses]) cb(status, error);
}

describe("shared broadcast channels", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Deterministic jitter: the first retry lands at exactly 200 ms.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("heals a cached failure for both old and late subscribers", async () => {
    const { client, created, removeChannel, settleRemovals } = makeClient();
    const first = makeSubscriber();
    const late = makeSubscriber();
    const stopFirst = subscribeBroadcast(
      client,
      "campaign-shared:1:chat",
      first.subscriber
    );
    fire(created[0], "TIMED_OUT");
    expect(first.statuses.map((entry) => entry.status)).toEqual(["TIMED_OUT"]);

    // A late subscriber must NOT get a fresh channel synchronously: both
    // listeners join the one bounded retry already scheduled for the record.
    subscribeBroadcast(client, "campaign-shared:1:chat", late.subscriber);
    expect(created).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(200);
    settleRemovals();
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(2);
    expect(removeChannel).toHaveBeenCalledTimes(1);
    fire(created[1], "SUBSCRIBED");

    expect(first.statuses.at(-1)?.status).toBe("SUBSCRIBED");
    expect(late.statuses.at(-1)?.status).toBe("SUBSCRIBED");
    stopFirst();
  });

  it("does not replace a channel that recovered while removal was pending", async () => {
    const { client, created, settleRemovals } = makeClient();
    const sub = makeSubscriber();
    const stop = subscribeBroadcast(client, "channel-shared:1", sub.subscriber);
    fire(created[0], "TIMED_OUT");
    await vi.advanceTimersByTimeAsync(200);
    // The retry is suspended awaiting removeChannel; the old generation
    // recovers in the meantime and announces success exactly once.
    fire(created[0], "SUBSCRIBED");
    expect(sub.statuses.filter((entry) => entry.status === "SUBSCRIBED")).toHaveLength(1);
    settleRemovals();
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(1);
    expect(sub.statuses.filter((entry) => entry.status === "SUBSCRIBED")).toHaveLength(1);
    stop();
  });

  it("uses bounded backoff, one retry at a time, and cancels on SUBSCRIBED", async () => {
    const { client, created, settleRemovals } = makeClient();
    const sub = makeSubscriber();
    const stop = subscribeBroadcast(client, "channel-shared:1", sub.subscriber);
    fire(created[0], "CHANNEL_ERROR");

    // Multiple timer ticks while the first retry is pending must not stack.
    await vi.advanceTimersByTimeAsync(200);
    settleRemovals();
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(2);
    fire(created[1], "TIMED_OUT");
    await vi.advanceTimersByTimeAsync(400);
    settleRemovals();
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(3);
    fire(created[2], "SUBSCRIBED");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(created).toHaveLength(3);
    expect(sub.statuses.filter((entry) => entry.status === "SUBSCRIBED")).toHaveLength(1);
    stop();
  });

  it("never retries an optional-only topic denied by policy", async () => {
    const { client, created, removeChannel } = makeClient();
    const first = makeSubscriber(true);
    const late = makeSubscriber(true);
    const stopFirst = subscribeBroadcast(
      client,
      "campaign-gm:1:notes",
      first.subscriber
    );
    fire(created[0], "CHANNEL_ERROR", new Error("denied"));
    const stopLate = subscribeBroadcast(
      client,
      "campaign-gm:1:notes",
      late.subscriber
    );
    await Promise.resolve();
    expect(late.statuses.at(-1)?.status).toBe("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(created).toHaveLength(1);
    expect(removeChannel).not.toHaveBeenCalled();
    stopFirst();
    stopLate();
  });

  it("cancels a pending retry when the last subscriber releases", async () => {
    const { client, created, removeChannel } = makeClient();
    const sub = makeSubscriber();
    const stop = subscribeBroadcast(client, "channel-shared:1", sub.subscriber);
    fire(created[0], "TIMED_OUT");
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(created).toHaveLength(1);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("replays SUBSCRIBED once to a late subscriber on a healthy channel", async () => {
    const { client, created } = makeClient();
    const first = makeSubscriber();
    const late = makeSubscriber();
    const stopFirst = subscribeBroadcast(client, "channel-shared:1", first.subscriber);
    fire(created[0], "SUBSCRIBED");
    const stopLate = subscribeBroadcast(client, "channel-shared:1", late.subscriber);
    await Promise.resolve();
    expect(late.statuses.map((entry) => entry.status)).toEqual(["SUBSCRIBED"]);
    expect(first.statuses).toHaveLength(1);
    expect(created).toHaveLength(1);
    stopFirst();
    stopLate();
  });
});
