import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getHomebrewCollectionDoc } from "./_getRef";
import { ExpansionDocument } from "api-calls/homebrew/_homebrewCollection.type";
import { createApiFunction } from "api-calls/createApiFunction";

export const updateHomebrewExpansion = createApiFunction<
  { id: string; expansion: DocumentUpdate<ExpansionDocument> },
  void
>((params) => {
  const { id, expansion } = params;

  return new Promise((resolve, reject) => {
    updateDoc(getHomebrewCollectionDoc(id), expansion as UpdateData<ExpansionDocument>)
      .then(() => resolve())
      .catch(reject);
  });
}, "Failed to update expansion.");
