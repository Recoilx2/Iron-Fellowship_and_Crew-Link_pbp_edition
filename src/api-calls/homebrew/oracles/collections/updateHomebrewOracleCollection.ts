import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewOracleCollectionDocument } from "api-calls/homebrew/oracles/collections/_homebrewOracleCollection.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewOracleCollectionDocument>(
  "homebrew_oracle_collections"
);

export const updateHomebrewOracleCollection = createApiFunction<
  {
    oracleCollectionId: string;
    oracleCollection: DocumentUpdate<HomebrewOracleCollectionDocument>;
  } & ClientOption,
  void
>(async (params) => {
  await api.update({
    id: params.oracleCollectionId,
    doc: params.oracleCollection,
    client: params.client,
  });
}, "Failed to update oracle collection.");
