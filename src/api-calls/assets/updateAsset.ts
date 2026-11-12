import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getCampaignAssetDoc, getCharacterAssetDoc } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";
import { AssetDocument } from "api-calls/assets/_asset.type";

export const updateAsset = createApiFunction<
  {
    characterId?: string;
    campaignId?: string;
    assetId: string;
    asset: DocumentUpdate<AssetDocument>;
  },
  void
>((params) => {
  const { characterId, campaignId, assetId, asset } = params;

  return new Promise((resolve, reject) => {
    if (!characterId && !campaignId) {
      reject("Either campaign or character ID must be defined.");
      return;
    }
    updateDoc(
      characterId
        ? getCharacterAssetDoc(characterId, assetId)
        : getCampaignAssetDoc(campaignId as string, assetId),
      asset as UpdateData<AssetDocument>
    )
      .then(() => {
        resolve();
      })
      .catch((e) => {
        reject(e);
      });
  });
}, "Error updating asset.");
