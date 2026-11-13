import { createApiFunction } from "api-calls/createApiFunction";
import {
  ClientOption,
  modifyContentData,
} from "api-calls/homebrew/_supabase";

export const clearHomebrewOracleCollectionParent = createApiFunction<
  { oracleCollectionId: string } & ClientOption,
  void
>(async (params) => {
  await modifyContentData(
    "homebrew_oracle_collections",
    params.oracleCollectionId,
    (data) => {
      delete data.parentOracleCollectionId;
    },
    { client: params.client }
  );
}, "Failed to move oracle collection.");
