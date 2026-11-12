import { Unsubscribe } from "api-calls/helpers.type";
import {
  CampaignDocument,
  CampaignType,
} from "api-calls/campaign/_campaign.type";
import { CurrentCampaignSlice } from "./currentCampaign/currentCampaign.slice.type";

export interface CampaignSliceData {
  campaignMap: { [campaignId: string]: CampaignDocument };
  error?: string;
  loading: boolean;
}

export interface CampaignSliceActions {
  subscribe: (uid?: string) => Unsubscribe | undefined;

  createCampaign: (
    campaignName: string,
    campaignType: CampaignType
  ) => Promise<string>;
  getCampaign: (campaignId: string) => Promise<CampaignDocument>;
  joinCampaign: (campaignId: string) => Promise<{ id: string; name: string }>;
  previewCampaign: (campaignId: string) => Promise<{ id: string; name: string }>;
}

export type CampaignSlice = CampaignSliceData &
  CampaignSliceActions & {
    currentCampaign: CurrentCampaignSlice;
  };
