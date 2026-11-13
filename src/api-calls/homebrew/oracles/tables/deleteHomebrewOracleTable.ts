import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewOracleTableDocument } from "api-calls/homebrew/oracles/tables/_homebrewOracleTable.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewOracleTableDocument>(
  "homebrew_oracle_tables"
);

export const deleteHomebrewOracleTable = createApiFunction<
  { oracleTableId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.oracleTableId, client: params.client });
}, "Failed to delete oracle table.");
