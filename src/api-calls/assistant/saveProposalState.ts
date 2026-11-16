import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import type { AssistantProposalState } from "./_assistant.type";
import { ASSISTANT_MESSAGES_TABLE } from "./_getRef";

/**
 * Remembers what the GM did with an outline proposal, on the assistant
 * message that carried it: "applied" (with the version that Apply kept, for
 * Undo, or null when none was kept), "dismissed", or null once an Undo made
 * the proposal applicable again. Only the owning GM may write; anyone
 * else's update matches no row, which reads as "message not found".
 */
export const saveProposalState = createApiFunction<
  {
    messageId: string;
    state: AssistantProposalState | null;
    appliedVersionId: string | null;
  },
  void
>(async (params) => {
  const { messageId, state, appliedVersionId } = params;
  if (!messageId || messageId.trim().length === 0) {
    throw new Error("A message is required to save a proposal state.");
  }
  if (appliedVersionId !== null && state !== "applied") {
    throw new Error("Only an applied proposal can name an outline version.");
  }
  const { data, error } = await getSupabaseClient()
    .from(ASSISTANT_MESSAGES_TABLE)
    .update({ proposal_state: state, applied_version_id: appliedVersionId })
    .eq("id", messageId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Message not found.");
  }
}, "Failed to save the proposal state.");
