import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewLegacyTrackDocument } from "api-calls/homebrew/rules/legacyTracks/_homebrewLegacyTrack.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewLegacyTrackDocument>(
  "homebrew_legacy_tracks"
);

export const createHomebrewLegacyTrack = createApiFunction<
  { legacyTrack: HomebrewLegacyTrackDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.legacyTrack, client: params.client });
}, "Failed to create legacy track.");
