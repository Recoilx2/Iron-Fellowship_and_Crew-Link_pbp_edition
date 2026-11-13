import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewOracleCollectionDocument } from "api-calls/homebrew/oracles/collections/_homebrewOracleCollection.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewOracleCollectionDocument>(
  "homebrew_oracle_collections"
);

export const deleteHomebrewOracleCollection = createApiFunction<
  { oracleCollectionId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.oracleCollectionId, client: params.client });
}, "Failed to delete oracle collection.");
