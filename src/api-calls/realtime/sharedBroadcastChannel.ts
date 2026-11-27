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
 * leaves. A cached failed join is retried when a new required subscriber
 * arrives, so a first-mount TIMED_OUT cannot poison later listeners.
 *
 * Postgres Changes keep their own per-subscription suffixed topics (issue
 * #116): those have no database-side publisher to match.
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

interface SharedBroadcastChannel {
  topic: string;
  channel: ReturnType<SupabaseClient["channel"]>;
  subscribers: Set<BroadcastSubscriber>;
  status: string | null;
  error: unknown;
}

const channelsByClient = new WeakMap<
  SupabaseClient,
  Map<string, SharedBroadcastChannel>
>();

const FAILED_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

function openChannel(
  client: SupabaseClient,
  topic: string
): SharedBroadcastChannel {
  const channel = client.channel(topic, { config: { private: true } });
  const record: SharedBroadcastChannel = {
    topic,
    channel,
    subscribers: new Set(),
    status: null,
    error: undefined,
  };
  // Registered before subscribe(): never add a handler afterwards.
  channel.on("broadcast", { event: "*" }, (payload: unknown) => {
    const message = payload as BroadcastMessage;
    for (const listener of [...record.subscribers]) {
      listener.onMessage(message);
    }
  });
  channel.subscribe((status, error) => {
    record.status = status;
    record.error = error;
    for (const listener of [...record.subscribers]) {
      listener.onStatus(status, error);
    }
  });
  return record;
}

/**
 * Joins (or reuses) the shared channel for `topic` and registers one
 * subscriber. A failed cached join is retried when a new subscriber needs
 * the topic: the old channel is dropped and every current subscriber moves
 * onto a fresh join, so a first-mount TIMED_OUT cannot poison the page.
 * Optional-only topics (campaign-gm for players) never retry, so a policy
 * denial is not turned into a reconnect loop.
 *
 * Returns the release function. The recorded status is replayed to a late
 * subscriber on the next microtask so it fetches and starts its own
 * reconcile timer without waiting for another subscribe event.
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
  let shared = byTopic.get(topic);
  if (
    shared &&
    shared.status !== null &&
    FAILED_STATUSES.has(shared.status) &&
    [...shared.subscribers, subscriber].some((item) => !item.optional)
  ) {
    // Migrate every subscriber to a new channel: replaying the old failure
    // would leave all listeners permanently unsubscribed.
    const inherited = new Set(shared.subscribers);
    shared.subscribers.clear();
    byTopic.delete(topic);
    void client.removeChannel(shared.channel);
    shared = openChannel(client, topic);
    shared.subscribers = inherited;
    byTopic.set(topic, shared);
  }
  if (!shared) {
    shared = openChannel(client, topic);
    byTopic.set(topic, shared);
  }
  shared.subscribers.add(subscriber);
  const joined = shared;
  if (joined.status !== null) {
    queueMicrotask(() => {
      if (joined.subscribers.has(subscriber)) {
        subscriber.onStatus(joined.status as string, joined.error);
      }
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Look up by subscriber identity, not by the record captured at
    // subscription time: a retry may have replaced that record.
    const current = channelsByClient.get(client);
    const record = current?.get(topic);
    if (!record || !record.subscribers.delete(subscriber)) return;
    if (record.subscribers.size === 0) {
      current?.delete(topic);
      if (current?.size === 0) channelsByClient.delete(client);
      void client.removeChannel(record.channel);
    }
  };
}
