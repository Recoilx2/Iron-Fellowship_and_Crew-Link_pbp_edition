import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "config/supabase.config";
import { constructChannelPostsChannelName } from "./_postRef";

/**
 * Typing presence for one chat channel (ticket #204).
 *
 * #201 proved that the self-hosted stack accepts presence joins and writes
 * on the `channel-posts:<id>` family. A member tracks a short presence
 * payload while they type; other members' browsers see the same presence
 * state and show their display names. Names are resolved from the app's
 * user map by the hook, never from this payload.
 */

/** Leading-edge throttle: one presence write per member per two seconds. */
export const TYPING_THROTTLE_MS = 2000;
/** A keystroke resets this timer; on expiry the member stops typing. */
export const TYPING_IDLE_MS = 3000;

export interface TypingPresence {
  uid: string;
  displayName: string;
  at: number;
}

export interface ChannelTypingSubscription {
  /** Call on every keystroke; throttling and the idle timer live here. */
  notifyTyping: () => void;
  /** Untrack now (send, blur, unmount, page hide or tab hidden). */
  stopTyping: () => void;
  /** Untrack, then leave the realtime topic for good. */
  unsubscribe: () => Promise<void>;
}

export interface ChannelTypingParams {
  channelId: string;
  uid: string;
  displayName: string;
  onTyping: (uids: string[]) => void;
  onError?: (error: Error) => void;
}

/**
 * The suffix is fixed rather than random. Presence state belongs to the
 * exact topic string: a per-runtime salt (as listenToRows uses for its
 * `:sub-` topics, issue #116) would put each member's browser on a
 * different topic, so nobody would ever see anyone typing. The `:presence-`
 * marker keeps this family separate from the post listener's `:sub-` one,
 * and the version counter reserves room to change the family later without
 * disturbing topics already live. The whole topic still starts with
 * `channel-posts:`, so the realtime-auth SELECT and INSERT policies match.
 */
const PRESENCE_TOPIC_SALT = "typing-v1";
const PRESENCE_TOPIC_COUNTER = 1;

interface PresenceChannel {
  channel: ReturnType<SupabaseClient["channel"]>;
  listeners: Set<() => void>;
  errors: Set<(error: Error) => void>;
}

/**
 * supabase-js returns the same channel object by topic until removeChannel
 * resolves. Register the presence handler and the join callback once, then
 * fan state/errors out to every active subscription on that object, so a
 * remount can never add a second handler to an already-subscribed channel.
 */
const presenceChannels = new WeakMap<object, PresenceChannel>();

export function constructChannelTypingTopic(channelId: string): string {
  return `${constructChannelPostsChannelName(
    channelId
  )}:presence-${PRESENCE_TOPIC_SALT}-${PRESENCE_TOPIC_COUNTER}`;
}

export function subscribeToChannelTyping({
  channelId,
  uid,
  displayName,
  onTyping,
  onError,
}: ChannelTypingParams): ChannelTypingSubscription {
  const client = getSupabaseClient();
  const channel = client.channel(constructChannelTypingTopic(channelId), {
    config: { private: true, presence: { key: uid } },
  });

  let removed = false;
  let lastTrackAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  let entry = presenceChannels.get(channel);
  if (!entry) {
    entry = { channel, listeners: new Set(), errors: new Set() };
    presenceChannels.set(channel, entry);
    const record = entry;
    // Registered before subscribe(): never add a handler afterwards.
    channel.on("presence", { event: "sync" }, () => {
      for (const listener of [...record.listeners]) listener();
    });
    channel.subscribe((status, subscribeError) => {
      // SUBSCRIBED is the only success signal. Everything else means no
      // presence state will arrive, so let the caller decide how to surface
      // it (the hook stays silent).
      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        const error = new Error(`presence subscribe ${status}`, {
          cause: subscribeError,
        });
        for (const report of [...record.errors]) report(error);
      }
    });
  }
  const presence = entry;

  const listener = () => {
    if (removed) return;
    // Presence keys are uids, and each key can hold more than one state
    // while a stale state is leaving. Read the uid from each state, falling
    // back to the key when a payload has none, and de-duplicate. Only the
    // uid is used from here: names come from the app's user map.
    const state = channel.presenceState() as Record<
      string,
      Array<{ uid?: unknown }>
    >;
    const uids: string[] = [];
    for (const [key, entries] of Object.entries(state)) {
      for (const item of entries) {
        const candidate = typeof item?.uid === "string" ? item.uid : key;
        if (candidate && !uids.includes(candidate)) {
          uids.push(candidate);
        }
      }
    }
    onTyping(uids);
  };
  presence.listeners.add(listener);

  const onSubscribedError = (error: Error) => {
    if (!removed) onError?.(error);
  };
  if (onError) presence.errors.add(onSubscribedError);
  const reportError = onSubscribedError;

  const clearIdle = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  const stopTyping = () => {
    clearIdle();
    // The next keystroke may track again at once, even inside the throttle
    // window: a stopped member is not typing.
    lastTrackAt = 0;
    if (removed) return;
    // Best effort: a dropped socket makes untrack fail, but the server
    // expires the presence entry on disconnect anyway.
    void channel
      .untrack()
      .then((status) => {
        if (status !== "ok") {
          reportError(new Error(`presence untrack refused: ${status}`));
        }
      })
      .catch((error: unknown) => {
        reportError(
          error instanceof Error
            ? error
            : new Error(`presence untrack failed: ${String(error)}`)
        );
      });
  };

  const notifyTyping = () => {
    if (removed || !uid) return;
    const now = Date.now();
    // Leading edge: the first keystroke tracks immediately, later ones
    // wait for the throttle window. Every keystroke still resets the idle
    // timer, so a slow typist keeps showing as typing.
    if (lastTrackAt === 0 || now - lastTrackAt >= TYPING_THROTTLE_MS) {
      lastTrackAt = now;
      void channel
        .track({ uid, displayName, at: now })
        .then((status) => {
          // track() resolves with a status instead of rejecting: #201
          // showed a refused presence INSERT arriving as 'error' while
          // the channel still reported SUBSCRIBED.
          if (status !== "ok") {
            lastTrackAt = 0;
            reportError(new Error(`presence track refused: ${status}`));
          }
        })
        .catch((error: unknown) => {
          lastTrackAt = 0;
          reportError(
            error instanceof Error
              ? error
              : new Error(`presence track failed: ${String(error)}`)
          );
        });
    }
    clearIdle();
    idleTimer = setTimeout(() => stopTyping(), TYPING_IDLE_MS);
  };

  const unsubscribe = async () => {
    if (removed) return;
    removed = true;
    clearIdle();
    try {
      // Clear our presence before leaving, so other members see the
      // indicator go away instead of waiting for the server's timeout.
      await channel.untrack();
    } catch {
      // A dead socket cannot carry an untrack; leaving still stops writes.
    }
    presence.listeners.delete(listener);
    presence.errors.delete(onSubscribedError);
    if (presence.listeners.size > 0) return;
    // Keep the registry entry until teardown resolves: a remount in the
    // same tick must reuse the handler instead of adding a second one.
    await client.removeChannel(channel);
    presenceChannels.delete(channel);
  };

  return { notifyTyping, stopTyping, unsubscribe };
}
