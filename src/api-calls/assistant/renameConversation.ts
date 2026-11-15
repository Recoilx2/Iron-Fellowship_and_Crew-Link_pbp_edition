import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { ASSISTANT_CONVERSATIONS_TABLE } from "./_getRef";

/**
 * Renames a conversation. Only the owning GM may rename; anyone else's
 * update matches no row, which reads as "conversation not found".
 */
export const renameConversation = createApiFunction<
  { conversationId: string; title: string },
  void
>(async (params) => {
  const { conversationId, title } = params;
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error("Conversation title is required.");
  }
  const { data, error } = await getSupabaseClient()
    .from(ASSISTANT_CONVERSATIONS_TABLE)
    .update({ title: trimmed })
    .eq("id", conversationId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Conversation not found.");
  }
}, "Failed to rename conversation.");
