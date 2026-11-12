import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewAssetDocument } from "api-calls/homebrew/assets/assets/_homebrewAssets.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewAssetDocument>("homebrew_assets");

export const createHomebrewAsset = createApiFunction<
  { asset: HomebrewAssetDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.asset, client: params.client });
}, "Failed to create asset.");
