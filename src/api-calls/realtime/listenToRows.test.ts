import { describe, expect, it, vi } from "vitest";

import { listenToRows } from "api-calls/realtime/listenToRows";
import type { PostgresChangePayload } from "api-calls/realtime/listenToRows";

interface Row {
  id: string;
  value: string;
  updated_at: string;
}

type StatusCallback = (status: string, err?: unknown) => void;
type EventCallback = (payload: never) => void;

interface FakeChannel {
  on(type: string, filter: unknown, cb: EventCallback): FakeChannel;
  subscribe(cb: StatusCallback): FakeChannel;
}

function makeFakeRealtime() {
  const channels: Array<{
    name: string;
    options: unknown;
    bindings: Array<{ type: string; cb: EventCallback }>;
    subscribeCbs: StatusCallback[];
  }> = [];
  const removeChannel = vi.fn().mockResolvedValue("ok");

  const client = {
    channel(name: string, options: unknown): FakeChannel {
      const record: {
        name: string;
        options: unknown;
        bindings: Array<{ type: string; cb: EventCallback }>;
        subscribeCbs: StatusCallback[];
      } = { name, options, bindings: [], subscribeCbs: [] };
      channels.push(record);
      const channel: FakeChannel = {
        on(type: string, _filter: unknown, cb: EventCallback) {
          record.bindings.push({ type, cb });
          return channel;
        },
        subscribe(cb: StatusCallback) {
          record.subscribeCbs.push(cb);
          return channel;
        },
      };
      return channel;
    },
    removeChannel,
  };

  return { client, channels, removeChannel };
}

function postgresChanges<T>(table: string, toChange: (payload: {
  new: T;
  old: Partial<T> | null;
}) => { kind: "upsert"; row: T } | { kind: "remove"; key: string } | null) {
  return {
    type: "postgres_changes" as const,
    table,
    toChange: toChange as (
      payload: PostgresChangePayload<Row>
    ) => { kind: "upsert"; row: Row } | { kind: "remove"; key: string } | null,
  };
}

const keyOf = (row: Row) => row.id;
const stampOf = (row: Row) => row.updated_at;

function settle(channels: ReturnType<typeof makeFakeRealtime>["channels"]) {
  for (const cb of channels[0].subscribeCbs) cb("SUBSCRIBED");
}

function emitPostgres(
  channels: ReturnType<typeof makeFakeRealtime>["channels"],
  payload: unknown
) {
  for (const binding of channels[0].bindings) {
    if (binding.type === "postgres_changes") binding.cb(payload as never);
  }
}

