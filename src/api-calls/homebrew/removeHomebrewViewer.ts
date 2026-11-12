import { arrayRemove, updateDoc } from "firebase/firestore";
import { getHomebrewCollectionDoc } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const removeHomebrewViewer = createApiFunction<
  { id: string; uid: string },
  void
>((params) => {
  const { id, uid } = params;

  return new Promise((resolve, reject) => {
    updateDoc(getHomebrewCollectionDoc(id), { viewers: arrayRemove(uid) })
      .then(() => resolve())
      .catch(reject);
  });
}, "Failed to remove viewer.");
