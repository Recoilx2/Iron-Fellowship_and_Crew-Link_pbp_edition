import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { ASSISTANT_CONVERSATIONS_TABLE } from "./_getRef";

/**
 * Deletes a conversation. Only the owning GM may delete; anyone else's
 * delete matches no row, which reads as "conversation not found". The
 * conversation's messages follow through the database cascade, so the
 * client never deletes them one by one.
 */
export const deleteConversation = createApiFunction<
  { conversationId: string },
  void
>(async (params) => {
  const { conversationId } = params;
  const { data, error } = await getSupabaseClient()
    .from(ASSISTANT_CONVERSATIONS_TABLE)
    .delete()
    .eq("id", conversationId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Conversation not found.");
  }
}, "Failed to delete conversation.");
