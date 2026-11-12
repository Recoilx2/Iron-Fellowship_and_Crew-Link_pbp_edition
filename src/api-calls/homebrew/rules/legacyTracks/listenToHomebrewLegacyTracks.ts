import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewLegacyTrackDocument } from "api-calls/homebrew/rules/legacyTracks/_homebrewLegacyTrack.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewLegacyTrackDocument>(
  "homebrew_legacy_tracks"
);

export function listenToHomebrewLegacyTracks(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewLegacyTrackDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
