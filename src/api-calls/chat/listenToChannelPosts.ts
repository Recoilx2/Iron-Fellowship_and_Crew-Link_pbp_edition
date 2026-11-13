import { getSupabaseClient } from "config/supabase.config";
import type { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import type { PostDocument } from "api-calls/chat/_chat.type";
import {
  CHAT_POSTS_TABLE,
  constructChannelPostsChannelName,
  constructChannelPostsFilter,
  postPayloadToChange,
  postRowToDocument,
  type PostRow,
} from "./_postRef";

export interface PostWithId extends PostDocument {
  id: string;
}

/**
 * How many posts a fresh channel view loads on its live subscription. The
 * shared listener re-fetches this window on every reconcile tick, so the
 * window stays one page: scrolling back pages older posts in with a one-off
 * query (fetchOlderChannelPosts) instead of growing the live subscription,
 * and a long channel is never re-fetched in full.
 */
export const CHAT_POST_PAGE_SIZE = 30;

/**
 * Follows one channel's posts newest-first in the database, oldest-first to
 * the reader: the latest page loads first and stays live, while older pages
 * join the front through fetchOlderChannelPosts as the reader pages back.
 * `limit` is the live window (one page in the app): new, edited and deleted
 * posts arrive live, and the extra lookahead row past the window tells the
 * reader an older page exists without loading it. Outsiders see nothing,
 * because the post access rules (not an interface filter) decide which rows
 * arrive. Returns a plain unsubscribe function.
 */
export function listenToChannelPosts(
  channelId: string,
  limit: number,
  dataHandler: {
    onPosts: (posts: PostWithId[]) => void;
    onHasOlder: (hasOlder: boolean) => void;
    onLoaded: () => void;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe {
  const { onPosts, onHasOlder, onLoaded } = dataHandler;
  if (!channelId) {
    onError(new Error("Must open a channel to read its posts."));
    return () => {};
  }
  const window = Math.max(1, limit);
  const client = getSupabaseClient();
  let loaded = false;

  return listenToRows<PostRow>({
    client,
    channelName: constructChannelPostsChannelName(channelId),
    bindings: [
      {
        type: "postgres_changes",
        table: CHAT_POSTS_TABLE,
        filter: constructChannelPostsFilter(channelId),
        toChange: postPayloadToChange,
      },
    ],
    fetchRows: async () => {
      // One row past the window tells the reader an older page exists,
      // without loading it.
      const { data, error } = await client
        .from(CHAT_POSTS_TABLE)
        .select("*")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(window + 1);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as PostRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      onHasOlder(rows.length > window);
      onPosts(
        rows
          .slice(0, window)
          .reverse()
          .map((row) => ({ id: row.id, ...postRowToDocument(row) }))
      );
      if (!loaded) {
        loaded = true;
        onLoaded();
      }
    },
    onError,
  });
}
