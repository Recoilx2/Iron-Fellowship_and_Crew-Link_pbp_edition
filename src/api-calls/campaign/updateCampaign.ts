import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getCampaignDoc } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";
import { CampaignDocument } from "api-calls/campaign/_campaign.type";

export const updateCampaign = createApiFunction<
  {
    campaignId: string;
    campaign: DocumentUpdate<CampaignDocument>;
  },
  void
>((params) => {
  const { campaignId, campaign } = params;
  return new Promise((resolve, reject) => {
    updateDoc(getCampaignDoc(campaignId), campaign as UpdateData<CampaignDocument>)
      .then(() => {
        resolve();
      })
      .catch((e) => {
        reject(e);
      });
  });
}, "Failed to update campaign.");
