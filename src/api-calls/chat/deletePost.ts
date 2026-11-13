import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CHAT_POSTS_TABLE } from "./_postRef";

/**
 * Soft-deletes a post: the author may take back their own post, and GMs may
 * delete any post in their campaign. A delete is an update that clears the
 * content and stamps the delete marker, never a SQL delete: under
 * postgres_changes a delete event bypasses row-level security, while an
 * update stays filtered per reader. The row stays in place so the feed
 * shows a "post deleted" marker, and the change arrives live as an update.
 * Everyone else (and deleted posts) reads as "post not found".
 */
export const deletePost = createApiFunction<{ postId: string }, void>(
  async (params) => {
    const { postId } = params;
    if (!postId) {
      throw new Error("A post is required to delete.");
    }
    // The marker's timestamp is stamped by the database; the content is
    // cleared here so the row never briefly carries deleted text.
    const { data, error } = await getSupabaseClient()
      .from(CHAT_POSTS_TABLE)
      .update({ text: "", deleted_at: new Date().toISOString() })
      .eq("id", postId)
      .select("id");
    if (error || !data || data.length === 0) {
      throw error ?? new Error("Post not found.");
    }
  },
  "Failed to delete post."
);
