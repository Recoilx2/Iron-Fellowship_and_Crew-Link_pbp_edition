import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewAssetDocument } from "api-calls/homebrew/assets/assets/_homebrewAssets.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewAssetDocument>("homebrew_assets");

export const deleteHomebrewAsset = createApiFunction<
  { assetId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.assetId, client: params.client });
}, "Failed to delete asset.");
