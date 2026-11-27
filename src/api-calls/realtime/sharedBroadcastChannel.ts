import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One realtime channel per canonical broadcast topic per client (spec #205).
 *
 * Database triggers publish to the exact canonical topic —
 * `campaign-shared:<id>:<family>`, `campaign-gm:<id>:<family>` and
 * `channel-shared:<id>` — with no canonical-to-suffixed fan-out, so a
 * listener must join that exact name. supabase-js `channel()` creates-or-
 * reuses by topic, and callers cannot add `.on()` handlers after subscribe,
 * so separate listeners for the same topic share ONE channel here. A single
 * wildcard broadcast handler fans messages out to every subscriber, and
 * subscribers are ref-counted: the channel is removed when the last one
 * leaves.
 *
 * A failed join (first-mount auth/socket races show up as TIMED_OUT) heals
 * itself with a bounded exponential retry on the record, so listeners that
 * attach later do not inherit a dead channel. Retry waits for removeChannel
 * before creating the replacement, because realtime-js keeps returning the
 * same object by topic until teardown completes. Postgres Changes keep their
 * own per-subscription suffixed topics (issue #116).
 */

export interface BroadcastMessage {
  event: string;
  payload: unknown;
}

export interface BroadcastSubscriber {
  /** A denied join is swallowed for best-effort topics (campaign-gm). */
  optional: boolean;
  onMessage: (message: BroadcastMessage) => void;
  onStatus: (status: string, error?: unknown) => void;
}

interface RegisteredSubscriber {
  subscriber: BroadcastSubscriber;
  /** Each subscriber receives the first failure of its lifetime only. */
  notifiedFailure: boolean;
}

interface SharedBroadcastChannel {
  topic: string;
  channel: ReturnType<SupabaseClient["channel"]>;
  subscribers: Set<RegisteredSubscriber>;
  status: string | null;
  error: unknown;
  /** Incremented on every replacement channel; stale callbacks are ignored. */
  generation: number;
  successAnnounced: boolean;
  failureAnnounced: boolean;
  attempts: number;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  retryInFlight: boolean;
  disposed: boolean;
}

const channelsByClient = new WeakMap<
  SupabaseClient,
  Map<string, SharedBroadcastChannel>
>();

const FAILED_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);
const MAX_RETRIES = 5;
const BASE_RETRY_MS = 1000;
const JITTER_MS = 200;

function announce(
  record: SharedBroadcastChannel,
  status: string,
  error?: unknown
): void {
  for (const entry of [...record.subscribers]) {
    if (status !== "SUBSCRIBED" && entry.notifiedFailure) continue;
    if (status !== "SUBSCRIBED") entry.notifiedFailure = true;
    entry.subscriber.onStatus(status, error);
  }
}

function cancelRetry(record: SharedBroadcastChannel): void {
  if (record.retryTimer !== undefined) {
    clearTimeout(record.retryTimer);
    record.retryTimer = undefined;
  }
  record.retryInFlight = false;
}

function ensureRetry(
  client: SupabaseClient,
  record: SharedBroadcastChannel
): void {
  if (
    record.disposed ||
    record.retryTimer !== undefined ||
    record.retryInFlight ||
    record.attempts >= MAX_RETRIES ||
    record.status === "SUBSCRIBED" ||
    // A replacement channel is pending: wait for its status instead of
    // stacking another retry on top of it.
    record.status === null ||
    ![...record.subscribers].some((entry) => !entry.subscriber.optional)
  ) {
    return;
  }
  const delay =
    BASE_RETRY_MS * 2 ** record.attempts + Math.floor(Math.random() * JITTER_MS);
  record.retryTimer = setTimeout(() => {
    record.retryTimer = undefined;
    void retry(client, record);
  }, delay);
}

async function retry(
  client: SupabaseClient,
  record: SharedBroadcastChannel
): Promise<void> {
  if (
    record.disposed ||
    record.retryInFlight ||
    record.status === "SUBSCRIBED" ||
    record.attempts >= MAX_RETRIES
  ) {
    return;
  }
  record.retryInFlight = true;
  const oldChannel = record.channel;
  try {
    // supabase-js reuses channels by topic until teardown resolves; adding
    // handlers to the "new" object before then would be a silent no-op.
    await client.removeChannel(oldChannel);
    if (record.disposed) return;
    const fresh = client.channel(record.topic, { config: { private: true } });
    if (fresh === oldChannel) {
      // Not actually replaced: keep waiting for a working generation.
      record.attempts += 1;
      return;
    }
    record.channel = fresh;
    record.generation += 1;
    record.status = null;
    record.error = undefined;
    record.successAnnounced = false;
    record.failureAnnounced = false;
    record.attempts += 1;
    openChannel(client, record, record.generation);
  } finally {
    record.retryInFlight = false;
    if (record.status !== "SUBSCRIBED") ensureRetry(client, record);
  }
}

function openChannel(
  client: SupabaseClient,
  record: SharedBroadcastChannel,
  generation: number
): void {
  const channel = record.channel;
  const current = () => record.generation === generation && !record.disposed;
  // Registered before subscribe(): never add a handler afterwards.
  channel.on("broadcast", { event: "*" }, (payload: unknown) => {
    if (!current()) return;
    const message = payload as BroadcastMessage;
    for (const entry of [...record.subscribers]) {
      entry.subscriber.onMessage(message);
    }
  });
  channel.subscribe((status, error) => {
    if (!current()) return;
    if (status === "SUBSCRIBED") {
      cancelRetry(record);
      record.status = status;
      record.error = undefined;
      record.attempts = 0;
      if (!record.successAnnounced) {
        record.successAnnounced = true;
        announce(record, "SUBSCRIBED");
      }
      return;
    }
    if (!FAILED_STATUSES.has(status)) return;
    record.status = status;
    record.error = error;
    if (!record.failureAnnounced) {
      record.failureAnnounced = true;
      // One error per subscriber: listenToRows already fetches and starts
      // its reconcile tick on that error.
      announce(record, status, error);
    }
    ensureRetry(client, record);
  });
}

/**
 * Joins (or reuses) the shared channel for `topic` and registers one
 * subscriber. A cached failed join schedules one bounded retry that heals
 * every attached subscriber; a late subscriber joins that retry instead of
 * starting its own. Optional-only topics (campaign-gm for players) never
 * retry, so a policy denial is not turned into a reconnect loop.
 *
 * Returns the release function. A recorded status is replayed once to a
 * late subscriber on the next microtask so it fetches without waiting for
 * another subscribe event.
 */
export function subscribeBroadcast(
  client: SupabaseClient,
  topic: string,
  subscriber: BroadcastSubscriber
): () => void {
  let byTopic = channelsByClient.get(client);
  if (!byTopic) {
    byTopic = new Map();
    channelsByClient.set(client, byTopic);
  }
  let record = byTopic.get(topic);
  if (!record) {
    record = {
      topic,
      channel: client.channel(topic, { config: { private: true } }),
      subscribers: new Set(),
      status: null,
      error: undefined,
      generation: 0,
      successAnnounced: false,
      failureAnnounced: false,
      attempts: 0,
      retryTimer: undefined,
      retryInFlight: false,
      disposed: false,
    };
    byTopic.set(topic, record);
    openChannel(client, record, record.generation);
  }
  const registered: RegisteredSubscriber = {
    subscriber,
    notifiedFailure: false,
  };
  record.subscribers.add(registered);
  const joined = record;
  if (joined.status !== null) {
    queueMicrotask(() => {
      if (!joined.subscribers.has(registered) || joined.disposed) return;
      if (joined.status !== "SUBSCRIBED") registered.notifiedFailure = true;
      // Read the current status: a retry may have succeeded in the meantime.
      registered.subscriber.onStatus(joined.status as string, joined.error);
    });
  }
  if (joined.status !== null && joined.status !== "SUBSCRIBED") {
    ensureRetry(client, joined);
  }

  return () => {
    if (!joined.subscribers.delete(registered)) return;
    if (joined.subscribers.size > 0) return;
    joined.disposed = true;
    cancelRetry(joined);
    const current = channelsByClient.get(client);
    if (current?.get(topic) === joined) {
      current.delete(topic);
      if (current.size === 0) channelsByClient.delete(client);
    }
    void client.removeChannel(joined.channel);
  };
}
