import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewOracleTableDocument } from "api-calls/homebrew/oracles/tables/_homebrewOracleTable.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewOracleTableDocument>(
  "homebrew_oracle_tables"
);

export const createHomebrewOracleTable = createApiFunction<
  { oracleTable: HomebrewOracleTableDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.oracleTable, client: params.client });
}, "Failed to create oracle table.");
