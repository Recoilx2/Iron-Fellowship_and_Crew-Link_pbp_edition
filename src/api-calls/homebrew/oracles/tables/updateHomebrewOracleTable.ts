import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewOracleTableDocument } from "api-calls/homebrew/oracles/tables/_homebrewOracleTable.type";
import { getHomebrewOracleTableDoc } from "./_getRef";

export const updateHomebrewOracleTable = createApiFunction<
  {
    oracleTableId: string;
    oracleTable: DocumentUpdate<HomebrewOracleTableDocument>;
  },
  void
>((params) => {
  const { oracleTableId, oracleTable } = params;
  return new Promise((resolve, reject) => {
    updateDoc(
      getHomebrewOracleTableDoc(oracleTableId),
      oracleTable as UpdateData<HomebrewOracleTableDocument>
    )
      .then(resolve)
      .catch(reject);
  });
}, "Failed to update oracle table.");
