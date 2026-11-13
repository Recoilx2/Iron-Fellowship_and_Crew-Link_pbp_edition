import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CHAT_POSTS_TABLE } from "./_postRef";

/**
 * Changes the text of a post. Only the author may edit, and only while the
 * post is live: the post access rules refuse everyone else and deleted
 * posts, which read as "post not found". The database stamps the edit, so
 * the feed shows the new text with an edited marker, and the change arrives
 * live as an update.
 */
export const editPost = createApiFunction<
  { postId: string; text: string },
  void
>(async (params) => {
  const { postId, text } = params;
  if (!postId) {
    throw new Error("A post is required to edit.");
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("Post text is required.");
  }
  const { data, error } = await getSupabaseClient()
    .from(CHAT_POSTS_TABLE)
    .update({ text: trimmed })
    .eq("id", postId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Post not found.");
  }
}, "Failed to edit post.");
