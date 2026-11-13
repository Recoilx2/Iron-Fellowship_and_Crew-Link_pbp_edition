import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewAssetDocument } from "api-calls/homebrew/assets/assets/_homebrewAssets.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewAssetDocument>("homebrew_assets");

export const updateHomebrewAsset = createApiFunction<
  { assetId: string; asset: DocumentUpdate<HomebrewAssetDocument> } & ClientOption,
  void
>(async (params) => {
  await api.update({
    id: params.assetId,
    doc: params.asset,
    client: params.client,
  });
}, "Failed to update asset.");
