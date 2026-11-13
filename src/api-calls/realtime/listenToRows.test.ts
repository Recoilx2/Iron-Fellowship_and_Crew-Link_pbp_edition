import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listenToRows,
  RECONCILE_INTERVAL_MS,
} from "api-calls/realtime/listenToRows";
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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
    // One topic per subscription (issue #116): the topic keeps the
    // requested channel name as a prefix (realtime-auth LIKE allowlist)
    // plus a per-subscription suffix, so it is never byte-identical.
    expect(channels[0].name.startsWith("user-settings:abc")).toBe(true);
    expect(channels[0].name.length).toBeGreaterThan("user-settings:abc".length);
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

  it("coalesces a second subscribe while the first fetch is still in flight", async () => {
    const { client, channels } = makeFakeRealtime();
    const onRows = vi.fn();
    const snapshot: Row[] = [
      { id: "a", value: "one", updated_at: "2026-11-12T00:00:01Z" },
    ];
    let resolveFetch!: (rows: Row[]) => void;
    const fetchRows = vi.fn(
      () =>
        new Promise<Row[]>((resolve) => {
          resolveFetch = resolve;
        })
    );

    listenToRows<Row>({
      client: client as never,
      channelName: "rows",
      bindings: [postgresChanges<Row>("user_settings", () => null)],
      fetchRows,
      getKey: keyOf,
      getUpdatedAt: stampOf,
      onRows,
    });

    // Double SUBSCRIBED (the round-2 flake): the second subscribe must not
    // stack a second fetch that re-emits the same snapshot.
    settle(channels);
    settle(channels);
    expect(fetchRows).toHaveBeenCalledTimes(1);

    resolveFetch(snapshot);
    await flush();
    expect(onRows).toHaveBeenCalledTimes(1);
    expect(onRows).toHaveBeenCalledWith(snapshot);
  });

  it("does not re-emit when a later refresh finds identical rows", async () => {
    const { client, channels } = makeFakeRealtime();
    const onRows = vi.fn();
    const snapshot: Row[] = [
      { id: "a", value: "one", updated_at: "2026-11-12T00:00:01Z" },
    ];

    listenToRows<Row>({
      client: client as never,
      channelName: "rows",
      bindings: [postgresChanges<Row>("user_settings", () => null)],
      fetchRows: () => Promise.resolve(snapshot),
      getKey: keyOf,
      getUpdatedAt: stampOf,
      onRows,
    });

    settle(channels);
    await flush();
    expect(onRows).toHaveBeenCalledTimes(1);

    // A later SUBSCRIBED (reconnect) with nothing changed stays silent.
    settle(channels);
    await flush();
    expect(onRows).toHaveBeenCalledTimes(1);
  });

  it("suppresses live changes that leave the rows identical", async () => {
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
      fetchRows: () => Promise.resolve([]),
      getKey: keyOf,
      getUpdatedAt: stampOf,
      onRows,
    });
    settle(channels);
    await flush();
    expect(onRows).toHaveBeenCalledTimes(1);

    emitPostgres(channels, {
      new: { id: "a", value: "one", updated_at: "2026-11-12T00:00:01Z" },
      old: null,
    });
    expect(onRows).toHaveBeenCalledTimes(2);

    // The same row arriving again changes nothing, so nobody is notified.
    emitPostgres(channels, {
      new: { id: "a", value: "one", updated_at: "2026-11-12T00:00:01Z" },
      old: null,
    });
    expect(onRows).toHaveBeenCalledTimes(2);
  });

  it("suppresses a projected seed-upsert echo (issue #97)", async () => {
    // The live ordering test seeds user_settings before subscribing; the
    // seed's WAL echo lands after the initial fetch as the full 5-column
    // row while REST selected 3 (user_id, verbose_roll_results,
    // updated_at). The caller projects the event row to the REST columns,
    // so the echo signs identically and the helper stays silent. This pin
    // passes against the current helper and proves that contract: only the
    // genuinely newer row re-emits.
    interface SettingsRow {
      user_id: string;
      verbose_roll_results: boolean;
      updated_at: string;
    }

    const { client, channels } = makeFakeRealtime();
    const onRows = vi.fn();

    listenToRows<SettingsRow>({
      client: client as never,
      channelName: "user-settings:u1",
      bindings: [
        {
          type: "postgres_changes",
          table: "user_settings",
          toChange: (payload) => {
            const row = payload.new as Partial<SettingsRow>;
            if (row && typeof row.user_id === "string") {
              return {
                kind: "upsert",
                row: {
                  user_id: row.user_id,
                  verbose_roll_results: row.verbose_roll_results as boolean,
                  updated_at: row.updated_at as string,
                },
              };
            }
            return null;
          },
        },
      ],
      fetchRows: () =>
        Promise.resolve([
          {
            user_id: "u1",
            verbose_roll_results: false,
            updated_at: "2026-11-12T00:00:01+00:00",
          },
        ]),
      getKey: (row) => row.user_id,
      getUpdatedAt: (row) => row.updated_at,
      onRows,
    });
    settle(channels);
    await flush();
    expect(onRows).toHaveBeenCalledTimes(1);

    // Seed-upsert WAL echo: the full row (extra columns included) lands
    // after subscribe; projected to the REST columns it changes nothing.
    emitPostgres(channels, {
      new: {
        user_id: "u1",
        verbose_roll_results: false,
        pinned_oracle_sections: {},
        created_at: "2026-11-12T00:00:01.123456+00:00",
        updated_at: "2026-11-12T00:00:01Z",
      },
      old: null,
    });
    expect(onRows).toHaveBeenCalledTimes(1);

    // A genuinely newer row still emits.
    emitPostgres(channels, {
      new: {
        user_id: "u1",
        verbose_roll_results: true,
        pinned_oracle_sections: {},
        created_at: "2026-11-12T00:00:01.123456+00:00",
        updated_at: "2026-11-12T00:00:02Z",
      },
      old: null,
    });
    expect(onRows).toHaveBeenCalledTimes(2);
    expect(onRows).toHaveBeenLastCalledWith([
      {
        user_id: "u1",
        verbose_roll_results: true,
        updated_at: "2026-11-12T00:00:02Z",
      },
    ]);
  });

  it("surfaces a failed fetch to onError instead of stalling", async () => {
    const { client, channels } = makeFakeRealtime();
    const onRows = vi.fn();
    const onError = vi.fn();
    const failure = new Error("select failed");

    listenToRows<Row>({
      client: client as never,
      channelName: "rows",
      bindings: [postgresChanges<Row>("user_settings", () => null)],
      fetchRows: () => Promise.reject(failure),
      getKey: keyOf,
      getUpdatedAt: stampOf,
      onRows,
      onError,
    });

    settle(channels);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onRows).not.toHaveBeenCalled();
  });

  describe("canonical signature and reconcile (issue #92)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not re-emit when realtime and REST rows differ only by timestamp format", async () => {
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
            {
              id: "a",
              value: "one",
              updated_at: "2026-11-12T00:00:01+00:00",
            },
          ]),
        getKey: keyOf,
        getUpdatedAt: stampOf,
        onRows,
      });
      settle(channels);
      await vi.advanceTimersByTimeAsync(0);
      expect(onRows).toHaveBeenCalledTimes(1);

      // Same instant, realtime's `Z` serialization vs REST's `+00:00`.
      emitPostgres(channels, {
        new: {
          id: "a",
          value: "one",
          updated_at: "2026-11-12T00:00:01Z",
        },
        old: null,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(onRows).toHaveBeenCalledTimes(1);

      // A genuinely newer row still emits.
      emitPostgres(channels, {
        new: { id: "a", value: "two", updated_at: "2026-11-12T00:00:02Z" },
        old: null,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(onRows).toHaveBeenCalledTimes(2);
      expect(onRows).toHaveBeenLastCalledWith([
        { id: "a", value: "two", updated_at: "2026-11-12T00:00:02Z" },
      ]);
    });

    it("applies a newer numeric timestamp that string comparison would drop as stale", async () => {
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
        fetchRows: () =>
          Promise.resolve([
            { id: "a", value: "old", updated_at: "2026-11-12T00:00:02Z" },
          ]),
        getKey: keyOf,
        // Realtime may carry epoch millis while REST carries an ISO string.
        getUpdatedAt: (row) =>
          (row as unknown as { updated_at: string | number }).updated_at,
        onRows: (rows) => seen.push(rows as Row[]),
      });
      settle(channels);
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toHaveLength(1);

      // String comparison would read "1794…" < "2026…" and drop this
      // strictly newer row; numeric comparison must keep it.
      const newerAt = Date.parse("2026-11-12T00:00:09Z");
      emitPostgres(channels, {
        new: { id: "a", value: "new", updated_at: newerAt },
        old: null,
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(seen).toHaveLength(2);
      expect(seen[1]).toEqual([{ id: "a", value: "new", updated_at: newerAt }]);
    });

    it("re-fetches on an interval so a withheld event self-heals", async () => {
      const { client, channels } = makeFakeRealtime();
      const seen: Row[][] = [];
      let current: Row[] = [];

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
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([[]]);

      // The server withholds the INSERT (RLS-drop): no realtime event
      // arrives, but the row is visible to REST.
      current = [
        { id: "a", value: "healed", updated_at: "2026-11-12T00:00:03Z" },
      ];
      await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);

      expect(seen.at(-1)).toEqual(current);
    });

    it("stays silent when a reconcile re-fetch fails transiently", async () => {
      const { client, channels } = makeFakeRealtime();
      const seen: Row[][] = [];
      const onError = vi.fn();
      let failNext = false;
      let current: Row[] = [];

      listenToRows<Row>({
        client: client as never,
        channelName: "rows",
        bindings: [postgresChanges<Row>("user_settings", () => null)],
        fetchRows: () =>
          failNext
            ? Promise.reject(new Error("transient"))
            : Promise.resolve(current),
        getKey: keyOf,
        getUpdatedAt: stampOf,
        onRows: (rows) => seen.push(rows),
        onError,
      });
      settle(channels);
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([[]]);

      failNext = true;
      await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);
      expect(onError).not.toHaveBeenCalled();
      expect(seen).toEqual([[]]);

      // The listener keeps working after the transient failure.
      failNext = false;
      current = [
        { id: "a", value: "recovered", updated_at: "2026-11-12T00:00:04Z" },
      ];
      await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);
      expect(onError).not.toHaveBeenCalled();
      expect(seen.at(-1)).toEqual(current);
    });

    it("clears the reconcile timer on unsubscribe", async () => {
      const { client, channels } = makeFakeRealtime();
      const fetchRows = vi.fn(() => Promise.resolve([]));

      const unsubscribe = listenToRows<Row>({
        client: client as never,
        channelName: "rows",
        bindings: [],
        fetchRows,
        getKey: keyOf,
        onRows: () => {},
      });
      settle(channels);
      await vi.advanceTimersByTimeAsync(0);
      const callsWhileSubscribed = fetchRows.mock.calls.length;
      expect(callsWhileSubscribed).toBeGreaterThan(0);

      unsubscribe();
      await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS * 3);
      expect(fetchRows.mock.calls.length).toBe(callsWhileSubscribed);
    });
  });

  describe("concurrent subscriptions sharing one channel name (issue #116)", () => {
    // Seam under test: two listenToRows calls with the same channelName,
    // active at the same time (campaign screen Active + Completed tracks on
    // character-tracks:<id>; character sheet + campaign screen on one
    // character). supabase-js channel() creates-OR-REUSES by topic, so a
    // shared topic hands the second listenToRows an already-subscribed
    // channel and realtime-js throws on the second .on().
    //
    // The fake below reproduces exactly that contract: channels are keyed
    // by topic, subscribe() marks the channel joined synchronously, and a
    // postgres_changes .on() after subscribe throws.
    type ReuseStatusCallback = (status: string, err?: unknown) => void;
    type ReuseEventCallback = (payload: unknown) => void;

    interface ReuseChannel {
      topic: string;
      joinedOnce: boolean;
      postgresCbs: ReuseEventCallback[];
      subscribeCbs: ReuseStatusCallback[];
      on(
        type: string,
        filter: unknown,
        cb: ReuseEventCallback
      ): ReuseChannel;
      subscribe(cb: ReuseStatusCallback): ReuseChannel;
    }

    function makeTopicReusingClient() {
      const channels = new Map<string, ReuseChannel>();
      const removeChannel = vi.fn((channel: ReuseChannel) => {
        channels.delete(channel.topic);
        return Promise.resolve("ok");
      });
      const client = {
        channel(topic: string): ReuseChannel {
          const existing = channels.get(topic);
          if (existing) return existing;
          const record = {} as ReuseChannel;
          record.topic = topic;
          record.joinedOnce = false;
          record.postgresCbs = [];
          record.subscribeCbs = [];
          record.on = (
            type: string,
            _filter: unknown,
            cb: ReuseEventCallback
          ) => {
            if (type === "postgres_changes" && record.joinedOnce) {
              throw new Error(
                `cannot add postgres_changes callbacks for realtime:${topic} after subscribe()`
              );
            }
            record.postgresCbs.push(cb);
            return record;
          };
          record.subscribe = (cb: ReuseStatusCallback) => {
            record.joinedOnce = true;
            record.subscribeCbs.push(cb);
            return record;
          };
          channels.set(topic, record);
          return record;
        },
        removeChannel,
      };
      return { client, channels, removeChannel };
    }

    const activeRow: Row = {
      id: "track-active",
      value: "vow",
      updated_at: "2026-11-12T00:00:01Z",
    };
    const completedRow: Row = {
      id: "track-done",
      value: "vow",
      updated_at: "2026-11-12T00:00:02Z",
    };

    function subscribeBoth(client: unknown) {
      const activeSeen: Row[][] = [];
      const completedSeen: Row[][] = [];
      const binding = () =>
        postgresChanges<Row>("character_tracks", (payload) =>
          payload.new?.id ? { kind: "upsert", row: payload.new } : null
        );
      let unActive!: () => void;
      let unCompleted!: () => void;
      expect(() => {
        unActive = listenToRows<Row>({
          client: client as never,
          channelName: "character-tracks:char-1",
          bindings: [binding()],
          fetchRows: () => Promise.resolve([activeRow]),
          getKey: keyOf,
          getUpdatedAt: stampOf,
          onRows: (rows) => activeSeen.push(rows),
        });
        unCompleted = listenToRows<Row>({
          client: client as never,
          channelName: "character-tracks:char-1",
          bindings: [binding()],
          fetchRows: () => Promise.resolve([completedRow]),
          getKey: keyOf,
          getUpdatedAt: stampOf,
          onRows: (rows) => completedSeen.push(rows),
        });
      }).not.toThrow();
      return { unActive, unCompleted, activeSeen, completedSeen };
    }

    function settleAll(channels: Map<string, ReuseChannel>) {
      for (const channel of channels.values()) {
        for (const cb of channel.subscribeCbs) cb("SUBSCRIBED");
      }
    }

    it("two concurrent subscriptions with the same channelName both receive rows and neither throws", async () => {
      const { client, channels } = makeTopicReusingClient();
      const { unActive, unCompleted, activeSeen, completedSeen } =
        subscribeBoth(client);

      // One realtime topic per subscription: sharing a topic is what made
      // the second .on() throw.
      expect(channels.size).toBe(2);

      settleAll(channels);
      await flush();
      await flush();

      expect(activeSeen).toEqual([[activeRow]]);
      expect(completedSeen).toEqual([[completedRow]]);

      unActive();
      unCompleted();
    });

    it("keeps every subscription topic inside the realtime allowlist family", async () => {
      const { client, channels } = makeTopicReusingClient();
      const { unActive, unCompleted } = subscribeBoth(client);

      // realtime-auth matches topic prefixes with LIKE (character%,
      // campaign:%, world%, ...): every topic must still start with the
      // requested channel name, so no auth change is needed.
      expect(channels.size).toBeGreaterThan(0);
      for (const topic of channels.keys()) {
        expect(topic.startsWith("character-tracks:char-1")).toBe(true);
      }

      unActive();
      unCompleted();
    });

    it("unsubscribing one listener leaves the other working", async () => {
      const { client, channels, removeChannel } = makeTopicReusingClient();
      const { unActive, activeSeen, completedSeen } = subscribeBoth(client);

      settleAll(channels);
      await flush();
      await flush();
      expect(activeSeen).toEqual([[activeRow]]);
      expect(completedSeen).toEqual([[completedRow]]);

      unActive();
      expect(removeChannel).toHaveBeenCalledTimes(1);

      // A live change lands on the surviving subscription only.
      const survivor = [...channels.values()][0];
      expect(channels.size).toBe(1);
      const fresh: Row = {
        id: "track-done",
        value: "vow-advanced",
        updated_at: "2026-11-12T00:00:09Z",
      };
      for (const cb of survivor.postgresCbs) cb({ new: fresh, old: null });
      expect(completedSeen.at(-1)).toEqual([fresh]);
      expect(activeSeen).toEqual([[activeRow]]);
    });
  });
});
