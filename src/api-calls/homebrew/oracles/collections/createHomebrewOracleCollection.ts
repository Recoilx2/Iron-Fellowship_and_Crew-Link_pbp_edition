import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewOracleCollectionDocument } from "api-calls/homebrew/oracles/collections/_homebrewOracleCollection.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewOracleCollectionDocument>(
  "homebrew_oracle_collections"
);

export const createHomebrewOracleCollection = createApiFunction<
  { oracleCollection: HomebrewOracleCollectionDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.oracleCollection, client: params.client });
}, "Failed to create oracle collection.");
