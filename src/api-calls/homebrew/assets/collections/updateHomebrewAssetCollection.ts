import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewAssetCollectionDocument } from "api-calls/homebrew/assets/collections/_homebrewAssetCollection.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewAssetCollectionDocument>(
  "homebrew_asset_collections"
);

export const updateHomebrewAssetCollection = createApiFunction<
  {
    assetCollectionId: string;
    assetCollection: DocumentUpdate<HomebrewAssetCollectionDocument>;
  } & ClientOption,
  void
>(async (params) => {
  await api.update({
    id: params.assetCollectionId,
    doc: params.assetCollection,
    client: params.client,
  });
}, "Failed to update asset collection.");
