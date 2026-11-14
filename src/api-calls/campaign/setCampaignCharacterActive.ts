import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Retires or reactivates a campaign character without removing it. Only the
 * owner may do it, enforced by the database; making a character active
 * retires the player's other active characters in the same call, so a
 * player never has two active at once (#127).
 */
export const setCampaignCharacterActive = createApiFunction<
  { uid: string; characterId: string; active: boolean },
  void
>(async (params) => {
  const { characterId, active } = params;
  const { error } = await getSupabaseClient().rpc(
    "set_campaign_character_active",
    { char_id: characterId, make_active: active }
  );
  if (error) {
    throw error;
  }
}, "Failed to change which character is active.");
