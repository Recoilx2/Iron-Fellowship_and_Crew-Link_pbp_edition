import type { SupabaseClient } from "@supabase/supabase-js";
import type { Unsubscribe } from "api-calls/helpers.type";

/**
 * The one shared listen helper every data area builds on (user story 39).
 * It opens a private channel, buffers incoming events, fetches the current
 * rows once subscribed, merges the two by primary key, and re-fetches after
 * every reconnect. It returns a plain unsubscribe function.
 *
 * Two binding kinds cover both live-update mechanisms: plain row streaming
 * for rows only their owner sees, and database broadcasts on private topics
 * for shared campaign data. Neither mechanism delivers an initial snapshot
 * or replays missed events, so the fetch-on-subscribe (and re-fetch on every
 * later subscribe) is what keeps subscribers current.
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

function isStale(
  incoming: string | number | null | undefined,
  existing: string | number | null | undefined
): boolean {
  if (incoming == null || existing == null) return false;
  if (typeof incoming === "number" && typeof existing === "number") {
    return incoming < existing;
  }
  return String(incoming) < String(existing);
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
    onRows([...rows.values()]);
  };

  const refresh = async () => {
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
      if (my === epoch && !removed) onError?.(error);
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
    void client.removeChannel(channel);
  };
}
