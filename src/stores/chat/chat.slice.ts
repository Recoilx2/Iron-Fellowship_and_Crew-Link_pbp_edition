import { CreateSliceType } from "stores/store.type";
import { ChatSlice } from "./chat.slice.type";
import { defaultChatSlice } from "./chat.slice.default";
import { listenToCampaignChannels } from "api-calls/chat/listenToCampaignChannels";

export const createChatSlice: CreateSliceType<ChatSlice> = (set) => ({
  ...defaultChatSlice,

  subscribe: (campaignId) => {
    if (!campaignId) {
      return () => {};
    }

    set((store) => {
      store.chat.loading = true;
      store.chat.error = undefined;
    });
    return listenToCampaignChannels(
      campaignId,
      {
        onChannels: (channels) => {
          set((store) => {
            store.chat.loading = false;
            store.chat.channels = channels;
            // Keep the player's place: only pick a channel when the open one
            // is gone. Fresh loads land on the starting IC channel.
            const stillThere =
              store.chat.openChannelId &&
              channels.some(
                (channel) => channel.id === store.chat.openChannelId
              );
            if (!stillThere) {
              store.chat.openChannelId =
                channels.find(
                  (channel) => channel.isStarting && channel.kind === "IC"
                )?.id ?? channels[0]?.id;
            }
          });
        },
        onLoaded: () => {
          set((store) => {
            store.chat.loading = false;
          });
        },
      },
      (error) => {
        console.error(error);
        set((store) => {
          store.chat.loading = false;
          store.chat.error = "Failed to load channels.";
        });
      }
    );
  },

  setOpenChannelId: (channelId) => {
    set((store) => {
      store.chat.openChannelId = channelId;
    });
  },

  resetStore: () => {
    set((store) => {
      store.chat = {
        ...store.chat,
        ...defaultChatSlice,
      };
    });
  },
});
