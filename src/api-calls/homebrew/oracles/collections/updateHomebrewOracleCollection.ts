import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewOracleCollectionDocument } from "api-calls/homebrew/oracles/collections/_homebrewOracleCollection.type";
import { getHomebrewOracleCollectionDoc } from "./_getRef";

export const updateHomebrewOracleCollection = createApiFunction<
  {
    oracleCollectionId: string;
    oracleCollection: DocumentUpdate<HomebrewOracleCollectionDocument>;
  },
  void
>((params) => {
  const { oracleCollectionId, oracleCollection } = params;
  return new Promise((resolve, reject) => {
    updateDoc(
      getHomebrewOracleCollectionDoc(oracleCollectionId),
      oracleCollection as UpdateData<HomebrewOracleCollectionDocument>
    )
      .then(() => resolve())
      .catch(reject);
  });
}, "Failed to update oracle collection.");
