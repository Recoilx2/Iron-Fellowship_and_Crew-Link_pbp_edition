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

/**
 * A window of posts around one post the reader jumped to from search: the
 * target, up to `pageSize` older posts and up to `pageSize` newer ones, all
 * oldest-first. The older query carries a one-row lookahead for the
 * has-older flag, so the feed can keep paging back past the loaded context.
 */
export interface PostsAroundPage {
  posts: PostWithId[];
  hasOlder: boolean;
}

/** The search result a reader picked, used as the keyset anchor. */
export interface PostAnchor {
  channelId: string;
  id: string;
  createdAt: string;
}

function compare(a: PostWithId, b: PostWithId): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Reads the context in three one-off queries, all against chat_posts with
 * the signed-in member's access: the RLS policies decide which of the
 * surrounding posts arrive, exactly as they do for the live feed. The
 * anchors are strict keysets on (created_at, id), so the target appears
 * once even when posts share a timestamp.
 */
export async function fetchPostsAround(
  target: PostAnchor,
  pageSize: number = CHAT_POST_PAGE_SIZE
): Promise<PostsAroundPage> {
  if (!target.channelId || !target.id) {
    throw new Error("A post and its channel are required to jump to it.");
  }
  const size = Math.max(1, pageSize);
  const client = getSupabaseClient();
  const older = await client
    .from(CHAT_POSTS_TABLE)
    .select("*")
    .eq("channel_id", target.channelId)
    .or(
      `created_at.lt.${target.createdAt},and(created_at.eq.${target.createdAt},id.lt.${target.id})`
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(size + 1);
  if (older.error) {
    throw older.error;
  }
  const newer = await client
    .from(CHAT_POSTS_TABLE)
    .select("*")
    .eq("channel_id", target.channelId)
    .or(
      `created_at.gt.${target.createdAt},and(created_at.eq.${target.createdAt},id.gt.${target.id})`
    )
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(size);
  if (newer.error) {
    throw newer.error;
  }
  const { data: targetRow, error: targetError } = await client
    .from(CHAT_POSTS_TABLE)
    .select("*")
    .eq("id", target.id)
    .maybeSingle();
  if (targetError) {
    throw targetError;
  }

  // Dedupe by id before sorting: a live row could have arrived between the
  // three queries, and the newest copy (the target read) wins.
  const byId = new Map<string, PostWithId>();
  const add = (row: PostRow) => {
    byId.set(row.id, { id: row.id, ...postRowToDocument(row) });
  };
  for (const row of ((older.data ?? []) as unknown as PostRow[]).slice(0, size)) {
    add(row);
  }
  for (const row of (newer.data ?? []) as unknown as PostRow[]) add(row);
  if (targetRow) {
    add(targetRow as unknown as PostRow);
  } else {
    // A post deleted or revoked between search and the jump still anchors
    // the window: the surrounding rows are enough to place the reader.
    byId.set(target.id, {
      id: target.id,
      channelId: target.channelId,
      authorId: "",
      speakerCharacterId: null,
      speakerNpcId: null,
      text: "",
      imagePaths: [],
      roll: null,
      gmsOnly: false,
      createdAt: target.createdAt,
      editedAt: null,
      deletedAt: new Date().toISOString(),
    });
  }

  return {
    posts: [...byId.values()].sort(compare),
    hasOlder: ((older.data ?? []) as unknown as PostRow[]).length > size,
  };
}
