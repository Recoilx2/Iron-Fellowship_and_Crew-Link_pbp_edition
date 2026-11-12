import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewAssetCollectionDocument } from "api-calls/homebrew/assets/collections/_homebrewAssetCollection.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewAssetCollectionDocument>(
  "homebrew_asset_collections"
);

export function listenToHomebrewAssetCollections(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewAssetCollectionDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
