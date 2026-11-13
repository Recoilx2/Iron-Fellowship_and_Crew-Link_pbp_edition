import { Unsubscribe } from "api-calls/helpers.type";
import { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import { PostWithId } from "api-calls/chat/listenToChannelPosts";

export interface ChatSliceData {
  channels: ChannelWithId[];
  openChannelId?: string;
  /** The roster of every visible channel, keyed by channel id. */
  membersByChannel: Record<string, string[]>;
  loading: boolean;
  error?: string;
  /** The loaded window per channel, oldest-first for the feed. */
  postsByChannel: Record<string, PostWithId[]>;
  /** Whether an older page waits above each loaded window. */
  hasOlderByChannel: Record<string, boolean>;
  postsLoading: boolean;
  postsError?: string;
  /** The composer's unsent text per channel, kept for the session. */
  drafts: Record<string, string>;
}

export interface ChatSliceActions {
  subscribe: (campaignId: string | undefined) => Unsubscribe;
  setOpenChannelId: (channelId: string | undefined) => void;
  subscribeToPosts: (channelId: string | undefined) => Unsubscribe;
  /** Grows the channel's loaded window one page and re-subscribes. */
  loadOlderPosts: (channelId: string) => void;
  setDraft: (channelId: string, text: string) => void;

  resetStore: () => void;
}

export type ChatSlice = ChatSliceData & ChatSliceActions;
