import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import {
  TYPING_IDLE_MS,
  TYPING_THROTTLE_MS,
  subscribeToChannelTyping,
} from "./channelTyping";

vi.mock("config/supabase.config");

type StatusCallback = (status: string, error?: unknown) => void;
type PresenceCallback = () => void;

interface FakeChannel {
  topic: string;
  options: unknown;
  statusCallbacks: StatusCallback[];
  presenceCallbacks: PresenceCallback[];
  presenceState: () => Record<string, Array<Record<string, unknown>>>;
  track: ReturnType<typeof vi.fn>;
  untrack: ReturnType<typeof vi.fn>;
  on: (type: string, filter: unknown, cb: PresenceCallback) => FakeChannel;
  subscribe: (cb: StatusCallback) => FakeChannel;
}

interface FakeRealtime {
  channels: FakeChannel[];
  removeChannel: ReturnType<typeof vi.fn>;
  state: Record<string, Array<Record<string, unknown>>>;
}

function setUpClient(): FakeRealtime {
  const fake: FakeRealtime = {
    channels: [],
    removeChannel: vi.fn().mockResolvedValue("ok"),
    state: {},
  };
  vi.mocked(getSupabaseClient).mockReturnValue({
    channel: (topic: string, options: unknown) => {
      const channel: FakeChannel = {
        topic,
        options,
        statusCallbacks: [],
        presenceCallbacks: [],
        presenceState: () => fake.state,
        track: vi.fn(async (payload: Record<string, unknown>) => {
          fake.state[String(payload.uid)] = [payload];
          return "ok";
        }),
        untrack: vi.fn(async () => {
          fake.state = {};
          return "ok";
        }),
        on(type: string, filter: unknown, cb: PresenceCallback) {
          if (type === "presence" && filter) {
            channel.presenceCallbacks.push(cb);
          }
          return channel;
        },
        subscribe(cb: StatusCallback) {
          channel.statusCallbacks.push(cb);
          return channel;
        },
      };
      fake.channels.push(channel);
      return channel;
    },
    removeChannel: fake.removeChannel,
  } as never);
  return fake;
}

function subscribe(
  overrides: Partial<Parameters<typeof subscribeToChannelTyping>[0]> = {}
) {
  return subscribeToChannelTyping({
    channelId: "channel-1",
    uid: "player-1",
    displayName: "Sam",
    onTyping: vi.fn(),
    ...overrides,
  });
}

function sync(channel: FakeChannel) {
  for (const cb of channel.presenceCallbacks) cb();
}

