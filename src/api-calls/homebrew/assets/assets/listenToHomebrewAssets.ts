import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewAssetDocument } from "api-calls/homebrew/assets/assets/_homebrewAssets.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewAssetDocument>("homebrew_assets");

export function listenToHomebrewAssets(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewAssetDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
