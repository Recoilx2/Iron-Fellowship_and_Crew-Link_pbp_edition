import type { SupabaseClient } from "@supabase/supabase-js";
import type { Unsubscribe } from "api-calls/helpers.type";

/**
 * The one shared listen helper every data area builds on (user story 39).
 * It opens a private channel, buffers incoming events, fetches the current
 * rows once subscribed, merges the two by primary key, and re-fetches after
 * every reconnect. It returns a plain unsubscribe function.
 *
 * Two binding kinds are supported: plain row streaming for rows only their
 * owner sees, and database broadcasts on private topics for shared campaign
 * data. Broadcast delivery is deferred per ADR 0002 (no production callers
 * yet): every current caller uses plain row streaming only. Neither
 * mechanism delivers an initial snapshot
 * or replays missed events, so the fetch-on-subscribe (and re-fetch on every
 * later subscribe) is what keeps subscribers current.
 *
 * Two more guards keep subscribers correct when the server stays silent:
 * rows are canonicalized before signing so logically-identical snapshots
 * (realtime and REST serialize the same row differently, e.g. `updated_at`
 * formatting) share one signature and never emit duplicates, and a
 * reconcile timer re-fetches on a modest interval so withheld or lost
 * events self-heal. The timer is silent on transient failure and stops on
 * unsubscribe.
 */

export type RowChange<T> =
  | { kind: "upsert"; row: T }
  | { kind: "remove"; key: string };

export interface PostgresChangePayload<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE" | "*";
  new: T | Record<string, never>;
  old: Partial<T> | null;
}

export interface PostgresChangesBinding<T> {
  type: "postgres_changes";
  table: string;
  schema?: string;
  filter?: string;
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  toChange: (payload: PostgresChangePayload<T>) => RowChange<T> | null;
}

export interface BroadcastBinding<T> {
  type: "broadcast";
  event: string;
  toChange: (message: {
    event: string;
    payload: unknown;
  }) => RowChange<T> | null;
}

export type RowBinding<T> = PostgresChangesBinding<T> | BroadcastBinding<T>;

/**
 * How often a settled listener re-fetches to heal events the server
 * withheld (rows the subscriber cannot SELECT never arrive) or dropped.
 * Ten seconds bounds the heal time well inside the live tests' `waitFor`
 * windows while keeping each active listener to six small SELECTs a minute.
 */
export const RECONCILE_INTERVAL_MS = 10_000;

export interface ListenToRowsParams<T> {
  client: SupabaseClient;
  channelName: string;
  bindings: RowBinding<T>[];
  fetchRows: () => Promise<T[]>;
  getKey: (row: T) => string;
  getUpdatedAt?: (row: T) => string | number | null | undefined;
  onRows: (rows: T[]) => void;
  onError?: (error: unknown) => void;
}

function toEpochMillis(
  value: string | number | null | undefined
): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // Only ISO-date-like strings are timestamps; anything else (ids, free
  // text) passes through untouched so the signature never conflates them.
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isStale(
  incoming: string | number | null | undefined,
  existing: string | number | null | undefined
): boolean {
  const incomingMs = toEpochMillis(incoming);
  const existingMs = toEpochMillis(existing);
  // Unparseable or missing stamps carry no ordering info: keep the event
  // rather than risk dropping a fresh row on a formatting skew.
  if (incomingMs == null || existingMs == null) return false;
  return incomingMs < existingMs;
}

