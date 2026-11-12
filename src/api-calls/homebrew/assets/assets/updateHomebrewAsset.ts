import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getHomebrewAssetDoc } from "./_getRef";
import { HomebrewAssetDocument } from "api-calls/homebrew/assets/assets/_homebrewAssets.type";

export const updateHomebrewAsset = createApiFunction<
  {
    assetId: string;
    asset: DocumentUpdate<HomebrewAssetDocument>;
  },
  void
>((params) => {
  const { assetId, asset } = params;
  return new Promise((resolve, reject) => {
    updateDoc(
      getHomebrewAssetDoc(assetId),
      asset as UpdateData<HomebrewAssetDocument>
    ).then(resolve).catch(reject);
  });
}, "Failed to update asset.");
