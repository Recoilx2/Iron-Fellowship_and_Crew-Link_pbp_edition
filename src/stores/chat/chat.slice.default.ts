import { ChatSliceData } from "./chat.slice.type";

export const defaultChatSlice: ChatSliceData = {
  channels: [],
  openChannelId: undefined,
  loading: false,
  error: undefined,
  postsByChannel: {},
  hasOlderByChannel: {},
  postsLoading: false,
  postsError: undefined,
  drafts: {},
};
