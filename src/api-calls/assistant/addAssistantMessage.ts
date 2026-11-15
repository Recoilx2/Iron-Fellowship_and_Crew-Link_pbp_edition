import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import type { AssistantMessageRole } from "./_assistant.type";
import { ASSISTANT_MESSAGES_TABLE } from "./_getRef";

/**
 * Adds a message to a conversation: the GM's question or the assistant's
 * reply (the server request path in a later ticket writes replies through
 * the same rows). Only the owning GM may write; anyone else fails on the
 * message access rules, which see the conversation's owner. The id is
 * generated here so the insert needs no RETURNING clause (notes
 * convention, #69).
 */
export const addAssistantMessage = createApiFunction<
  { conversationId: string; role: AssistantMessageRole; content: string },
  string
>(async (params) => {
  const { conversationId, role, content } = params;
  if (!conversationId || conversationId.trim().length === 0) {
    throw new Error("A conversation is required to add a message.");
  }
  if (role !== "user" && role !== "assistant") {
    throw new Error("Message role must be user or assistant.");
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error("Message content is required.");
  }
  const id = crypto.randomUUID();
  const { error } = await getSupabaseClient()
    .from(ASSISTANT_MESSAGES_TABLE)
    .insert({
      id,
      conversation_id: conversationId,
      role,
      content: trimmed,
      stopped_partway: false,
    });
  if (error) {
    throw error;
  }
  return id;
}, "Failed to add message.");
