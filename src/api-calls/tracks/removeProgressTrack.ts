import { deleteDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignTracksDoc,
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

  // Campaign tracks stay on Firebase until the campaigns ticket ports them.
  if (campaignId) {
    await deleteDoc(getCampaignTracksDoc(campaignId as string, id));
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
