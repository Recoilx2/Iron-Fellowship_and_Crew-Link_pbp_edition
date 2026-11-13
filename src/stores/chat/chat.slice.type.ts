import { Unsubscribe } from "api-calls/helpers.type";
import { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import { PostWithId } from "api-calls/chat/listenToChannelPosts";
import type { Roll } from "types/DieRolls.type";

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
  /**
   * The roll waiting in each channel's composer: rolling attaches the
   * result to the draft, and sending posts text and roll together as the
   * current speaker.
   */
  pendingRolls: Record<string, Roll>;
}

export interface ChatSliceActions {
  subscribe: (campaignId: string | undefined) => Unsubscribe;
  setOpenChannelId: (channelId: string | undefined) => void;
  subscribeToPosts: (channelId: string | undefined) => Unsubscribe;
  /** Pages one older window in front of the live latest page, on scroll. */
  loadOlderPosts: (channelId: string) => Promise<void>;
  setDraft: (channelId: string, text: string) => void;
  /** Attaches a roll to the channel's draft, or clears it with null. */
  setPendingRoll: (channelId: string, roll: Roll | null) => void;

  resetStore: () => void;
}

export type ChatSlice = ChatSliceData & ChatSliceActions;
