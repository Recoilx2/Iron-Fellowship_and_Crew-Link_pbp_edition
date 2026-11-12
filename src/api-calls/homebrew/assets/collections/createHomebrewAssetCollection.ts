import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewAssetCollectionDocument } from "api-calls/homebrew/assets/collections/_homebrewAssetCollection.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewAssetCollectionDocument>(
  "homebrew_asset_collections"
);

export const createHomebrewAssetCollection = createApiFunction<
  { assetCollection: HomebrewAssetCollectionDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.assetCollection, client: params.client });
}, "Failed to create asset collection.");
