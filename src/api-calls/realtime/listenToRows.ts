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
 * data. A broadcast binding can override the topic it joins (multiple
 * bindings may name different topics, e.g. one per campaign or channel);
 * every topic still gets its own per-subscription suffix. Neither mechanism
 * delivers an initial snapshot
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
  | { kind: "remove"; key: string }
  | { kind: "refresh" };

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

export interface BroadcastMessage {
  event: string;
  payload: unknown;
}

export interface BroadcastBinding<T> {
  type: "broadcast";
  event: string;
  /**
   * Canonical topic to join (e.g. `campaign-shared:<id>:notes`). The helper
   * appends its `:sub-<salt>-<n>` suffix, so presence/auth still match the
   * membership-checked realtime policies. Without an override the binding
   * joins `channelName`, as before.
   */
  topic?: string;
  /**
   * A best-effort topic (the `campaign-gm:*` family for players, for
   * instance): a failed join is not surfaced through onError, but a
   * successful one still refreshes and delivers rows.
   */
  optional?: boolean;
  toChange: (message: BroadcastMessage) => RowChange<T> | null;
}

export type RowBinding<T> = PostgresChangesBinding<T> | BroadcastBinding<T>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a `realtime.broadcast_changes()` message (or the key-only DELETE and
 * `refresh` signals published by the shared-topic triggers) into the same
 * RowChange a postgres_changes binding produces. `project` keeps the row
 * identical to the columns `fetchRows` selects; `getKey` handles composite
 * keys. Messages for other tables are ignored: a campaign topic can carry
 * several families, and each listener only owns one of them.
 */
export function broadcastRowChange<T>(
  message: BroadcastMessage,
  params: {
    getKey: (row: T) => string | null;
    table?: string;
    project?: (row: Record<string, unknown>) => T;
  }
): RowChange<T> | null {
  const payload = isRecord(message.payload) ? message.payload : null;
  if (!payload) return null;
  if (message.event === "refresh" || payload.kind === "refresh") {
    return { kind: "refresh" };
  }
  if (
    params.table !== undefined &&
    payload.table !== undefined &&
    payload.table !== params.table
  ) {
    return null;
  }
  const operation =
    typeof payload.operation === "string"
      ? payload.operation.toUpperCase()
      : message.event.toUpperCase();
  const project = params.project ?? ((row: Record<string, unknown>) => row as T);
  if (operation === "DELETE") {
    const old = isRecord(payload.old_record)
      ? payload.old_record
      : isRecord(payload.record)
        ? payload.record
        : null;
    const key = old
      ? params.getKey(project(old))
      : typeof payload.id === "string"
        ? payload.id
        : null;
    return key !== null ? { kind: "remove", key } : null;
  }
  if (!isRecord(payload.record)) return null;
  const row = project(payload.record);
  const key = params.getKey(row);
  return key !== null ? { kind: "upsert", row } : null;
}

/** A broadcast binding that streams full rows, key-only deletes and refresh. */
export function broadcastRowsBinding<T>(params: {
  topic?: string;
  optional?: boolean;
  table?: string;
  getKey: (row: T) => string | null;
  project?: (row: Record<string, unknown>) => T;
  /** Replaces the default mapper (e.g. to drop rows the reader may not see). */
  toChange?: (message: BroadcastMessage) => RowChange<T> | null;
}): BroadcastBinding<T> {
  return {
    type: "broadcast",
    event: "*",
    topic: params.topic,
    optional: params.optional,
    toChange:
      params.toChange ?? ((message) => broadcastRowChange(message, params)),
  };
}

/** A refresh-only binding for large content tables (no rows on the wire). */
export function broadcastRefreshBinding(params: {
  topic: string;
  optional?: boolean;
}): BroadcastBinding<never> {
  return {
    type: "broadcast",
    event: "refresh",
    topic: params.topic,
    optional: params.optional,
    toChange: () => ({ kind: "refresh" }),
  };
}

/**
 * How often a settled listener re-fetches to heal events the server
 * withheld (rows the subscriber cannot SELECT never arrive) or dropped.
 * Ten seconds bounds the heal time well inside the live tests' `waitFor`
 * windows while keeping each active listener to six small SELECTs a minute.
 */
export const RECONCILE_INTERVAL_MS = 10_000;

