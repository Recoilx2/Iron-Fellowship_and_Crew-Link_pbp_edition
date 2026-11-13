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
 * How many posts a fresh channel view loads, and how far back a reader may
 * page. The shared listener re-fetches the whole loaded window on every
 * reconcile tick, so the window stays bounded: paging in older posts grows
 * the window one page at a time up to this cap instead of re-fetching a
 * long channel in full.
 */
export const CHAT_POST_PAGE_SIZE = 30;
export const CHAT_POST_MAX_WINDOW = 300;

/**
 * Follows one channel's posts newest-first in the database, oldest-first to
 * the reader: the latest page loads first and older pages join the front as
 * the reader pages back. `limit` is the whole loaded window (latest page
 * plus every older page scrolled in), so callers grow it to page back and
 * re-subscribe. New, edited and deleted posts arrive live; outsiders see
 * nothing, because the post access rules (not an interface filter) decide
 * which rows arrive. Returns a plain unsubscribe function.
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
  const window = Math.max(1, Math.min(limit, CHAT_POST_MAX_WINDOW));
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
