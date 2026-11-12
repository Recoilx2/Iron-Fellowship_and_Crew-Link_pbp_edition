import { getSupabaseClient } from "config/supabase.config";
import {
  CAMPAIGN_TRACKS_TABLE,
  CHARACTER_TRACKS_TABLE,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const removeProgressTrack = createApiFunction<
  {
    campaignId?: string;
    characterId?: string;
    id: string;
  },
  void
>(async (params) => {
  const { campaignId, characterId, id } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  if (campaignId) {
    const { data, error } = await getSupabaseClient()
      .from(CAMPAIGN_TRACKS_TABLE)
      .delete()
      .eq("id", id)
      .select("id");
    if (error || !data || data.length === 0) {
      throw error ?? new Error("Track not found");
    }
    return;
  }
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_TRACKS_TABLE)
    .delete()
    .eq("id", id)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Track not found");
  }
}, "Failed to remove progress track.");
