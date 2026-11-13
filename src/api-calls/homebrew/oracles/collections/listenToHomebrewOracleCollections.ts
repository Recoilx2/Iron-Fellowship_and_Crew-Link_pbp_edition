import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewOracleCollectionDocument } from "api-calls/homebrew/oracles/collections/_homebrewOracleCollection.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewOracleCollectionDocument>(
  "homebrew_oracle_collections"
);

export function listenToHomebrewOracleCollections(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewOracleCollectionDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
