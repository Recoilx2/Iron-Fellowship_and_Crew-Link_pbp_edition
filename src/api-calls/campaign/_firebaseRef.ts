import { firestore } from "config/firebase.config";
import {
  collection,
  CollectionReference,
  doc,
  DocumentReference,
} from "firebase/firestore";
import { CampaignDocument } from "api-calls/campaign/_campaign.type";

/**
 * Firebase collection and document refs for campaigns. Campaigns live in
 * Supabase now; these refs stay only for areas that still live in Firebase
 * (worlds, homebrew) until their tickets port them.
 */
export function constructCampaignCollectionPath() {
  return `/campaigns`;
}
export function constructCampaignDocPath(campaignId: string) {
  return `/campaigns/${campaignId}`;
}

export function getCampaignCollection() {
  return collection(
    firestore,
    constructCampaignCollectionPath()
  ) as CollectionReference<CampaignDocument>;
}

export function getCampaignDoc(campaignId: string) {
  return doc(
    firestore,
    constructCampaignDocPath(campaignId)
  ) as DocumentReference<CampaignDocument>;
}
