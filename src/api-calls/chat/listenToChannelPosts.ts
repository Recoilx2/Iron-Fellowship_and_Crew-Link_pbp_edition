import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "config/supabase.config";
import type { Unsubscribe } from "api-calls/helpers.type";
import {
  broadcastRowChange,
  broadcastRowsBinding,
  listenToRows,
  type BroadcastMessage,
  type RowChange,
} from "api-calls/realtime/listenToRows";
import { channelSharedTopic } from "api-calls/realtime/sharedTopics";
import type { PostDocument } from "api-calls/chat/_chat.type";
import {
  CHAT_POSTS_TABLE,
  constructChannelPostsChannelName,
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
 * The channel-shared broadcast topic is authorized by channel membership,
 * not by the post's GM-only flag: the #211 trigger publishes every chat post
 * there. The RLS-filtered REST read already hides GM-only posts from
 * players, so the live path must drop them too — in inserts/updates *and*
 * in deletes, where the payload carries the old row (and possibly only a
 * key). GMs keep both.
 */
export function channelPostBroadcastChange(
  isGM: boolean,
  message: BroadcastMessage
): RowChange<PostRow> | null {
  const payload =
    typeof message.payload === "object" && message.payload !== null
      ? (message.payload as Record<string, unknown>)
      : null;
  const record =
    payload &&
    ((payload.record ?? payload.old_record) as Record<string, unknown> | null);
  if (
    !isGM &&
    (record?.gms_only === true || payload?.gms_only === true)
  ) {
    return null;
  }
  return broadcastRowChange<PostRow>(message, {
    table: CHAT_POSTS_TABLE,
    getKey: (row) => row.id,
  });
}

/**
 * Follows one channel's posts newest-first in the database, oldest-first to
 * the reader: the latest page loads first and stays live, while older pages
 * join the front through fetchOlderChannelPosts as the reader pages back.
 * `limit` is the live window (one page in the app): new, edited and deleted
 * posts arrive live, and the extra lookahead row past the window tells the
 * reader an older page exists without loading it. Outsiders see nothing,
 * because the post access rules (not an interface filter) decide which rows
 * arrive. Returns a plain unsubscribe function.
 *
 * `isGM` is required by the live path: channel-shared broadcasts are not
 * filtered by the post's GM-only flag. Pass it from the campaign store; a
 * `client` override lets tests watch a GM and a player at the same time.
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
  onError: (error: any) => void,
  options?: { isGM?: boolean; client?: SupabaseClient }
): Unsubscribe {
  const { onPosts, onHasOlder, onLoaded } = dataHandler;
  if (!channelId) {
    onError(new Error("Must open a channel to read its posts."));
    return () => {};
  }
  const window = Math.max(1, limit);
  const client = options?.client ?? getSupabaseClient();
  const isGM = options?.isGM ?? false;
  let loaded = false;

  return listenToRows<PostRow>({
    client,
    channelName: constructChannelPostsChannelName(channelId),
    bindings: [
      broadcastRowsBinding<PostRow>({
        topic: channelSharedTopic(channelId),
        table: CHAT_POSTS_TABLE,
        getKey: (row) => row.id,
        // A revoked member's already-joined socket still receives channel
        // broadcasts, so never apply row data from the wire: re-read through
        // RLS instead. The filter below still drops GM-only rows before a
        // refresh is queued (defense in depth).
        refreshOnly: true,
        toChange: (message) => channelPostBroadcastChange(isGM, message),
      }),
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
