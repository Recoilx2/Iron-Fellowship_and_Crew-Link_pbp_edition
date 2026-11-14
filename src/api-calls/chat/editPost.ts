import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CHAT_POSTS_TABLE } from "./_postRef";

/**
 * Changes the text of a post. Only the author may edit, and only while the
 * post is live: the post access rules refuse everyone else and deleted
 * posts, which read as "post not found". The database stamps the edit, so
 * the feed shows the new text with an edited marker, and the change arrives
 * live as an update. A post keeps the spec invariant -- text, images or a
 * roll -- so clearing the words is allowed only when images or a roll
 * remain; text-only posts still need words.
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
    const { data: row, error: readError } = await getSupabaseClient()
      .from(CHAT_POSTS_TABLE)
      .select("id,image_paths,roll")
      .eq("id", postId)
      .single();
    if (readError || !row) {
      throw readError ?? new Error("Post not found.");
    }
    const typed = row as unknown as {
      image_paths?: string[] | null;
      roll?: unknown | null;
    };
    const keepsImages = (typed.image_paths ?? []).length > 0;
    const keepsRoll = typed.roll != null;
    if (!keepsImages && !keepsRoll) {
      throw new Error("Post text is required.");
    }
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
