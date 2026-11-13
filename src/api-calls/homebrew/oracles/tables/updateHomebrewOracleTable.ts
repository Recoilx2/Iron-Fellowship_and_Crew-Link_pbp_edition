import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewOracleTableDocument } from "api-calls/homebrew/oracles/tables/_homebrewOracleTable.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewOracleTableDocument>(
  "homebrew_oracle_tables"
);

export const updateHomebrewOracleTable = createApiFunction<
  {
    oracleTableId: string;
    oracleTable: DocumentUpdate<HomebrewOracleTableDocument>;
  } & ClientOption,
  void
>(async (params) => {
  await api.update({
    id: params.oracleTableId,
    doc: params.oracleTable,
    client: params.client,
  });
}, "Failed to update oracle table.");
