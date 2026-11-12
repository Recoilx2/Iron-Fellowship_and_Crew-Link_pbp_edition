import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getHomebrewAssetCollectionDoc } from "./_getRef";
import { HomebrewAssetCollectionDocument } from "api-calls/homebrew/assets/collections/_homebrewAssetCollection.type";

export const updateHomebrewAssetCollection = createApiFunction<
  {
    assetCollectionId: string;
    assetCollection: DocumentUpdate<HomebrewAssetCollectionDocument>;
  },
  void
>((params) => {
  const { assetCollectionId, assetCollection } = params;
  return new Promise((resolve, reject) => {
    updateDoc(
      getHomebrewAssetCollectionDoc(assetCollectionId),
      assetCollection as UpdateData<HomebrewAssetCollectionDocument>
    )
      .then(() => resolve())
      .catch(reject);
  });
}, "Failed to update asset collection.");
