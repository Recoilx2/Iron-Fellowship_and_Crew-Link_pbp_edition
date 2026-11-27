import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  subscribeToChannelTyping,
  type ChannelTypingSubscription,
} from "api-calls/chat/channelTyping";
import { useStore } from "stores/store";

/**
 * Who is typing in the current channel (ticket #204).
 *
 * The presence payload carries a uid and a display name, but only the uid is
 * used: names always come from the app's user map, and readers are filtered
 * by the channel's own visibility before a name is shown. Presence failures
 * are deliberately silent -- a dropped indicator never interrupts posting.
 *
 * `typingNames` is the value for the indicator; `notifyTyping` and
 * `stopTyping` are the composer's controls for the same presence
 * subscription, so typing and reading share one realtime channel.
 */
export interface ChannelTypingState {
  typingNames: string[];
  notifyTyping: () => void;
  stopTyping: () => void;
}

const EMPTY_IDS: string[] = [];

export function useChannelTyping(channelId: string): ChannelTypingState {
  const uid = useStore((store) => store.auth?.uid ?? "");
  const displayName = useStore(
    (store) => store.auth?.user?.displayName ?? ""
  );
  const membersByChannel = useStore(
    (store) => store.chat?.membersByChannel ?? {}
  );
  const channels = useStore((store) => store.chat?.channels ?? []);
  const draft = useStore((store) => store.chat?.drafts?.[channelId] ?? "");
  const currentCampaign = useStore(
    (store) => store.campaigns?.currentCampaign?.currentCampaign
  );
  const userMap = useStore((store) => store.users?.userMap ?? {});

  const visibility = channels.find((channel) => channel.id === channelId)
    ?.visibility;
  const members = membersByChannel[channelId] ?? EMPTY_IDS;
  const roster = currentCampaign?.users ?? EMPTY_IDS;
  const gmIds = currentCampaign?.gmIds ?? EMPTY_IDS;

  const [typingUids, setTypingUids] = useState<string[]>([]);
  const controlsRef = useRef<ChannelTypingSubscription | null>(null);
  // Only stop a presence write when one is outstanding: a fresh subscription
  // starts with no presence state, and an unconditional stop on the first
  // render would ask an unsubscribed channel to untrack.
  const isTypingRef = useRef(false);

  useEffect(() => {
    isTypingRef.current = false;
    if (!channelId || !uid) {
      setTypingUids([]);
      return;
    }
    // No onError: presence is a nicety. A refused join or write leaves the
    // composer working and the indicator empty.
    const subscription = subscribeToChannelTyping({
      channelId,
      uid,
      displayName,
      onTyping: setTypingUids,
    });
    controlsRef.current = subscription;

    const onPageHide = () => subscription.stopTyping();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        subscription.stopTyping();
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      isTypingRef.current = false;
      if (controlsRef.current === subscription) {
        controlsRef.current = null;
      }
      void subscription.unsubscribe();
    };
  }, [channelId, uid, displayName]);

  // A cleared draft means a sent post: clear presence even if the send
  // button's own stopTyping call was missed (for example, an Enter send).
  useEffect(() => {
    if (!draft && isTypingRef.current) {
      isTypingRef.current = false;
      controlsRef.current?.stopTyping();
    }
  }, [draft]);

  const notifyTyping = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    isTypingRef.current = true;
    controls.notifyTyping();
  }, []);

  const stopTyping = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    isTypingRef.current = false;
    controls.stopTyping();
  }, []);

  const typingNames = useMemo(() => {
    // Client-side reader filter (the approved decision for #204): a server
    // gate on `channel-posts%` would break the presence proof. A public
    // channel is open to the campaign roster; a private one to its roster
    // plus the campaign's GMs; a direct message to its two members alone.
    const allowed =
      visibility === "private"
        ? new Set([...members, ...gmIds])
        : visibility === "dm"
          ? new Set(members)
          : new Set(roster);
    return typingUids
      .filter((id) => id && id !== uid && allowed.has(id))
      .map((id) => userMap[id]?.doc?.displayName?.trim())
      .filter((name): name is string => !!name)
      .sort((a, b) => a.localeCompare(b));
  }, [typingUids, uid, visibility, members, gmIds, roster, userMap]);

  return { typingNames, notifyTyping, stopTyping };
}
