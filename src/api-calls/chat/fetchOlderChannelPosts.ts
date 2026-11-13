import { getSupabaseClient } from "config/supabase.config";
import {
  CHAT_POSTS_TABLE,
  postRowToDocument,
  type PostRow,
} from "./_postRef";
import {
  CHAT_POST_PAGE_SIZE,
  type PostWithId,
} from "./listenToChannelPosts";

export interface OlderPostsPage {
  /** The fetched page, oldest-first for the feed. */
  posts: PostWithId[];
  /** Whether a still-older page waits above the fetched one. */
  hasOlder: boolean;
}

/**
 * Pages one window of older posts with a one-off query: the rows strictly
 * older than the reader's oldest post, newest-first in the database with a
 * one-row lookahead past the page, oldest-first to the reader. The live
 * subscription stays on the latest page, so scrolling back never grows the
 * live window: the slice prepends these pages in front of it all the way to
 * the channel's first post.
 */
export async function fetchOlderChannelPosts(
  channelId: string,
  before: { createdAt: string; id: string },
  pageSize: number = CHAT_POST_PAGE_SIZE
): Promise<OlderPostsPage> {
  if (!channelId) {
    throw new Error("Must open a channel to read its posts.");
  }
  const client = getSupabaseClient();
  // Keyset on (created_at, id): rows older than the cursor, ties on the
  // timestamp broken by id so same-second posts never slip through.
  const { data, error } = await client
    .from(CHAT_POSTS_TABLE)
    .select("*")
    .eq("channel_id", channelId)
    .or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);
  if (error) {
    throw error;
  }
  const rows = ((data ?? []) as unknown as PostRow[]).slice(0, pageSize + 1);
  return {
    posts: rows
      .slice(0, pageSize)
      .reverse()
      .map((row) => ({ id: row.id, ...postRowToDocument(row) })),
    hasOlder: rows.length > pageSize,
  };
}
