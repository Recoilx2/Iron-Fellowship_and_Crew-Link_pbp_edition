import { describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  subscribeBroadcast,
  type BroadcastSubscriber,
} from "api-calls/realtime/sharedBroadcastChannel";

type StatusCallback = (status: string, error?: unknown) => void;

function makeClient() {
  const channels: Array<{
    topic: string;
    messages: Array<(payload: unknown) => void>;
    statuses: StatusCallback[];
  }> = [];
  const removeChannel = vi.fn(() => Promise.resolve("ok"));
  const client = {
    channel(topic: string) {
      const record = { topic, messages: [] as Array<(p: unknown) => void>, statuses: [] as StatusCallback[] };
      const channel = {
        on(_type: string, _filter: unknown, cb: (payload: unknown) => void) {
          record.messages.push(cb);
          return channel;
        },
        subscribe(cb: StatusCallback) {
          record.statuses.push(cb);
          return channel;
        },
      };
      channels.push(record);
      return channel;
    },
    removeChannel,
  } as unknown as SupabaseClient;
  return { client, channels, removeChannel };
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

function fire(channels: ReturnType<typeof makeClient>["channels"], index: number, status: string, error?: unknown) {
  for (const cb of channels[index].statuses) cb(status, error);
}

describe("shared broadcast channels", () => {
  it("retries a failed cached join and moves every subscriber to the fresh channel", () => {
    const { client, channels, removeChannel } = makeClient();
    const first = makeSubscriber();
    const second = makeSubscriber();
    const stopFirst = subscribeBroadcast(client, "channel-shared:1", first.subscriber);
    fire(channels, 0, "TIMED_OUT");
    expect(first.statuses.map((s) => s.status)).toEqual(["TIMED_OUT"]);

    // A new required subscriber must not inherit the cached failure.
    const stopSecond = subscribeBroadcast(client, "channel-shared:1", second.subscriber);
    expect(channels).toHaveLength(2);
    expect(removeChannel).toHaveBeenCalledTimes(1);

    fire(channels, 1, "SUBSCRIBED");
    expect(first.statuses.at(-1)?.status).toBe("SUBSCRIBED");
    expect(second.statuses.at(-1)?.status).toBe("SUBSCRIBED");

    // Both are on the fresh channel: a message reaches both once.
    for (const cb of channels[1].messages) {
      cb({ event: "INSERT", payload: { record: { id: "a" } } });
    }
    expect(first.subscriber.onMessage).toHaveBeenCalledTimes(1);
    expect(second.subscriber.onMessage).toHaveBeenCalledTimes(1);
    stopFirst();
    stopSecond();
  });

  it("does not retry an optional-only topic denied by policy", async () => {
    const { client, channels, removeChannel } = makeClient();
    const first = makeSubscriber(true);
    const second = makeSubscriber(true);
    const stopFirst = subscribeBroadcast(client, "campaign-gm:1:notes", first.subscriber);
    fire(channels, 0, "CHANNEL_ERROR", new Error("denied"));
    const stopSecond = subscribeBroadcast(client, "campaign-gm:1:notes", second.subscriber);

    expect(channels).toHaveLength(1);
    expect(removeChannel).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(second.statuses.at(-1)?.status).toBe("CHANNEL_ERROR");
    stopFirst();
    stopSecond();
  });

  it("reuses a healthy channel and removes it only after the last subscriber leaves", async () => {
    const { client, channels, removeChannel } = makeClient();
    const first = makeSubscriber();
    const second = makeSubscriber();
    const stopFirst = subscribeBroadcast(client, "campaign-shared:1:notes", first.subscriber);
    fire(channels, 0, "SUBSCRIBED");
    const stopSecond = subscribeBroadcast(client, "campaign-shared:1:notes", second.subscriber);
    expect(channels).toHaveLength(1);
    await Promise.resolve();
    expect(second.statuses.at(-1)?.status).toBe("SUBSCRIBED");

    stopFirst();
    expect(removeChannel).not.toHaveBeenCalled();
    stopSecond();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
