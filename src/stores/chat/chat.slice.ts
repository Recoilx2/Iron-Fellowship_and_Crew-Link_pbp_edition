import { CreateSliceType } from "stores/store.type";
import { ChatSlice } from "./chat.slice.type";
import { defaultChatSlice } from "./chat.slice.default";
import { listenToCampaignChannels } from "api-calls/chat/listenToCampaignChannels";
import {
  CHAT_POST_MAX_WINDOW,
  CHAT_POST_PAGE_SIZE,
  listenToChannelPosts,
} from "api-calls/chat/listenToChannelPosts";
import type { Unsubscribe } from "api-calls/helpers.type";

// The live post window per channel: paging back grows the limit one page
// at a time up to the cap, so the shared listener's reconcile re-fetch
// stays bounded even in long channels. The slice owns the one active post
// subscription, so switching channels stops the old feed and paging back
// restarts the current one with its wider window.
const postWindowByChannel: Record<string, number> = {};
let activePostsChannelId: string | undefined;
let stopActivePosts: Unsubscribe | undefined;

function stopPosts(): void {
  stopActivePosts?.();
  stopActivePosts = undefined;
  activePostsChannelId = undefined;
}

type ChatSliceApi = CreateSliceType<ChatSlice>;
type ChatSet = Parameters<ChatSliceApi>[0];
type ChatGet = Parameters<ChatSliceApi>[1];

function startPosts(channelId: string, set: ChatSet, get: ChatGet): void {
  const limit = postWindowByChannel[channelId] ?? CHAT_POST_PAGE_SIZE;
  set((store) => {
    store.chat.postsLoading = true;
    store.chat.postsError = undefined;
  });
  activePostsChannelId = channelId;
  stopActivePosts = listenToChannelPosts(
    channelId,
    limit,
    {
      onPosts: (posts) => {
        // Announce genuinely new arrivals for screen readers: the first
        // snapshot only fills the feed, and paging back only adds older
        // posts, so only posts newer than everything already shown count.
        const previous = get().chat.postsByChannel[channelId] ?? [];
        const previousIds = new Set(previous.map((post) => post.id));
        const newestPrevious = previous.reduce<string | null>(
          (newest, post) =>
            newest === null || post.createdAt > newest ? post.createdAt : newest,
          null
        );
        const arrivals = posts.filter(
          (post) =>
            !previousIds.has(post.id) &&
            newestPrevious !== null &&
            post.createdAt > newestPrevious
        );
        set((store) => {
          store.chat.postsByChannel[channelId] = posts;
        });
        if (arrivals.length > 0) {
          const channel = get().chat.channels.find(
            (row) => row.id === channelId
          );
          const where = channel ? ` in # ${channel.name}` : "";
          const latest = arrivals[arrivals.length - 1].text.slice(0, 140);
          get().appState.announce(`New post${where}: ${latest}`);
        }
      },
      onHasOlder: (hasOlder) => {
        set((store) => {
          store.chat.hasOlderByChannel[channelId] = hasOlder;
        });
      },
      onLoaded: () => {
        set((store) => {
          store.chat.postsLoading = false;
        });
      },
    },
    (error) => {
      console.error(error);
      set((store) => {
        store.chat.postsLoading = false;
        store.chat.postsError = "Failed to load posts.";
      });
    }
  );
}

export const createChatSlice: CreateSliceType<ChatSlice> = (set, get) => ({
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

  subscribeToPosts: (channelId) => {
    if (!channelId) {
      return () => {};
    }
    stopPosts();
    startPosts(channelId, set, get);
    // Stops whatever post feed is current for this channel, including a
    // wider window a page-back started after this call.
    return () => {
      if (activePostsChannelId === channelId) {
        stopPosts();
      }
    };
  },

  loadOlderPosts: (channelId) => {
    const next = Math.min(
      (postWindowByChannel[channelId] ?? CHAT_POST_PAGE_SIZE) +
        CHAT_POST_PAGE_SIZE,
      CHAT_POST_MAX_WINDOW
    );
    if (next === (postWindowByChannel[channelId] ?? CHAT_POST_PAGE_SIZE)) {
      return;
    }
    postWindowByChannel[channelId] = next;
    if (activePostsChannelId === channelId) {
      stopPosts();
      startPosts(channelId, set, get);
    }
  },

  setDraft: (channelId, text) => {
    set((store) => {
      if (text.length === 0) {
        delete store.chat.drafts[channelId];
      } else {
        store.chat.drafts[channelId] = text;
      }
    });
  },

  resetStore: () => {
    stopPosts();
    for (const channelId of Object.keys(postWindowByChannel)) {
      delete postWindowByChannel[channelId];
    }
    set((store) => {
      store.chat = {
        ...store.chat,
        ...defaultChatSlice,
      };
    });
  },
});
