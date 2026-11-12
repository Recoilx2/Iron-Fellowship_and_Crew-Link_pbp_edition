import { getSupabaseClient } from "config/supabase.config";
import { CHARACTERS_TABLE } from "../character/_getRef";
import { CAMPAIGNS_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Plays a character in a campaign by linking it. Only the owner links their
 * own character, and only into a campaign they belong to.
 */
export const addCharacterToCampaign = createApiFunction<
  { uid: string; characterId: string; campaignId: string },
  void
>(async (params) => {
  const { characterId, campaignId } = params;
  const client = getSupabaseClient();
  const { data: membership, error: membershipError } = await client
    .from(CAMPAIGNS_TABLE)
    .select("id")
    .eq("id", campaignId);
  if (membershipError) {
    throw membershipError;
  }
  if (!membership || membership.length === 0) {
    throw new Error("Campaign not found");
  }
  const { data, error } = await client
    .from(CHARACTERS_TABLE)
    .update({ campaign_id: campaignId })
    .eq("id", characterId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Character not found");
  }
}, "Error adding character to campaign.");