// Every subscription joins its own realtime topic (issue #116):
// supabase-js channel() creates-OR-REUSES by topic, so two listenToRows
// calls with the same channelName (campaign screen Active + Completed
// tracks on character-tracks:<id>; character sheet + campaign screen on
// one character) would otherwise share one channel, and realtime-js throws
// on the second postgres_changes .on() after subscribe(). The suffix keeps
// the requested channel name as a prefix, so the realtime-auth LIKE
// allowlist (character%, campaign:%, world%, ...) still matches and no
// auth change is needed. The counter is module-scoped, so topics are
// unique per runtime; the salt keeps them unique across module reloads.
let nextSubscriptionId = 0;
const subscriptionSalt = Math.random().toString(36).slice(2, 10);

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
  // topics, so a public channel would silently receive nothing. Each
  // canonical topic (the requested channel name, or a broadcast binding's
  // override) gets its own subscription-unique topic: sharing one topic
  // across subscriptions throws once the channel is subscribed.
  interface OpenChannel {
    canonical: string;
    topic: string;
    channel: ReturnType<SupabaseClient["channel"]>;
    optional: boolean;
  }
  const openChannels = new Map<string, OpenChannel>();

  const channelFor = (canonical: string, optional: boolean): OpenChannel => {
    const existing = openChannels.get(canonical);
    if (existing) {
      // One failed optional subscription must not surface an error when the
      // same topic is also used by a required binding.
      existing.optional = existing.optional && optional;
      return existing;
    }
    const topic = `${canonical}:sub-${subscriptionSalt}-${++nextSubscriptionId}`;
    const open: OpenChannel = {
      canonical,
      topic,
      channel: client.channel(topic, { config: { private: true } }),
      optional,
    };
    openChannels.set(canonical, open);
    return open;
  };

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

  const applyChange = (
    change: Exclude<RowChange<T>, { kind: "refresh" }>
  ): boolean => {
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
    let refreshAgain = false;
    try {
      const my = ++epoch;
      settled = false;
      try {
        const snapshot = await fetchRows();
        if (my !== epoch || removed) return;
        rows = new Map(snapshot.map((row) => [getKey(row), row]));
        const queued = pending;
        pending = [];
        for (const change of queued) {
          // A refresh queued before the snapshot landed (a related table
          // bumped while the first fetch was in flight): the snapshot may
          // predate the bump, so follow it with a fresh fetch instead of
          // settling on possibly stale rows.
          if (change.kind === "refresh") refreshAgain = true;
          else applyChange(change);
        }
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
    if (refreshAgain && !removed) void refresh({ silent: true });
  };

  const handleChange = (change: RowChange<T> | null) => {
    if (!change || removed) return;
    if (change.kind === "refresh") {
      // A related table changed (a channel bump for the roster listener,
      // whose own table carries no live stream): re-read what this
      // listener shows. Silent like the reconcile tick: a blip here heals
      // on the next tick, and the reader never asked for this refresh.
      if (settled) void refresh({ silent: true });
      // Before the first snapshot there is nothing to re-read yet: queue
      // the signal so the landing fetch is followed by a fresh one.
      else pending.push(change);
      return;
    }
    if (settled) {
      if (applyChange(change)) emit();
    } else {
      pending.push(change);
    }
  };

  // Bindings are registered before subscribe(): realtime-js throws when a
  // postgres_changes .on() is added to an already-subscribed channel.
  const bindingsByChannel = new Map<OpenChannel, RowBinding<T>[]>();
  const addBinding = (open: OpenChannel, binding: RowBinding<T>) => {
    const list = bindingsByChannel.get(open) ?? [];
    list.push(binding);
    bindingsByChannel.set(open, list);
  };
  for (const binding of bindings) {
    if (binding.type === "postgres_changes") {
      // Owner-only listeners keep exactly one channel and one binding set.
      addBinding(channelFor(channelName, false), binding);
    } else {
      addBinding(
        channelFor(binding.topic ?? channelName, binding.optional ?? false),
        binding
      );
    }
  }
  if (bindingsByChannel.size === 0) {
    // With no bindings the fetch-on-subscribe and reconcile backstop are
    // still useful; open the primary channel so both run.
    bindingsByChannel.set(channelFor(channelName, false), []);
  }

  const startReconcile = () => {
    if (timer === undefined) {
      timer = setInterval(() => {
        if (!removed) void refresh({ silent: true });
      }, RECONCILE_INTERVAL_MS);
    }
  };

  for (const [open, channelBindings] of bindingsByChannel) {
    const { channel } = open;
    for (const binding of channelBindings) {
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
          handleChange(binding.toChange(payload as unknown as BroadcastMessage))
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
        // nothing. It is cleared on unsubscribe.
        startReconcile();
        return;
      }
      // SUBSCRIBED is the only success signal. Anything else means the channel
      // will never deliver rows, so surface it: without this the subscriber
      // stalls with no fetch and no error, and every failure looks identical.
      // A best-effort topic (campaign-gm for a player, or a transient GM
      // failure) stays silent, but still fetches once and keeps reconciling:
      // row visibility comes from RLS on the REST read, so a GM whose join
      // failed must not be left with an empty list forever.
      const failed =
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED";
      if (failed && open.optional) {
        void refresh();
        startReconcile();
        return;
      }
      if (failed) {
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
  }

  return () => {
    if (removed) return;
    removed = true;
    epoch += 1;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    for (const open of openChannels.values()) {
      void client.removeChannel(open.channel);
    }
  };
}

/**
 * Some topics need a small lookup first (a world's campaigns, a
 * conversation's campaign, a campaign's channel ids). This opens the
 * listener once the lookup resolves and returns a valid unsubscribe
 * immediately: a listener torn down before resolution never opens a socket.
 */
export function listenToRowsDeferred<T>(
  build: () => Promise<ListenToRowsParams<T> | null>,
  onError?: (error: unknown) => void
): Unsubscribe {
  let stop: Unsubscribe | undefined;
  let removed = false;
  void build()
    .then((params) => {
      if (removed || !params) return;
      stop = listenToRows(params);
    })
    .catch((error: unknown) => {
      if (!removed) onError?.(error);
    });
  return () => {
    removed = true;
    stop?.();
  };
}
