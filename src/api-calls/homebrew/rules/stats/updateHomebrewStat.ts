import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getHomebrewStatsDoc } from "./_getRef";
import { HomebrewStatDocument } from "api-calls/homebrew/rules/stats/_homebrewStat.type";

export const updateHomebrewStat = createApiFunction<
  {
    statId: string;
    stat: DocumentUpdate<HomebrewStatDocument>;
  },
  void
>((params) => {
  const { statId, stat } = params;
  return new Promise((resolve, reject) => {
    updateDoc(
      getHomebrewStatsDoc(statId),
      stat as UpdateData<HomebrewStatDocument>
    )
      .then(() => {
        resolve();
      })
      .catch(reject);
  });
}, "Failed to update stat.");
