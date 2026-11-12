import { deleteField, updateDoc } from "firebase/firestore";
import { createApiFunction } from "api-calls/createApiFunction";
import { getHomebrewOracleCollectionDoc } from "./_getRef";

export const clearHomebrewOracleCollectionParent = createApiFunction<
  { oracleCollectionId: string },
  void
>((params) => {
  const { oracleCollectionId } = params;
  return new Promise((resolve, reject) => {
    updateDoc(getHomebrewOracleCollectionDoc(oracleCollectionId), {
      parentOracleCollectionId: deleteField(),
    })
      .then(() => resolve())
      .catch(reject);
  });
}, "Failed to move oracle collection.");
