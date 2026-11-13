import { useEffect } from "react";
import { useStore } from "stores/store";

export function useListenToChatChannels() {
  const campaignId = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaignId
  );
  const subscribe = useStore((store) => store.chat.subscribe);

  useEffect(() => {
    const unsubscribe = subscribe(campaignId);

    return () => {
      unsubscribe && unsubscribe();
    };
  }, [campaignId, subscribe]);
}
