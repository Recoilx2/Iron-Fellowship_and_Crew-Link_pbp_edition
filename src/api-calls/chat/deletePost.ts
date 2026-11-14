import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CHAT_POSTS_TABLE } from "./_postRef";
import { removeChatImage } from "./chatImages";

/**
 * Soft-deletes a post: the author may take back their own post, and GMs may
 * delete any post in their campaign. A delete is an update that clears the
 * content -- text, image paths and roll -- and stamps the delete marker,
 * never a SQL delete: under postgres_changes a delete event bypasses
 * row-level security, while an update stays filtered per reader. The row
 * stays in place so the feed shows a "post deleted" marker, and the change
 * arrives live as an update. The post's image files are removed while the
 * row still names them: the storage rules attribute a file to its post, so
 * a GM clearing another member's post could not remove them afterwards.
 * Everyone else (and deleted posts) reads as "post not found".
 */
export const deletePost = createApiFunction<{ postId: string }, void>(
  async (params) => {
    const { postId } = params;
    if (!postId) {
      throw new Error("A post is required to delete.");
    }
    // The paths must be read before the row is cleared; a post nobody may
    // read (or one already gone) reads as not found, same as before.
    const { data: row, error: readError } = await getSupabaseClient()
      .from(CHAT_POSTS_TABLE)
      .select("id,image_paths")
      .eq("id", postId)
      .single();
    if (readError || !row) {
      throw readError ?? new Error("Post not found.");
    }
    // A missing file must not strand the post: removals are best-effort,
    // and the row below is what hides the post either way.
    await Promise.all(
      (((row as unknown as { image_paths?: string[] }).image_paths ?? []).map(
        (path) => removeChatImage(path).catch(() => {})
      ))
    );
    // The marker's timestamp is stamped by the database; the content is
    // cleared here so the row never briefly carries deleted text, images or
    // dice. The database clears them again on the way through.
    const { data, error } = await getSupabaseClient()
      .from(CHAT_POSTS_TABLE)
      .update({
        text: "",
        image_paths: [],
        roll: null,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", postId)
      .select("id");
    if (error || !data || data.length === 0) {
      throw error ?? new Error("Post not found.");
    }
  },
  "Failed to delete post."
);
