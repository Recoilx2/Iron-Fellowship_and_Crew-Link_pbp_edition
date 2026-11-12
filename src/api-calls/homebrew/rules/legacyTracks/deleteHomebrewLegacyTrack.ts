import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewLegacyTrackDocument } from "api-calls/homebrew/rules/legacyTracks/_homebrewLegacyTrack.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewLegacyTrackDocument>(
  "homebrew_legacy_tracks"
);

export const deleteHomebrewLegacyTrack = createApiFunction<
  { legacyTrackId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.legacyTrackId, client: params.client });
}, "Failed to delete legacy track.");
