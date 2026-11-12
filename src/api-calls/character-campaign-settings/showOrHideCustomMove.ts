import { arrayRemove, arrayUnion, setDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignSettingsDoc,
  CHARACTER_SETTINGS_TABLE,
  characterSettingsRowToDocument,
  type CharacterSettingsRow,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

async function toggleSupabaseId(
  characterId: string,
  column: "hidden_custom_move_ids" | "hidden_custom_oracle_ids",
  id: string,
  hidden: boolean
): Promise<void> {
  const client = getSupabaseClient();
  const { data, error: fetchError } = await client
    .from(CHARACTER_SETTINGS_TABLE)
    .select("*")
    .eq("character_id", characterId)
    .single();
  if (fetchError && fetchError.code !== "PGRST116") {
    throw fetchError;
  }
  const current = characterSettingsRowToDocument(
    (data ?? null) as unknown as CharacterSettingsRow | null
  );
  const list =
    column === "hidden_custom_move_ids"
      ? current.hiddenCustomMoveIds
      : current.hiddenCustomOraclesIds;
  const next = hidden
    ? Array.from(new Set([...list, id]))
    : list.filter((entry) => entry !== id);
  const { error } = await client
    .from(CHARACTER_SETTINGS_TABLE)
    .upsert({ character_id: characterId, [column]: next }, {
      onConflict: "character_id",
    });
  if (error) {
    throw error;
  }
}

export const showOrHideCustomMove = createApiFunction<
  {
    campaignId?: string;
    characterId?: string;
    moveId: string;
    hidden: boolean;
  },
  void
>(async (params) => {
  const { campaignId, characterId, moveId, hidden } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  // Campaign settings stay on Firebase until the campaigns ticket ports them.
  if (campaignId) {
    await setDoc(getCampaignSettingsDoc(campaignId as string), {
      hiddenCustomMoveIds: hidden ? arrayUnion(moveId) : arrayRemove(moveId),
    }, { merge: true });
    return;
  }
  if (!characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  await toggleSupabaseId(
    characterId,
    "hidden_custom_move_ids",
    moveId,
    hidden
  );
}, "Failed to update custom move visibility.");
