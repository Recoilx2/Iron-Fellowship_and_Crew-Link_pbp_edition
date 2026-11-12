import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewAssetCollectionDocument } from "api-calls/homebrew/assets/collections/_homebrewAssetCollection.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewAssetCollectionDocument>(
  "homebrew_asset_collections"
);

export const deleteHomebrewAssetCollection = createApiFunction<
  { assetCollectionId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.assetCollectionId, client: params.client });
}, "Failed to delete asset collection.");