export function listenToRows<T>(params: ListenToRowsParams<T>): Unsubscribe {
  const {
    client,
    channelName,
    bindings,
    fetchRows,
    getKey,
    getUpdatedAt,
    onRows,
    onError,
  } = params;

  // Channels are always private: database broadcasts only reach private
  // topics, so a public channel would silently receive nothing.
  const channel = client.channel(channelName, { config: { private: true } });

  let rows = new Map<string, T>();
  let pending: Array<RowChange<T>> = [];
  let settled = false;
  let epoch = 0;
  let removed = false;
  let refreshing = false;
  let lastEmittedSignature: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const canonicalJson = (row: T): string =>
    JSON.stringify(row, (_key, value: unknown) =>
      typeof value === "string" ? (toEpochMillis(value) ?? value) : value
    );

  const signature = (): string => {
    // Sorted by key so merge order (realtime-first vs snapshot-first) never
    // changes the signature; timestamps normalized to epoch millis so
    // realtime and REST serializations of the same row sign identically.
    const entries = [...rows.keys()]
      .sort()
      .map(
        (key) =>
          [
            key,
            getUpdatedAt
              ? toEpochMillis(getUpdatedAt(rows.get(key) as T))
              : null,
            canonicalJson(rows.get(key) as T),
          ] as const
      );
    return JSON.stringify(entries);
  };

  const applyChange = (change: RowChange<T>): boolean => {
    if (change.kind === "remove") {
      return rows.delete(change.key);
    }
    const key = getKey(change.row);
    if (getUpdatedAt) {
      const current = rows.get(key);
      if (
        current !== undefined &&
        isStale(getUpdatedAt(change.row), getUpdatedAt(current))
      ) {
        return false;
      }
    }
    rows.set(key, change.row);
    return true;
  };

  const emit = () => {
    // Snapshots carry plain row data, so identical content serializes
    // identically — after canonicalization (timestamps to epoch millis,
    // keys sorted). A refresh that changed nothing (double SUBSCRIBED, a
    // reconnect with no missed events, a realtime echo of the REST row)
    // must not re-notify: subscribers diff against these emissions, and a
    // duplicate snapshot looks like every row arriving twice.
    const next = signature();
    if (next === lastEmittedSignature) return;
    lastEmittedSignature = next;
    onRows([...rows.values()]);
  };

  const refresh = async (options?: { silent?: boolean }) => {
    // A fetch is already running (double SUBSCRIBED, reconnect storm): the
    // in-flight fetch already reads the latest rows, and events that land
    // meanwhile buffer into `pending` and merge on completion. A second fetch
    // would only re-emit the same snapshot.
    if (refreshing) return;
    refreshing = true;
    try {
      const my = ++epoch;
      settled = false;
      try {
        const snapshot = await fetchRows();
        if (my !== epoch || removed) return;
        rows = new Map(snapshot.map((row) => [getKey(row), row]));
        const queued = pending;
        pending = [];
        for (const change of queued) applyChange(change);
        settled = true;
        emit();
      } catch (error) {
        // Background reconcile ticks stay silent on transient failure: the
        // next tick retries, and surfacing every blip as onError would toast
        // the user for a poll they never asked for.
        if (!options?.silent && my === epoch && !removed) onError?.(error);
      }
    } finally {
      refreshing = false;
    }
  };

  const handleChange = (change: RowChange<T> | null) => {
    if (!change || removed) return;
    if (settled) {
      if (applyChange(change)) emit();
    } else {
      pending.push(change);
    }
  };

  for (const binding of bindings) {
    if (binding.type === "postgres_changes") {
      channel.on(
        "postgres_changes",
        {
          event: binding.event ?? "*",
          schema: binding.schema ?? "public",
          table: binding.table,
          ...(binding.filter === undefined
            ? {}
            : { filter: binding.filter }),
        },
        (payload) =>
          handleChange(
            binding.toChange(payload as unknown as PostgresChangePayload<T>)
          )
      );
    } else {
      channel.on("broadcast", { event: binding.event }, (payload) =>
        handleChange(
          binding.toChange(
            payload as unknown as { event: string; payload: unknown }
          )
        )
      );
    }
  }

  channel.subscribe((status, subscribeError) => {
    if (removed) return;
    // Every (re-)subscribe re-fetches: missed events are never replayed, so
    // the fresh select is what catches the subscriber up after a reconnect.
    if (status === "SUBSCRIBED") {
      void refresh();
      // The reconcile timer starts with the first live subscription, not at
      // construction: polling REST before the channel is live serves
      // nothing. Guarded exactly like refresh (epoch/removed/refreshing)
      // and cleared below.
      if (timer === undefined) {
        timer = setInterval(() => {
          if (!removed) void refresh({ silent: true });
        }, RECONCILE_INTERVAL_MS);
      }
      return;
    }
    // SUBSCRIBED is the only success signal. Anything else means the channel
    // will never deliver rows, so surface it: without this the subscriber
    // stalls with no fetch and no error, and every failure looks identical.
    if (
      status === "CHANNEL_ERROR" ||
      status === "TIMED_OUT" ||
      status === "CLOSED"
    ) {
      const detail =
        subscribeError instanceof Error
          ? `: ${subscribeError.message}`
          : subscribeError !== undefined && subscribeError !== null
            ? `: ${String(subscribeError)}`
            : "";
      onError?.(
        new Error(`realtime subscribe ${status}${detail}`, {
          cause: subscribeError,
        })
      );
    }
  });

  return () => {
    if (removed) return;
    removed = true;
    epoch += 1;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    void client.removeChannel(channel);
  };
}
