import { CreateSliceType } from "stores/store.type";
import { ChatSlice } from "./chat.slice.type";
import { defaultChatSlice } from "./chat.slice.default";
import { listenToCampaignChannels } from "api-calls/chat/listenToCampaignChannels";
import { listenToCampaignChannelMembers } from "api-calls/chat/listenToCampaignChannelMembers";
import {
  CHAT_POST_PAGE_SIZE,
  listenToChannelPosts,
} from "api-calls/chat/listenToChannelPosts";
import { fetchOlderChannelPosts } from "api-calls/chat/fetchOlderChannelPosts";
import type { Unsubscribe } from "api-calls/helpers.type";
import { getRollDescription } from "functions/rollText";

// The live post subscription per channel stays on the latest page, so the
// shared listener's reconcile re-fetch stays one page even in long
// channels. Scrolling back pages older posts in front of it with a one-off
// query, all the way to the channel's first post. The slice owns the one
// active post subscription, so switching channels stops the old feed.
let activePostsChannelId: string | undefined;
let stopActivePosts: Unsubscribe | undefined;
// Channels the reader has paged back in: their has-older flag comes from
// the one-off pages, no longer from the live window's lookahead.
const pagedBackByChannel: Record<string, boolean> = {};
const pagingOlderByChannel: Record<string, boolean> = {};

function stopPosts(): void {
  stopActivePosts?.();
  stopActivePosts = undefined;
  activePostsChannelId = undefined;
}

function postIds(posts: { id: string }[]): Set<string> {
  return new Set(posts.map((post) => post.id));
}

type ChatSliceApi = CreateSliceType<ChatSlice>;
type ChatSet = Parameters<ChatSliceApi>[0];
type ChatGet = Parameters<ChatSliceApi>[1];

function startPosts(channelId: string, set: ChatSet, get: ChatGet): void {
  set((store) => {
    store.chat.postsLoading = true;
    store.chat.postsError = undefined;
  });
  activePostsChannelId = channelId;
  stopActivePosts = listenToChannelPosts(
    channelId,
    CHAT_POST_PAGE_SIZE,
    {
      onPosts: (posts) => {
        // Announce genuinely new arrivals for screen readers: the first
        // snapshot only fills the feed, and paging back only adds older
        // posts, so only posts newer than everything already shown count.
        const previous = get().chat.postsByChannel[channelId] ?? [];
        const previousIds = postIds(previous);
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
        // The live window holds the latest page only: posts the reader
        // paged back in stay in front of it, so a live re-emit never drops
        // older pages the one-off query fetched.
        const liveIds = postIds(posts);
        const merged =
          posts.length === 0
            ? []
            : [
                ...previous.filter(
                  (post) =>
                    !liveIds.has(post.id) &&
                    (post.createdAt < posts[0].createdAt ||
                      (post.createdAt === posts[0].createdAt &&
                        post.id < posts[0].id))
                ),
                ...posts,
              ];
        set((store) => {
          store.chat.postsByChannel[channelId] = merged;
        });
        if (arrivals.length > 0) {
          const channel = get().chat.channels.find(
            (row) => row.id === channelId
          );
          const where = channel ? ` in # ${channel.name}` : "";
          const latestPost = arrivals[arrivals.length - 1];
          // A roll-only post carries no text, so the roll speaks for it;
          // an image-only post arrives with no words at all.
          const words =
            latestPost.text ||
            (latestPost.roll ? getRollDescription(latestPost.roll) : "");
          const latest =
            words.trim().length > 0
              ? words.slice(0, 140)
              : `${latestPost.imagePaths.length} image${
                  latestPost.imagePaths.length === 1 ? "" : "s"
                }`;
          get().appState.announce(`New post${where}: ${latest}`);
        }
      },
      onHasOlder: (hasOlder) => {
        // Once the reader pages back, the one-off pages own the flag: the
        // live window's lookahead only knows about its own latest page.
        if (pagedBackByChannel[channelId]) {
          return;
        }
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
    const stopMembers = listenToCampaignChannelMembers(
      campaignId,
      {
        onMembers: (rows) => {
          const byChannel: Record<string, string[]> = {};
          for (const row of rows) {
            const list = byChannel[row.channel_id] ?? [];
            list.push(row.user_id);
            byChannel[row.channel_id] = list;
          }
          for (const list of Object.values(byChannel)) {
            list.sort();
          }
          set((store) => {
            store.chat.membersByChannel = byChannel;
          });
        },
        onLoaded: () => {},
      },
      (error) => {
        console.error(error);
      }
    );
    const stopChannels = listenToCampaignChannels(
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
    return () => {
      stopChannels();
      stopMembers();
    };
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

  loadOlderPosts: async (channelId) => {
    // One page back per call, all the way to the channel's first post: the
    // live subscription keeps its latest page while the fetched page joins
    // the front. A second call waits for the first instead of racing it.
    if (!channelId || pagingOlderByChannel[channelId]) {
      return;
    }
    const oldest = get().chat.postsByChannel[channelId]?.[0];
    if (!oldest) {
      return;
    }
    pagingOlderByChannel[channelId] = true;
    try {
      const page = await fetchOlderChannelPosts(
        channelId,
        { createdAt: oldest.createdAt, id: oldest.id },
        CHAT_POST_PAGE_SIZE
      );
      pagedBackByChannel[channelId] = true;
      const current = get().chat.postsByChannel[channelId] ?? [];
      const currentIds = postIds(current);
      const fresh = page.posts.filter((post) => !currentIds.has(post.id));
      set((store) => {
        store.chat.postsByChannel[channelId] = [...fresh, ...current];
        store.chat.hasOlderByChannel[channelId] = page.hasOlder;
      });
    } catch (error) {
      console.error(error);
      set((store) => {
        store.chat.postsError = "Failed to load older posts.";
      });
    } finally {
      pagingOlderByChannel[channelId] = false;
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

  setPendingRoll: (channelId, roll) => {
    set((store) => {
      if (roll === null) {
        delete store.chat.pendingRolls[channelId];
      } else {
        store.chat.pendingRolls[channelId] = roll;
      }
    });
  },

  resetStore: () => {
    stopPosts();
    for (const channelId of Object.keys(pagedBackByChannel)) {
      delete pagedBackByChannel[channelId];
    }
    for (const channelId of Object.keys(pagingOlderByChannel)) {
      delete pagingOlderByChannel[channelId];
    }
    set((store) => {
      store.chat = {
        ...store.chat,
        ...defaultChatSlice,
      };
    });
  },
});