/** Flush the promises the mocked track()/untrack() calls resolve. */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("subscribeToChannelTyping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("opens one private presence channel on the chat family, keyed by uid", () => {
    const client = setUpClient();
    subscribe();

    expect(client.channels).toHaveLength(1);
    const channel = client.channels[0];
    // The realtime-auth policies authorize `channel-posts%`; the suffix must
    // never share listenToRows' `:sub-` namespace (issue #116).
    expect(channel.topic).toMatch(/^channel-posts:channel-1:presence-/);
    expect(channel.topic).not.toContain(":sub-");
    expect(channel.options).toMatchObject({
      config: { private: true, presence: { key: "player-1" } },
    });
    expect(channel.presenceCallbacks).toHaveLength(1);
    expect(channel.statusCallbacks).toHaveLength(1);
  });

  it("tracks on the leading edge, then throttles for two seconds", async () => {
    const client = setUpClient();
    const controls = subscribe();

    controls.notifyTyping();
    await flush();
    const channel = client.channels[0];
    expect(channel.track).toHaveBeenCalledTimes(1);
    expect(channel.track).toHaveBeenCalledWith({
      uid: "player-1",
      displayName: "Sam",
      at: Date.now(),
    });

    controls.notifyTyping();
    await flush();
    expect(channel.track).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TYPING_THROTTLE_MS);
    controls.notifyTyping();
    await flush();
    expect(channel.track).toHaveBeenCalledTimes(2);
    expect(channel.track).toHaveBeenLastCalledWith({
      uid: "player-1",
      displayName: "Sam",
      at: Date.now(),
    });
  });

  it("stops after three idle seconds and lets the next keystroke track again", async () => {
    const client = setUpClient();
    const controls = subscribe();
    const channel = client.channels[0];

    controls.notifyTyping();
    await flush();
    const beforeThrottle = TYPING_THROTTLE_MS - 500;
    await vi.advanceTimersByTimeAsync(beforeThrottle);
    controls.notifyTyping(); // a keystroke resets the idle deadline
    await flush();
    expect(channel.track).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TYPING_IDLE_MS - 1);
    expect(channel.untrack).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(channel.untrack).toHaveBeenCalledTimes(1);

    // A stopped member tracks at once on the next keystroke, even inside
    // the throttle window: the idle clear reset the throttle too.
    await vi.advanceTimersByTimeAsync(1);
    controls.notifyTyping();
    await flush();
    expect(channel.track).toHaveBeenCalledTimes(2);
  });

  it("asserts the status track() resolves with", async () => {
    const client = setUpClient();
    const onError = vi.fn();
    const controls = subscribe({ onError });

    client.channels[0].track.mockResolvedValueOnce("error");
    controls.notifyTyping();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toContain(
      "presence track refused: error"
    );

    // A rejected write also surfaces instead of looking like a success.
    client.channels[0].track.mockRejectedValueOnce(new Error("socket down"));
    await vi.advanceTimersByTimeAsync(TYPING_THROTTLE_MS);
    controls.notifyTyping();
    await flush();
    expect(onError).toHaveBeenCalledTimes(2);
    expect((onError.mock.calls[1][0] as Error).message).toBe("socket down");
  });

  it("reports the presence uids from a sync, including payload-less states", () => {
    const client = setUpClient();
    const onTyping = vi.fn();
    subscribe({ onTyping });
    const channel = client.channels[0];

    client.state = {
      "player-2": [{ uid: "player-2", displayName: "Rae", at: 1 }],
      // The presence key is the uid even when the payload is missing.
      "gm-1": [{}],
    };
    sync(channel);
    expect(onTyping).toHaveBeenCalledWith(["player-2", "gm-1"]);
  });

  it("treats only SUBSCRIBED as success and reports dead-channel statuses", () => {
    const client = setUpClient();
    const onError = vi.fn();
    subscribe({ onError });
    const channel = client.channels[0];

    for (const cb of channel.statusCallbacks) cb("SUBSCRIBED");
    expect(onError).not.toHaveBeenCalled();

    for (const cb of channel.statusCallbacks) {
      cb("CHANNEL_ERROR", new Error("denied"));
      cb("TIMED_OUT");
      cb("CLOSED");
    }
    expect(onError).toHaveBeenCalledTimes(3);
    expect((onError.mock.calls[0][0] as Error).message).toContain(
      "presence subscribe CHANNEL_ERROR"
    );
  });

  it("untracks before leaving the topic, and ignores later events", async () => {
    const client = setUpClient();
    const onTyping = vi.fn();
    const onError = vi.fn();
    const controls = subscribe({ onTyping, onError });
    const channel = client.channels[0];

    controls.notifyTyping();
    await flush();
    await controls.unsubscribe();

    expect(channel.untrack).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
    expect(channel.untrack.mock.invocationCallOrder[0]).toBeLessThan(
      client.removeChannel.mock.invocationCallOrder[0]
    );

    controls.notifyTyping();
    sync(channel);
    for (const cb of channel.statusCallbacks) cb("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(TYPING_IDLE_MS + 1);
    expect(channel.track).toHaveBeenCalledTimes(1);
    expect(onTyping).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("clears presence on stopTyping without waiting for the idle timer", async () => {
    const client = setUpClient();
    const controls = subscribe();
    const channel = client.channels[0];

    controls.notifyTyping();
    await flush();
    controls.stopTyping();
    await flush();
    expect(channel.untrack).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TYPING_IDLE_MS + 1);
    expect(channel.untrack).toHaveBeenCalledTimes(1);
  });
});
