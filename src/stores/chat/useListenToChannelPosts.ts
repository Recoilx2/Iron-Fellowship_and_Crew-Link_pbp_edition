import { useEffect } from "react";
import { useStore } from "stores/store";

/**
 * Follows the open channel's posts: the latest page loads first and older
 * pages join the front as the reader pages back. New arrivals are announced
 * for screen readers by the chat slice.
 */
export function useListenToChannelPosts() {
  const openChannelId = useStore((store) => store.chat.openChannelId);
  const subscribeToPosts = useStore((store) => store.chat.subscribeToPosts);

  useEffect(() => {
    const unsubscribe = subscribeToPosts(openChannelId);

    return () => {
      unsubscribe && unsubscribe();
    };
  }, [openChannelId, subscribeToPosts]);
}
