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

/**
 * Joins (or reuses) the shared channel for `topic` and registers one
 * subscriber. Returns its release function; a late subscriber receives the
 * recorded status on the next microtask so it can fetch and start its own
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
  if (!shared) {
    const channel = client.channel(topic, { config: { private: true } });
    shared = {
      topic,
      channel,
      subscribers: new Set(),
      status: null,
      error: undefined,
    };
    byTopic.set(topic, shared);
    const record = shared;
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
    const current = channelsByClient.get(client);
    const record = current?.get(topic);
    if (!record || record !== joined) return;
    record.subscribers.delete(subscriber);
    if (record.subscribers.size === 0) {
      current?.delete(topic);
      if (current?.size === 0) channelsByClient.delete(client);
      void client.removeChannel(record.channel);
    }
  };
}