describe("listenToRows", () => {
  it("always opens the channel as private", () => {
    const { client, channels } = makeFakeRealtime();

    listenToRows<Row>({
      client: client as never,
      channelName: "user-settings:abc",
      bindings: [postgresChanges<Row>("user_settings", () => null)],
      fetchRows: () => Promise.resolve([]),
      getKey: keyOf,
      onRows: () => {},
    });

    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("user-settings:abc");
    // Subset-match: the installed SDK merges broadcast/presence defaults into
    // the params in place, so exact equality is brittle. Private must stay true.
    expect(channels[0].options).toMatchObject({ config: { private: true } });
  });

  it("emits the current rows once subscribed", async () => {
    const { client, channels } = makeFakeRealtime();
    const onRows = vi.fn();
    const current: Row[] = [
      { id: "a", value: "one", updated_at: "2026-11-12T00:00:01Z" },
    ];

    listenToRows<Row>({
      client: client as never,
      channelName: "user-settings:abc",
      bindings: [postgresChanges<Row>("user_settings", () => null)],
      fetchRows: () => Promise.resolve(current),
      getKey: keyOf,
      getUpdatedAt: stampOf,
      onRows,
    });
    expect(onRows).not.toHaveBeenCalled();

    settle(channels);
    await Promise.resolve();
    await Promise.resolve();

    expect(onRows).toHaveBeenCalledTimes(1);
    expect(onRows).toHaveBeenCalledWith(current);
  });

  it("buffers events that arrive before subscribing and merges them in order", async () => {
    const { client, channels } = makeFakeRealtime();
    const onRows = vi.fn();
    const seen: Row[][] = [];
    onRows.mockImplementation((rows: Row[]) => seen.push(rows));

    listenToRows<Row>({
      client: client as never,
      channelName: "user-settings:abc",
      bindings: [
        postgresChanges<Row>("user_settings", (payload) =>
          payload.new?.id
            ? { kind: "upsert", row: payload.new }
            : null
        ),
      ],
      fetchRows: () =>
        Promise.resolve([
          { id: "a", value: "one", updated_at: "2026-11-12T00:00:01Z" },
        ]),
      getKey: keyOf,
      getUpdatedAt: stampOf,
      onRows,
    });

    // A change lands while the initial fetch is still in flight.
    emitPostgres(channels, {
      new: { id: "a", value: "two", updated_at: "2026-11-12T00:00:02Z" },
      old: null,
    });

    settle(channels);
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([
      { id: "a", value: "two", updated_at: "2026-11-12T00:00:02Z" },
    ]);
  });

  it("delivers later changes in order", async () => {
    const { client, channels } = makeFakeRealtime();
    const seen: Row[][] = [];

    listenToRows<Row>({
      client: client as never,
      channelName: "rows",
      bindings: [
        postgresChanges<Row>("user_settings", (payload) =>
          payload.new?.id ? { kind: "upsert", row: payload.new } : null
        ),
      ],
      fetchRows: () => Promise.resolve([]),
      getKey: keyOf,
      getUpdatedAt: stampOf,
      onRows: (rows) => seen.push(rows),
    });
    settle(channels);
    await Promise.resolve();
    await Promise.resolve();

    emitPostgres(channels, {
      new: { id: "a", value: "one", updated_at: "2026-11-12T00:00:01Z" },
      old: null,
    });
    emitPostgres(channels, {
      new: { id: "a", value: "two", updated_at: "2026-11-12T00:00:02Z" },
      old: null,
    });

    expect(seen.map((rows) => rows.map((r) => r.value))).toEqual([
      [],
      ["one"],
      ["two"],
    ]);
  });

  it("drops events older than the row already held", async () => {
    const { client, channels } = makeFakeRealtime();
    const onRows = vi.fn();

    listenToRows<Row>({
      client: client as never,
      channelName: "rows",
      bindings: [
        postgresChanges<Row>("user_settings", (payload) =>
          payload.new?.id ? { kind: "upsert", row: payload.new } : null
        ),
      ],
      fetchRows: () =>
        Promise.resolve([
          { id: "a", value: "new", updated_at: "2026-11-12T00:00:05Z" },
        ]),
      getKey: keyOf,
      getUpdatedAt: stampOf,
      onRows,
    });
    settle(channels);
    await Promise.resolve();
    await Promise.resolve();
    onRows.mockClear();

    emitPostgres(channels, {
      new: { id: "a", value: "stale", updated_at: "2026-11-12T00:00:02Z" },
      old: null,
    });

    expect(onRows).not.toHaveBeenCalled();
  });

  it("re-fetches after a reconnect so missed changes arrive", async () => {
    const { client, channels } = makeFakeRealtime();
    const seen: Row[][] = [];
    let current: Row[] = [
      { id: "a", value: "one", updated_at: "2026-11-12T00:00:01Z" },
    ];

    listenToRows<Row>({
      client: client as never,
      channelName: "rows",
      bindings: [postgresChanges<Row>("user_settings", () => null)],
      fetchRows: () => Promise.resolve(current),
      getKey: keyOf,
      getUpdatedAt: stampOf,
      onRows: (rows) => seen.push(rows),
    });
    settle(channels);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen.at(-1)?.[0].value).toBe("one");

    // The connection drops and comes back; meanwhile the row changed.
    current = [{ id: "a", value: "two", updated_at: "2026-11-12T00:00:09Z" }];
    settle(channels);
    await Promise.resolve();
    await Promise.resolve();

    expect(seen.at(-1)).toEqual(current);
  });

  it("receives broadcast events on a broadcast binding", async () => {
    const { client, channels } = makeFakeRealtime();
    const seen: Row[][] = [];

    listenToRows<Row>({
      client: client as never,
      channelName: "campaign:123",
      bindings: [
        {
          type: "broadcast",
          event: "row-changed",
          toChange: (message) => {
            const payload = message.payload as {
              record: Row;
            };
            return { kind: "upsert", row: payload.record };
          },
        },
      ],
      fetchRows: () => Promise.resolve([]),
      getKey: keyOf,
      getUpdatedAt: stampOf,
      onRows: (rows) => seen.push(rows),
    });
    settle(channels);
    await Promise.resolve();
    await Promise.resolve();

    for (const binding of channels[0].bindings) {
      if (binding.type === "broadcast") {
        binding.cb({
          event: "row-changed",
          payload: {
            record: {
              id: "a",
              value: "from-broadcast",
              updated_at: "2026-11-12T00:00:01Z",
            },
          },
        } as never);
      }
    }

    expect(seen.at(-1)).toEqual([
      {
        id: "a",
        value: "from-broadcast",
        updated_at: "2026-11-12T00:00:01Z",
      },
    ]);
  });

  it("surfaces channel errors to onError instead of stalling", async () => {
    const { client, channels } = makeFakeRealtime();
    const onRows = vi.fn();
    const onError = vi.fn();

    listenToRows<Row>({
      client: client as never,
      channelName: "rows",
      bindings: [postgresChanges<Row>("user_settings", () => null)],
      fetchRows: () => Promise.resolve([]),
      getKey: keyOf,
      onRows,
      onError,
    });

    const detail = new Error("join failed");
    for (const cb of channels[0].subscribeCbs) cb("CHANNEL_ERROR", detail);
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
    const reported = onError.mock.calls[0][0] as Error;
    expect(String(reported?.message ?? reported)).toContain("CHANNEL_ERROR");
    expect(onRows).not.toHaveBeenCalled();
  });

  it("surfaces timed-out and closed channels to onError", async () => {
    for (const status of ["TIMED_OUT", "CLOSED"] as const) {
      const { client, channels } = makeFakeRealtime();
      const onRows = vi.fn();
      const onError = vi.fn();

      listenToRows<Row>({
        client: client as never,
        channelName: "rows",
        bindings: [postgresChanges<Row>("user_settings", () => null)],
        fetchRows: () => Promise.resolve([]),
        getKey: keyOf,
        onRows,
        onError,
      });

      for (const cb of channels[0].subscribeCbs) cb(status);
      await Promise.resolve();

      expect(onError).toHaveBeenCalledTimes(1);
      const reported = onError.mock.calls[0][0] as Error;
      expect(String(reported?.message ?? reported)).toContain(status);
      expect(onRows).not.toHaveBeenCalled();
    }
  });

  it("unsubscribes with a plain function that closes the channel once", async () => {
    const { client, channels, removeChannel } = makeFakeRealtime();
    const onRows = vi.fn();

    const unsubscribe = listenToRows<Row>({
      client: client as never,
      channelName: "rows",
      bindings: [],
      fetchRows: () => Promise.resolve([]),
      getKey: keyOf,
      onRows,
    });

    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
    unsubscribe();

    expect(removeChannel).toHaveBeenCalledTimes(1);

    // Late subscribe callbacks after removal change nothing and throw nothing.
    for (const cb of channels[0].subscribeCbs) cb("SUBSCRIBED");
    await Promise.resolve();
    await Promise.resolve();
    expect(onRows).not.toHaveBeenCalled();
  });
});
