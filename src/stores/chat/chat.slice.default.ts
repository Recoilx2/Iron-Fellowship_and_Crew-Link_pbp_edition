import { ChatSliceData } from "./chat.slice.type";

export const defaultChatSlice: ChatSliceData = {
  channels: [],
  openChannelId: undefined,
  membersByChannel: {},
  loading: false,
  error: undefined,
  postsByChannel: {},
  hasOlderByChannel: {},
  focusedPostId: undefined,
  postsLoading: false,
  postsError: undefined,
  drafts: {},
  pendingRolls: {},
};
