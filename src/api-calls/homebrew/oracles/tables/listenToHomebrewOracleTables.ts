import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewOracleTableDocument } from "api-calls/homebrew/oracles/tables/_homebrewOracleTable.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewOracleTableDocument>(
  "homebrew_oracle_tables"
);

export function listenToHomebrewOracleTables(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewOracleTableDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
