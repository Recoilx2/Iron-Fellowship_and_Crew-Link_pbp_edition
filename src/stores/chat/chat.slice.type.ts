import { Unsubscribe } from "api-calls/helpers.type";
import { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";

export interface ChatSliceData {
  channels: ChannelWithId[];
  openChannelId?: string;
  loading: boolean;
  error?: string;
}

export interface ChatSliceActions {
  subscribe: (campaignId: string | undefined) => Unsubscribe;
  setOpenChannelId: (channelId: string | undefined) => void;

  resetStore: () => void;
}

export type ChatSlice = ChatSliceData & ChatSliceActions;
