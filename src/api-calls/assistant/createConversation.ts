import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { ASSISTANT_CONVERSATIONS_TABLE } from "./_getRef";

/**
 * Starts an assistant conversation in a campaign, owned by the signed-in
 * GM. Only GMs of the campaign may create conversations; everyone else
 * fails on the conversation access rules. The id is generated here so the
 * insert needs no RETURNING clause (notes convention, #69).
 */
export const createConversation = createApiFunction<
  { campaignId: string; title?: string },
  string
>(async (params) => {
  const { campaignId, title } = params;
  if (!campaignId || campaignId.trim().length === 0) {
    throw new Error("A campaign is required to start a conversation.");
  }
  const { data: sessionData, error: sessionError } =
    await getSupabaseClient().auth.getSession();
  const ownerId = sessionData.session?.user.id;
  if (sessionError || !ownerId) {
    throw sessionError ?? new Error("You must be logged in to chat.");
  }
  const trimmed = (title ?? "").trim();
  const id = crypto.randomUUID();
  const { error } = await getSupabaseClient()
    .from(ASSISTANT_CONVERSATIONS_TABLE)
    .insert({
      id,
      campaign_id: campaignId,
      owner_id: ownerId,
      title: trimmed.length > 0 ? trimmed : "New conversation",
    });
  if (error) {
    throw error;
  }
  return id;
}, "Failed to start conversation.");
