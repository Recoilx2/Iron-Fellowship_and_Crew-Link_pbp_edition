import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getHomebrewImpactsDoc } from "./_getRef";
import { HomebrewImpactCategoryDocument } from "api-calls/homebrew/rules/impacts/_homebrewImpacts.type";

export const updateHomebrewImpactCategory = createApiFunction<
  {
    impactCategoryId: string;
    impactCategory: DocumentUpdate<HomebrewImpactCategoryDocument>;
  },
  void
>((params) => {
  const { impactCategoryId, impactCategory } = params;
  return new Promise((resolve, reject) => {
    updateDoc(
      getHomebrewImpactsDoc(impactCategoryId),
      impactCategory as UpdateData<HomebrewImpactCategoryDocument>
    )
      .then(() => {
        resolve();
      })
      .catch(reject);
  });
}, "Failed to update condition meter.");
