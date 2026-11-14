import { getSupabaseClient } from "config/supabase.config";
import { CHARACTERS_TABLE } from "../character/_getRef";
import { CAMPAIGNS_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Plays a character in a campaign by linking it. Only the owner links their
 * own character, and only into a campaign they belong to.
 *
 * At most one character per player per campaign is active (#127): when the
 * player already plays one here, linking another retires the current active
 * one first and links the new one active -- the database guard would reject
 * a second active row.
 */
export const addCharacterToCampaign = createApiFunction<
  { uid: string; characterId: string; campaignId: string },
  void
>(async (params) => {
  const { characterId, campaignId } = params;
  const client = getSupabaseClient();

  // Ownership comes from the signed-in session, like createCharacter: the
  // update policy compares owner_id against auth.uid(), so a caller-supplied
  // uid naming anyone else is rejected by the database.
  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();
  const ownerId = sessionData.session?.user.id;
  if (sessionError || !ownerId) {
    throw sessionError ?? new Error("You must be logged in to add a character");
  }

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
  const { data: current, error: currentError } = await client
    .from(CHARACTERS_TABLE)
    .select("id")
    .eq("owner_id", ownerId)
    .eq("campaign_id", campaignId)
    .eq("is_active", true)
    .neq("id", characterId);
  if (currentError) {
    throw currentError;
  }
  for (const row of (current ?? []) as Array<{ id: string }>) {
    const { error } = await client
      .from(CHARACTERS_TABLE)
      .update({ is_active: false })
      .eq("id", row.id)
      .select("id");
    if (error) {
      throw error;
    }
  }
  const { data, error } = await client
    .from(CHARACTERS_TABLE)
    .update({ campaign_id: campaignId, is_active: true })
    .eq("id", characterId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Character not found");
  }
}, "Error adding character to campaign.");
