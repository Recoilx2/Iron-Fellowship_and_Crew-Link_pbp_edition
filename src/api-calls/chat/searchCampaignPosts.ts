import { getSupabaseClient } from "config/supabase.config";
import { postRowToDocument, type PostRow } from "./_postRef";
import type { PostWithId } from "./listenToChannelPosts";

/**
 * One page of campaign-wide post search, newest-first from the database and
 * from the caller's point of view (the results dialog reads them in that
 * order). The database function applies the same row policy as the feed, so
 * only posts the signed-in member may read ever come back.
 */
export const CHAT_SEARCH_PAGE_SIZE = 20;

/** The last row of a page: pass it back to fetch the next older page. */
export interface SearchCursor {
  createdAt: string;
  id: string;
}

export interface SearchCampaignPostsParams {
  campaignId: string;
  query: string;
  cursor?: SearchCursor;
  pageSize?: number;
}

export interface SearchCampaignPostsResult {
  posts: PostWithId[];
  /** Present only when a one-row lookahead found an older match. */
  nextCursor?: SearchCursor;
}

/**
 * Searches post text across every channel of one campaign, paged by the
 * (created_at, id) pair of the last result. The phrase is trimmed here for a
 * friendly error and again in SQL before its wildcard characters are
 * escaped; the query itself never builds a PostgREST filter from user text.
 */
export async function searchCampaignPosts(
  params: SearchCampaignPostsParams
): Promise<SearchCampaignPostsResult> {
  const {
    campaignId,
    query,
    cursor,
    pageSize = CHAT_SEARCH_PAGE_SIZE,
  } = params;
  if (!campaignId) {
    throw new Error("A campaign is required to search its posts.");
  }
  if (!query || query.trim().length === 0) {
    throw new Error("Enter some words to search for.");
  }
  // The server clamps too; clamping here keeps the lookahead consistent with
  // the page size the caller asked for.
  const size = Math.max(1, Math.min(pageSize, 50));
  const { data, error } = await getSupabaseClient().rpc(
    "search_campaign_posts",
    {
      p_campaign_id: campaignId,
      p_query: query.trim(),
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: size,
    }
  );
  if (error) {
    throw error;
  }
  const rows = ((data ?? []) as unknown as PostRow[]).slice(0, size + 1);
  const posts = rows
    .slice(0, size)
    .map((row) => ({ id: row.id, ...postRowToDocument(row) }));
  const last = posts.at(-1);
  return {
    posts,
    nextCursor:
      rows.length > size && last
        ? { createdAt: last.createdAt, id: last.id }
        : undefined,
  };
}
