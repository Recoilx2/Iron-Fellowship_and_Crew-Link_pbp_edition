import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getHomebrewLegacyTrackDoc } from "./_getRef";
import { HomebrewLegacyTrackDocument } from "api-calls/homebrew/rules/legacyTracks/_homebrewLegacyTrack.type";

export const updateHomebrewLegacyTrack = createApiFunction<
  {
    legacyTrackId: string;
    legacyTrack: DocumentUpdate<HomebrewLegacyTrackDocument>;
  },
  void
>((params) => {
  const { legacyTrackId, legacyTrack } = params;
  return new Promise((resolve, reject) => {
    updateDoc(
      getHomebrewLegacyTrackDoc(legacyTrackId),
      legacyTrack as UpdateData<HomebrewLegacyTrackDocument>
    )
      .then(() => {
        resolve();
      })
      .catch(reject);
  });
}, "Failed to update legacy track.");
